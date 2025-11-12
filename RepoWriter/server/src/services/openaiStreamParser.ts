/**
 * openaiStreamParser.ts
 *
 * Helpers to incrementally parse OpenAI streaming payloads (SSE `data:` lines).
 *
 * Usage:
 *   const p = new OpenAIStreamParser();
 *   for (const chunk of streamChunks) {
 *     const parsed = p.feed(chunk);
 *     if (parsed) { handleParsedPlan(parsed); }
 *   }
 *
 * Behavior:
 *  - Accepts raw payload strings that may be:
 *      - full JSON bodies like { choices: [{ message: { content: "..." } }] }
 *      - JSON fragments emitted by OpenAI (partial content)
 *      - plain text fragments that together form JSON
 *  - Extracts choices[0].message.content (or choices[0].delta.content) and
 *    attempts to parse it as JSON; if it's not yet parseable, the parser
 *    accumulates fragments until a balanced/parseable JSON object is formed.
 *  - Returns the parsed JS value (usually the structured Plan) when available,
 *    otherwise returns null.
 *
 * Note: This is a pragmatic, robust helper aimed at the planner/patcher use-case.
 * It errs on the side of collecting fragments and attempting JSON.parse rather
 * than failing early.
 */

export class OpenAIStreamParser {
  private buffer: string;
  constructor() {
    this.buffer = "";
  }

  /** Reset the internal buffer (useful between independent streams). */
  reset() {
    this.buffer = "";
  }

  /**
   * Feed a single raw payload string (one `data:` payload from the stream).
   * If a complete JSON value is parseable as a result of this feed, returns it.
   * Otherwise returns null.
   */
  feed(raw: string): any | null {
    if (raw == null) return null;
    const s = String(raw);

    // Try to interpret the payload as a JSON OpenAI envelope (choices/...).
    // If that succeeds, extract message content or delta content.
    let candidateContent: string | object | null = null;
    try {
      const env = JSON.parse(s);
      // OpenAI streaming sometimes uses choices[0].delta.content for partials
      const ch = Array.isArray(env.choices) ? env.choices[0] : null;
      if (ch) {
        // prefer message.content (non-streaming) then delta.content (streaming)
        if (ch.message && typeof ch.message.content !== "undefined") {
          candidateContent = ch.message.content;
        } else if (ch.delta && typeof ch.delta.content !== "undefined") {
          candidateContent = ch.delta.content;
        } else if (typeof ch.text !== "undefined") {
          // older formats
          candidateContent = ch.text;
        } else {
          candidateContent = null;
        }
      } else {
        candidateContent = env;
      }
    } catch {
      // Not an envelope JSON -- treat payload as raw text fragment
      candidateContent = s;
    }

    // If candidateContent is an object (already parsed), return it directly
    if (candidateContent && typeof candidateContent === "object") {
      return candidateContent;
    }

    // If it's a string, attempt to parse it as JSON. If partial, accumulate.
    if (typeof candidateContent === "string") {
      // If the string looks like a quoted JSON string (e.g., "\"{...}\""), try to unquote it
      let str = candidateContent;
      // remove leading/trailing quotes if entire string is quoted
      if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
        try {
          const unq = JSON.parse(str);
          if (typeof unq === "string") {
            str = unq;
          }
        } catch {
          // ignore; we'll treat original
        }
      }

      // Fast-path: try parse this fragment alone
      try {
        const parsed = JSON.parse(str);
        // reset buffer if present
        this.buffer = "";
        return parsed;
      } catch {
        // not parseable alone: append to buffer and try again
        this.buffer += str;
        // Try parsing buffered content
        try {
          const parsed = JSON.parse(this.buffer);
          this.buffer = "";
          return parsed;
        } catch {
          // still incomplete
          return null;
        }
      }
    }

    // fallback: nothing parseable
    return null;
  }

  /**
   * Convenience: feed an array of raw payloads and return the list of parsed
   * JSON values (may be empty). This feeds sequentially and collects any parsed
   * objects along the way.
   */
  feedAll(payloads: string[]): any[] {
    const results: any[] = [];
    for (const p of payloads) {
      const r = this.feed(p);
      if (r !== null && typeof r !== "undefined") results.push(r);
    }
    return results;
  }
}

export default OpenAIStreamParser;

