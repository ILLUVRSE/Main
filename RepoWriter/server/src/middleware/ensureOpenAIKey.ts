/**
 * ensureOpenAIKey.ts
 *
 * Middleware that blocks "heavy" endpoints that require a real OpenAI API key
 * when none is configured. This protects accidental calls to production OpenAI
 * without a key and provides a clear error message.
 *
 * Behavior:
 *  - If process.env.OPENAI_API_KEY is set -> allow.
 *  - If process.env.OPENAI_API_URL points to a localhost/mock (127.0.0.1 or localhost)
 *    -> allow (useful for deterministic local testing with openaiMock).
 *  - If process.env.REPOWRITER_ALLOW_NO_KEY === "1" -> allow (developer override).
 *  - Otherwise -> respond 503 with an explanatory JSON payload.
 *
 * Attach early (before routes that call OpenAI).
 */

import { Request, Response, NextFunction } from "express";
import { logWarn } from "../telemetry/logger.js";

export function ensureOpenAIKey(req: Request, res: Response, next: NextFunction) {
  try {
    const key = process.env.OPENAI_API_KEY;
    const base = (process.env.OPENAI_API_URL || "").trim();
    const allowFlag = process.env.REPOWRITER_ALLOW_NO_KEY === "1";

    // Allow if explicit override
    if (allowFlag) {
      return next();
    }

    // Allow if explicit key present
    if (key && key.length > 0) {
      return next();
    }

    // Allow if OPENAI_API_URL points to a local mock (localhost or 127.0.0.1)
    if (base) {
      const lower = base.toLowerCase();
      if (lower.includes("localhost") || lower.includes("127.0.0.1")) {
        return next();
      }
    }

    // Otherwise, refuse with actionable error
    const msg =
      "OPENAI_API_KEY is not configured. This endpoint requires an OpenAI API key or a local OPENAI_API_URL (mock). " +
      "Set OPENAI_API_KEY in RepoWriter/server/.env or set OPENAI_API_URL to your local mock (http://127.0.0.1:9876). " +
      "For development only, set REPOWRITER_ALLOW_NO_KEY=1 to bypass this check.";

    logWarn(req, "ensureOpenAIKey: blocking request due to missing OpenAI key");
    return res.status(503).json({ ok: false, error: msg });
  } catch (err: any) {
    // Fail-open: allow request if middleware itself errors, but log the issue
    try {
      logWarn(req, `ensureOpenAIKey middleware error: ${String(err?.message || err)}`);
    } catch {}
    return next();
  }
}

export default ensureOpenAIKey;

