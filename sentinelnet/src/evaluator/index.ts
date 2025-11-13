// sentinelnet/src/evaluator/index.ts
import { evaluateJsonLogic, EvalResult } from './jsonLogicEvaluator';
import logger from '../logger';

/**
 * Evaluator facade
 *
 * This module exposes a single `evaluate` function that accepts a policy rule
 * (currently JSONLogic) and a data/context object. It returns an EvalResult.
 *
 * This facade lets us swap in a different evaluator (CEL, custom AST, ML scorer)
 * later without changing callers.
 */

export async function evaluate(rule: any, data: any): Promise<EvalResult> {
  // For now, assume rule is JSONLogic compatible.
  try {
    const res = evaluateJsonLogic(rule, data);
    return res;
  } catch (err) {
    logger.error('evaluator.evaluate unexpected error', err);
    return {
      match: false,
      explanation: `evaluator_error: ${(err as Error).message}`,
      evidence: { rule, data, rawResult: null },
      score: null,
    };
  }
}

export default {
  evaluate,
};

