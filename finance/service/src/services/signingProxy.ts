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

export class SigningProxy {
  constructor(private kmsEndpoint: string) {}

  async sign(request: SignRequest, approvals: SignatureRecord[]): Promise<SignatureRecord[]> {
    const missingRoles = request.requiredRoles.filter((role) => !approvals.find((sig) => sig.role === role));
    if (missingRoles.length) {
      throw new Error(`Missing approvals for roles: ${missingRoles.join(', ')}`);
    }

    return approvals.map((approval) => ({
      ...approval,
      keyId: `${this.kmsEndpoint}/${approval.role}`,
      signature: approval.signature || `signed:${request.manifestHash}:${approval.role}`,
      signedAt: approval.signedAt || new Date().toISOString(),
    }));
  }
}
