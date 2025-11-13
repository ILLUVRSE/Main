// sentinelnet/src/evaluator/jsonLogicEvaluator.ts
import jsonLogic from 'json-logic-js';
import logger from '../logger';

/**
 * Result shape returned by evaluator
 */
export interface EvalResult {
  match: boolean;
  explanation?: string;
  // a minimal evidence object: the rule, the data evaluated, and a snapshot
  evidence?: {
    rule: any;
    data: any;
    // JSONLogic cannot provide per-rule clause traces by default; include raw output
    rawResult?: any;
  };
  // optional numeric score placeholder (for future use)
  score?: number | null;
}

/**
 * Evaluate a JSONLogic rule against given data.
 * Returns a normalized EvalResult.
 *
 * Note: json-logic-js does not provide a clause-level trace/explanation.
 * For explainability we return the rule, the input, and the raw result.
 */
export function evaluateJsonLogic(rule: any, data: any): EvalResult {
  try {
    // jsonLogic.apply can throw for invalid rules
    const raw = jsonLogic.apply(rule, data);
    // JSONLogic semantics: result truthy => rule matched (allow/true)
    const match = Boolean(raw);

    const res: EvalResult = {
      match,
      explanation: `jsonlogic evaluation => match=${match}`,
      evidence: {
        rule,
        data,
        rawResult: raw,
      },
      score: null,
    };

    return res;
  } catch (err) {
    logger.error('jsonLogicEvaluator error', err);
    // On evaluator error, be conservative: return non-match and include error message
    return {
      match: false,
      explanation: `evaluator_error: ${(err as Error).message}`,
      evidence: {
        rule,
        data,
        rawResult: null,
      },
      score: null,
    };
  }
}

/**
 * A thin facade so other code imports from evaluator/index.ts easily.
 */
export default {
  evaluateJsonLogic,
};

