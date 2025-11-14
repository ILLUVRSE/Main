import policyStore from '../src/services/policyStore';
import simulator from '../src/services/simulator';
import { handlePolicyPost } from '../src/routes/policy';

jest.mock('../src/services/policyStore');
jest.mock('../src/services/simulator');

const mockedPolicyStore = policyStore as jest.Mocked<typeof policyStore>;
const mockedSimulator = simulator as jest.Mocked<typeof simulator>;

describe('POST /sentinelnet/policy (simulate)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('runs simulation and returns impact report', async () => {
    const createdPolicy = {
      id: 'policy-xyz',
      name: 'test',
      version: 1,
      severity: 'LOW',
      rule: {},
      metadata: {},
      state: 'draft',
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
    };
    const simPolicy = { ...createdPolicy, state: 'simulating' };
    mockedPolicyStore.createPolicy.mockResolvedValue(createdPolicy as any);
    mockedPolicyStore.setPolicyState.mockResolvedValue(simPolicy as any);
    mockedSimulator.runSimulation.mockResolvedValue({
      policyId: createdPolicy.id,
      sampleSize: 10,
      matched: 2,
      matchRate: 0.2,
      examples: [],
    });

    const res = await handlePolicyPost({
      name: 'test',
      severity: 'LOW',
      rule: { '==': [{ var: 'action' }, 'x'] },
      simulate: true,
      sampleSize: 10,
    });

    expect(res.status).toBe(201);
    expect(res.body.policy?.state).toBe('simulating');
    expect(res.body.simulation).toBeDefined();
    expect(mockedSimulator.runSimulation).toHaveBeenCalledWith(createdPolicy.id, {
      sampleSize: 10,
      sampleEvents: undefined,
    });
  });
});
