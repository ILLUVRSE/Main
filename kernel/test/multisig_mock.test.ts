
import { MultisigService } from '../src/services/multisig';

// Mock DB
const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockClient = {
  query: mockQuery,
  release: mockRelease,
};
const mockGetClient = jest.fn().mockResolvedValue(mockClient);

jest.mock('../src/db', () => ({
  query: mockQuery,
  getClient: mockGetClient,
}));

// Mock auditStore
jest.mock('../src/auditStore', () => ({
  appendAuditEvent: jest.fn().mockResolvedValue({ id: 'audit-id' }),
}));

// Mock crypto.createVerify
const mockVerify = {
  update: jest.fn(),
  end: jest.fn(),
  verify: jest.fn().mockReturnValue(true),
};
jest.mock('crypto', () => {
  const original = jest.requireActual('crypto');
  return {
    ...original,
    createVerify: jest.fn().mockReturnValue(mockVerify),
    randomUUID: original.randomUUID,
  };
});

import { multisigService } from '../src/services/multisig';

describe('MultisigService (Unit with Mocks)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerify.verify.mockReturnValue(true); // Default valid
  });

  it('should create a proposal', async () => {
    const proposalData = {
      id: 'uuid-1',
      proposal_id: 'prop-1',
      proposer_id: 'user-1',
      payload: {},
      required_threshold: 3,
      signer_set: ['s1', 's2', 's3', 's4', 's5'],
      status: 'proposed'
    };

    mockQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [proposalData] }); // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await multisigService.createProposal('prop-1', 'user-1', {}, ['s1', 's2', 's3', 's4', 's5']);

    expect(result).toEqual(proposalData);
  });

  it('should approve a proposal', async () => {
    const proposal = {
      id: 'uuid-1',
      required_threshold: 3,
      signer_set: ['s1', 's2', 's3'],
      status: 'proposed'
    };

    // Sequence: BEGIN, SELECT proposal, SELECT signer, INSERT approval, SELECT count, COMMIT
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [proposal] }) // SELECT proposal
      .mockResolvedValueOnce({ rows: [{ public_key: 'pk' }] }) // SELECT signer
      .mockResolvedValueOnce({ rows: [{ id: 'app-1' }] }) // INSERT approval
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // SELECT count
      .mockResolvedValueOnce({}); // COMMIT

    await multisigService.approveProposal('uuid-1', 's1', 'sig-1');

    expect(mockQuery).toHaveBeenCalledTimes(6);
  });

  it('should reject invalid signature', async () => {
    const proposal = {
      id: 'uuid-1',
      required_threshold: 3,
      signer_set: ['s1'],
      status: 'proposed'
    };

    // Sequence: BEGIN, SELECT proposal, SELECT signer
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [proposal] }) // SELECT proposal
      .mockResolvedValueOnce({ rows: [{ public_key: 'pk' }] }); // SELECT signer

    mockVerify.verify.mockReturnValueOnce(false); // INVALID

    await expect(multisigService.approveProposal('uuid-1', 's1', 'bad-sig'))
      .rejects.toThrow('Signature verification failed');

    expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('should transition to approved when threshold met', async () => {
    const proposal = {
      id: 'uuid-1',
      required_threshold: 3,
      signer_set: ['s1', 's2', 's3'],
      status: 'proposed'
    };

    // Sequence: BEGIN, SELECT proposal, SELECT signer, INSERT approval, SELECT count, UPDATE status, COMMIT
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [proposal] }) // SELECT proposal
      .mockResolvedValueOnce({ rows: [{ public_key: 'pk' }] }) // SELECT signer
      .mockResolvedValueOnce({ rows: [{ id: 'app-3' }] }) // INSERT approval
      .mockResolvedValueOnce({ rows: [{ count: '3' }] }) // SELECT count
      .mockResolvedValueOnce({}) // UPDATE status
      .mockResolvedValueOnce({}); // COMMIT

    await multisigService.approveProposal('uuid-1', 's3', 'sig-3');

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE multisig_proposals'), expect.anything());
  });

  it('should fail apply if not approved', async () => {
    const proposal = {
      id: 'uuid-1',
      required_threshold: 3,
      status: 'proposed' // Not approved
    };

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [proposal] }) // SELECT proposal
      .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // SELECT count (double check)
      .mockResolvedValueOnce({}); // ROLLBACK (on error)

    await expect(multisigService.applyProposal('uuid-1', 'user-1'))
        .rejects.toThrow('Insufficient approvals');

    expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
  });
});
