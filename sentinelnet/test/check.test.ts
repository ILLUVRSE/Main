// sentinelnet/test/check.test.ts
/**
 * Basic integration tests for POST /sentinelnet/check
 *
 * These tests mock the decisionService to avoid DB/Kafka dependencies.
 * They exercise the server routing and error handling.
 *
 */

import { processCheckRequest } from '../src/routes/check';

// jest will hoist mocks, but we explicitly mock the decisionService module used by the route.
jest.mock('../src/services/decisionService');

import decisionService from '../src/services/decisionService';

const mockedDecisionService = decisionService as any;

describe('POST /sentinelnet/check', () => {
  beforeEach(() => {
    // reset mock state
    mockedDecisionService.evaluateAction = jest.fn();
  });

  test('returns 400 when action is missing', async () => {
    const result = await processCheckRequest({});
    expect(result.status).toBe(400);
    expect(result.body).toHaveProperty('error');
  });

  test('returns decision envelope when action is provided', async () => {
    const envelope = {
      decision: 'allow',
      allowed: true,
      ts: new Date().toISOString(),
    };
    mockedDecisionService.evaluateAction.mockResolvedValue(envelope);

    const result = await processCheckRequest({ action: 'kernel.agent.spawn', actor: { id: 'user-1' } });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject(envelope);
    expect(mockedDecisionService.evaluateAction).toHaveBeenCalledWith({
      action: 'kernel.agent.spawn',
      actor: { id: 'user-1' },
      resource: undefined,
      context: undefined,
      requestId: null,
    });
  });

  test('maps decisionService denial to 403 with decision details', async () => {
    const decision = {
      allowed: false,
      decision: 'deny',
      decisionId: 'policy-123:deny',
    };
    // Simulate decisionService throwing a structured error with .decision
    const err: any = new Error('policy.denied');
    err.decision = decision;
    mockedDecisionService.evaluateAction.mockRejectedValue(err);

    const result = await processCheckRequest({ action: 'kernel.agent.spawn' });

    expect(result.status).toBe(403);
    expect(result.body).toHaveProperty('error', 'policy.denied');
    expect(result.body).toHaveProperty('decision');
    expect(result.body.decision).toEqual(decision);
  });
});
