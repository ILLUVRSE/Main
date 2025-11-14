// sentinelnet/src/routes/check.ts
import { Router, Request, Response } from 'express';
import logger from '../logger';
import decisionService from '../services/decisionService';

const router = Router();

export interface CheckRouteInput {
  action?: string;
  actor?: any;
  resource?: any;
  context?: any;
  requestId?: string | null;
}

export interface RouteResult<T = any> {
  status: number;
  body: T;
}

export async function processCheckRequest(input: CheckRouteInput): Promise<RouteResult> {
  const action = typeof input.action === 'string' ? input.action : undefined;
  if (!action) {
    return { status: 400, body: { error: 'action is required' } };
  }

  try {
    const decision = await decisionService.evaluateAction({
      action,
      actor: input.actor,
      resource: input.resource,
      context: input.context,
      requestId: input.requestId ?? null,
    });
    return { status: 200, body: decision };
  } catch (err: any) {
    logger.error('sentinel check failed', err);
    if (err?.decision && typeof err.decision === 'object') {
      return { status: 403, body: { error: 'policy.denied', decision: err.decision } };
    }
    return { status: 500, body: { error: err?.message || 'internal_server_error' } };
  }
}

router.post('/', async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const headerRequestId = req.headers['x-request-id'];
  const headerRequestIdValue = Array.isArray(headerRequestId) ? headerRequestId[0] : headerRequestId;
  const requestId =
    body.requestId ||
    body.context?.requestId ||
    body.context?.request_id ||
    headerRequestIdValue ||
    null;

  const result = await processCheckRequest({
    action: body.action,
    actor: body.actor,
    resource: body.resource,
    context: body.context,
    requestId,
  });
  return res.status(result.status).json(result.body);
});

export default router;
