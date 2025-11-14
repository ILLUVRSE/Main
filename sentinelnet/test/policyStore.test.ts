// sentinelnet/test/policyStore.test.ts
/**
 * Unit tests for policyStore using a mocked DB layer.
 *
 * We mock sentinelnet/src/db/index.ts `query` function to return expected rows.
 */

import policyStore from '../src/services/policyStore';
import db from '../src/db';
import { Policy } from '../src/models/policy';

// jest mock for db.query
jest.mock('../src/db', () => {
  return {
    query: jest.fn(),
  };
});

const mockedDb = db as any;

describe('policyStore', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('createPolicy inserts and returns mapped policy', async () => {
    const input = {
      name: 'test-policy',
      severity: 'MEDIUM' as const,
      rule: { '==': [{ var: 'foo' }, 'bar'] },
      metadata: { effect: 'deny' },
      createdBy: 'tester',
    };

    const fakeRow = {
      id: '1111-2222',
      name: input.name,
      version: 1,
      severity: input.severity,
      rule: input.rule,
      metadata: input.metadata,
      state: 'draft',
      created_by: input.createdBy,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockedDb.query.mockResolvedValueOnce({ rows: [fakeRow] });

    const out = await policyStore.createPolicy(input);

    expect(out).toBeDefined();
    expect(out.id).toBe(String(fakeRow.id));
    expect(out.name).toBe(input.name);
    expect(out.version).toBe(1);
    expect(out.severity).toBe(input.severity);
    expect(out.rule).toEqual(input.rule);
    expect(out.metadata).toEqual(input.metadata);
    expect(out.state).toBe('draft');

    expect(mockedDb.query).toHaveBeenCalled();
  });

  test('getPolicyById returns policy when found', async () => {
    const id = '2222-3333';
    const row = {
      id,
      name: 'found-policy',
      version: 2,
      severity: 'HIGH',
      rule: { some: 'rule' },
      metadata: {},
      state: 'active',
      created_by: 'creator',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockedDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [row] });

    const p = await policyStore.getPolicyById(id);
    expect(p).not.toBeNull();
    expect(p?.id).toBe(String(row.id));
    expect(p?.name).toBe('found-policy');

    expect(mockedDb.query).toHaveBeenCalled();
  });

  test('getPolicyById returns null when not found', async () => {
    mockedDb.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const p = await policyStore.getPolicyById('no-such-id');
    expect(p).toBeNull();
  });

  test('updatePolicyInPlace updates and returns policy', async () => {
    const policyId = '3333-4444';
    const updatedRow = {
      id: policyId,
      name: 'policy-x',
      version: 1,
      severity: 'MEDIUM',
      rule: { new: 'rule' },
      metadata: { canaryPercent: 10 },
      state: 'canary',
      created_by: 'creator',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockedDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [updatedRow] });

    const updated = await policyStore.updatePolicyInPlace(policyId, {
      metadata: updatedRow.metadata,
      state: 'canary',
    });

    expect(updated).toBeDefined();
    expect(updated.id).toBe(policyId);
    expect(updated.state).toBe('canary');
    expect(updated.metadata).toEqual(updatedRow.metadata);

    expect(mockedDb.query).toHaveBeenCalled();
  });

  test('listPolicies returns mapped policies', async () => {
    const rows = [
      {
        id: 'a1',
        name: 'p1',
        version: 1,
        severity: 'LOW',
        rule: { a: 1 },
        metadata: {},
        state: 'active',
        created_by: 'c',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'a2',
        name: 'p2',
        version: 1,
        severity: 'HIGH',
        rule: { b: 2 },
        metadata: {},
        state: 'active',
        created_by: 'c',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    mockedDb.query.mockResolvedValueOnce({ rows });

    const list = await policyStore.listPolicies({ state: 'active' });
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('a1');
    expect(list[1].id).toBe('a2');

    expect(mockedDb.query).toHaveBeenCalled();
  });

  test('createPolicyNewVersion bumps version and records history entries', async () => {
    const existingRow = {
      id: 'base-pol',
      name: 'policy',
      version: 1,
      severity: 'HIGH',
      rule: { '==': [{ var: 'action' }, 'foo'] },
      metadata: { effect: 'deny' },
      state: 'active',
      created_by: 'creator',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const newRow = {
      ...existingRow,
      id: 'new-pol',
      version: 2,
      rule: { '==': [{ var: 'action' }, 'bar'] },
    };

    mockedDb.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [existingRow] }) // getPolicyById
      .mockResolvedValueOnce({ rows: [newRow] }) // insert new version
      .mockResolvedValueOnce({}) // history existing
      .mockResolvedValueOnce({}); // history new

    const updated = await policyStore.createPolicyNewVersion(existingRow.id, { rule: newRow.rule }, 'editor');
    expect(updated.version).toBe(2);
    expect(updated.rule).toEqual(newRow.rule);
    expect(mockedDb.query).toHaveBeenCalledTimes(4);
  });

  test('listPolicies supports states array filter', async () => {
    const rows = [
      { id: 'p1', name: 'one', version: 1, severity: 'LOW', rule: {}, metadata: {}, state: 'active', created_by: null, created_at: new Date(), updated_at: new Date() },
    ];
    mockedDb.query.mockResolvedValueOnce({ rows });

    const list = await policyStore.listPolicies({ states: ['active', 'canary'] });
    expect(list).toHaveLength(1);
    expect(mockedDb.query).toHaveBeenCalledWith(expect.stringContaining('state = ANY'), expect.arrayContaining([['active', 'canary']]));
  });
});
