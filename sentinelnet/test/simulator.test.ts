// sentinelnet/test/simulator.test.ts
/**
 * Unit tests for the simulator.
 *
 * These tests run the simulator against a small, in-memory sampleEvents array.
 * We create a simple policy whose JSONLogic rule matches events with action === "test.action".
 */

import simulator from '../src/services/simulator';
import policyStore from '../src/services/policyStore';

// mock policyStore.getPolicyById to return a test policy
jest.mock('../src/services/policyStore');

const mockedPolicyStore = policyStore as any;

describe('simulator.runSimulation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 0 when no samples available', async () => {
    const id = 'policy-1';
    mockedPolicyStore.getPolicyById.mockResolvedValueOnce({
      id,
      name: 'no-sample-policy',
      version: 1,
      severity: 'LOW',
      rule: { '==': [{ var: 'action' }, 'nonexistent'] },
      metadata: {},
      state: 'active',
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
    });

    // run with no samples provided and no Kernel configured
    const report = await simulator.runSimulation(id, { sampleSize: 10, sampleEvents: [] });
    expect(report).toBeDefined();
    expect(report.sampleSize).toBe(0);
    expect(report.matched).toBe(0);
    expect(report.matchRate).toBe(0);
    expect(report.note).toBeDefined();
  });

  test('computes match rate and examples correctly with provided sampleEvents', async () => {
    const id = 'policy-2';
    // policy rule: match when action == "test.action"
    const policy = {
      id,
      name: 'match-test-action',
      version: 1,
      severity: 'MEDIUM',
      rule: { '==': [{ var: 'action' }, 'test.action'] },
      metadata: {},
      state: 'active',
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
    };

    mockedPolicyStore.getPolicyById.mockResolvedValueOnce(policy);

    // create 6 sample events; 3 of them have action "test.action"
    const sampleEvents = [
      { id: 'e1', payload: { action: 'test.action', info: 1 } },
      { id: 'e2', payload: { action: 'other.action', info: 2 } },
      { id: 'e3', payload: { action: 'test.action', info: 3 } },
      { id: 'e4', payload: { action: 'other.action', info: 4 } },
      { id: 'e5', payload: { action: 'test.action', info: 5 } },
      { id: 'e6', payload: { action: 'other.action', info: 6 } },
    ];

    const report = await simulator.runSimulation(id, { sampleSize: 10, sampleEvents });

    expect(report).toBeDefined();
    expect(report.policyId).toBe(id);
    expect(report.sampleSize).toBe(sampleEvents.length);
    expect(report.matched).toBe(3);
    expect(report.matchRate).toBeCloseTo(3 / sampleEvents.length);
    expect(report.examples.length).toBeGreaterThanOrEqual(1);
    // examples should reference events that matched (their event.id present)
    const exampleIds = report.examples.map((ex) => ex.event?.id);
    expect(exampleIds).toEqual(expect.arrayContaining(['e1', 'e3', 'e5']));
  });
});

