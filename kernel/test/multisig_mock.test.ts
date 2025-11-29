import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import { MultisigService } from '../src/services/multisig';

// Mock DB and Audit
const mockQuery = vi.fn();
const mockAppendAuditEvent = vi.fn();

vi.mock('../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  getClient: vi.fn(),
}));

vi.mock('../src/auditStore', () => ({
  appendAuditEvent: (...args: any[]) => mockAppendAuditEvent(...args),
}));

describe('MultisigService (Mock)', () => {
  let service: MultisigService;

  beforeAll(() => {
    service = new MultisigService();
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  it('should register a signer', async () => {
    const signerId = 'signer-1';
    const publicKey = 'some-pem-key';

    mockQuery.mockResolvedValueOnce({ rows: [] }); // check existing
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: signerId,
      public_key: publicKey,
      role: 'signer',
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    }] }); // insert return

    const signer = await service.registerSigner(signerId, publicKey);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(signer.id).toBe(signerId);
    expect(mockAppendAuditEvent).toHaveBeenCalledWith('multisig.signer.registered', { signerId, role: 'signer' });
  });

  it('should create a proposal', async () => {
    const proposalData = {
      title: 'Upgrade Manifest',
      description: 'Upgrade to v2',
      payload: { version: '2.0.0' },
      createdBy: 'admin'
    };

    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 'prop-1',
      ...proposalData,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date()
    }] });

    const proposal = await service.createProposal(proposalData.title, proposalData.description, proposalData.payload, proposalData.createdBy);

    expect(mockQuery).toHaveBeenCalled();
    expect(proposal.id).toBe('prop-1');
    expect(mockAppendAuditEvent).toHaveBeenCalledWith('multisig.proposal.created', expect.anything());
  });

  it('should fail approval with invalid signature', async () => {
     // Generate keys
     const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const publicKeyPem = publicKey.export({ type: 'pkcs1', format: 'pem' });

    // Mock getProposal
    mockQuery.mockResolvedValueOnce({ rows: [{
        id: 'prop-1',
        title: 'test',
        status: 'pending',
        payload: {},
        created_at: new Date(),
        updated_at: new Date()
    }] });

    // Mock getSigner
    mockQuery.mockResolvedValueOnce({ rows: [{
        id: 'signer-1',
        public_key: publicKeyPem,
        status: 'active'
    }] });

    // Mock verifySignature implicitly via service logic using real crypto, so we need to pass a bad signature
    const badSignature = Buffer.from('bad sig').toString('base64');

    await expect(service.approveProposal('prop-1', 'signer-1', badSignature))
        .rejects.toThrow('Invalid signature');
  });

  it('should approve with valid signature', async () => {
     // Generate keys
     const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const publicKeyPem = publicKey.export({ type: 'pkcs1', format: 'pem' });
    const proposalId = 'prop-1';

    // Sign proposalId
    const sign = crypto.createSign('SHA256');
    sign.update(proposalId);
    sign.end();
    const signature = sign.sign(privateKey, 'base64');

    // Mock getProposal
    mockQuery.mockResolvedValueOnce({ rows: [{
        id: proposalId,
        title: 'test',
        status: 'pending',
        payload: {},
        created_at: new Date(),
        updated_at: new Date()
    }] });

    // Mock getSigner
    mockQuery.mockResolvedValueOnce({ rows: [{
        id: 'signer-1',
        public_key: publicKeyPem,
        status: 'active'
    }] });

    // Mock check existing approval
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Mock insert approval
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Mock check threshold (return 1 approval)
    mockQuery.mockResolvedValueOnce({ rows: [{ proposal_id: proposalId, signer_id: 'signer-1' }] });

    // Mock getProposal (return)
    mockQuery.mockResolvedValueOnce({ rows: [{
        id: proposalId,
        title: 'test',
        status: 'pending',
        payload: {},
        created_at: new Date(),
        updated_at: new Date()
    }] });
    // Mock getApprovals for return
    mockQuery.mockResolvedValueOnce({ rows: [{ proposal_id: proposalId, signer_id: 'signer-1', signature }] });

    const updatedProposal = await service.approveProposal(proposalId, 'signer-1', signature);

    expect(updatedProposal.status).toBe('pending'); // threshold not reached
    expect(mockAppendAuditEvent).toHaveBeenCalledWith('multisig.proposal.approved', { proposalId, signerId: 'signer-1' });
  });
});
