/**
 * sandboxGuard.ts
 *
 * Middleware to guard sandbox/validate endpoints.
 *
 * Behavior:
 *  - Allow if REPOWRITER_ALLOW_NO_KEY === "1" (developer override)
 *  - Allow if SANDBOX_ENABLED === "1"
 *  - Otherwise respond 503 with an explanatory message.
 *
 * Optional RBAC:
 *  - If SANDBOX_ALLOWED_ROLES is set (comma-separated, e.g., "admin,dev"),
 *    require request to include X-User-Role header (or x-user-role) that matches one of the allowed roles.
 *
 * Notes:
 *  - This is a light-weight guard for development/demo. Replace or augment with your real auth.
 */

import type { Request, Response, NextFunction } from "express";

export function sandboxGuard(req: Request, res: Response, next: NextFunction) {
  try {
    const allowOverride = process.env.REPOWRITER_ALLOW_NO_KEY === "1";
    const sandboxEnabled = process.env.SANDBOX_ENABLED === "1";

    if (allowOverride || sandboxEnabled) {
      // If RBAC configured, enforce it
      const allowedRolesRaw = (process.env.SANDBOX_ALLOWED_ROLES || "").trim();
      if (allowedRolesRaw) {
        const allowed = allowedRolesRaw.split(",").map(s => s.trim()).filter(Boolean);
        // Role can be passed via header X-User-Role or x-user-role
        const roleHeader = (req.headers["x-user-role"] as string) || (req.headers["X-User-Role"] as string) || "";
        const role = roleHeader ? String(roleHeader).trim() : "";
        if (!role) {
          return res.status(403).json({ ok: false, error: "Sandbox access denied: missing X-User-Role header" });
        }
        if (!allowed.includes(role)) {
          return res.status(403).json({ ok: false, error: "Sandbox access denied: role not permitted" });
        }
      }

      return next();
    }

    // Otherwise deny
    const msg =
      "Sandbox is not enabled. To allow sandbox/validate endpoints set SANDBOX_ENABLED=1 in the server environment. " +
      "For development only, set REPOWRITER_ALLOW_NO_KEY=1 to bypass this check. " +
      "If you need role-restricted access, set SANDBOX_ALLOWED_ROLES='admin,dev' and send X-User-Role header.";
    return res.status(503).json({ ok: false, error: msg });
  } catch (err: any) {
    // Fail-open: if the guard throws unexpectedly, log and allow (so dev UX isn't blocked).
    console.warn("[sandboxGuard] error:", err && (err.stack || err.message || err));
    return next();
  }
}

export default sandboxGuard;

