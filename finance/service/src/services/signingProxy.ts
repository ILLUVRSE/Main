import { KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { canonicalJson } from '../utils/canonicalize';

export interface SignRequest {
  manifestHash: string;
  payloadHash: string;
  requiredRoles: string[];
}

export interface SignatureRecord {
  role: string;
  keyId: string;
  signature: string;
  signedAt: string;
}

export interface SigningProxyOptions {
  region: string;
  endpoint?: string;
  keyId?: string;
  roleKeyMap?: Record<string, string>;
}

export interface ApprovalInput {
  role: string;
  signer: string;
}

export class SigningProxy {
  private readonly client: KMSClient;
  private readonly defaultKeyId?: string;
  private readonly roleKeyMap: Record<string, string>;

  constructor(options: SigningProxyOptions) {
    if (!options.region) throw new Error('SigningProxy requires AWS region');
    this.client = new KMSClient({ region: options.region, endpoint: options.endpoint });
    this.defaultKeyId = options.keyId;
    this.roleKeyMap = options.roleKeyMap ?? {};
  }

  async sign(request: SignRequest, approvals: ApprovalInput[]): Promise<SignatureRecord[]> {
    const missing = request.requiredRoles.filter((role) => !approvals.some((approval) => approval.role === role));
    if (missing.length) {
      throw new Error(`Missing approvals for roles: ${missing.join(', ')}`);
    }
    const payloadBufferByRole = new Map<string, Buffer>();
    const signatures: SignatureRecord[] = [];
    for (const approval of approvals) {
      const keyId = this.resolveKeyId(approval.role);
      const payload = canonicalJson({
        manifestHash: request.manifestHash,
        payloadHash: request.payloadHash,
        role: approval.role,
      });
      const payloadBuffer = payloadBufferByRole.get(approval.role) ?? Buffer.from(payload, 'utf8');
      payloadBufferByRole.set(approval.role, payloadBuffer);
      const command = new SignCommand({
        KeyId: keyId,
        Message: payloadBuffer,
        MessageType: 'RAW',
        SigningAlgorithm: 'RSASSA_PSS_SHA_256',
      });
      const { Signature } = await this.client.send(command);
      if (!Signature) throw new Error('KMS signing failed: no signature');
      signatures.push({
        role: approval.role,
        keyId,
        signature: Buffer.from(Signature).toString('base64'),
        signedAt: new Date().toISOString(),
      });
    }
    return signatures;
  }

  private resolveKeyId(role: string): string {
    const keyId = this.roleKeyMap[role] ?? this.defaultKeyId;
    if (!keyId) {
      throw new Error(`No KMS key configured for role ${role}`);
    }
    return keyId;
  }
}
