import fs from 'fs';
import crypto from 'crypto';
import { KMSClient, VerifyCommand } from '@aws-sdk/client-kms';
import { verifyHashChain } from '../service/src/utils/hashchain';
import { canonicalJson } from '../service/src/utils/canonicalize';

export interface ProofPackage {
  manifest: { range: { from: string; to: string }; entries: number; rootHash: string };
  ledgerLines: string[];
  hashChain: { hash: string }[];
  signatures: { role: string; keyId: string; signature: string; signedAt: string }[];
}

export async function verifyFile(file: string): Promise<boolean> {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as ProofPackage;
  return verifyPackage(pkg);
}

export async function verifyPackage(pkg: ProofPackage): Promise<boolean> {
  const ok = verifyHashChain(pkg.ledgerLines, pkg.hashChain as any);
  if (!ok) {
    throw new Error('Hash chain verification failed');
  }
  const manifestHash = manifestDigest(pkg);
  const payloadHash = pkg.hashChain.length ? pkg.hashChain[pkg.hashChain.length - 1].hash : '';
  await verifyWithKms(pkg.signatures, manifestHash, payloadHash);
  console.log('Verification succeeded for', canonicalJson({ range: pkg.manifest.range, entries: pkg.manifest.entries }));
  return true;
}

function manifestDigest(pkg: ProofPackage): string {
  const manifestJson = canonicalJson(pkg.manifest);
  return crypto.createHash('sha256').update(manifestJson).digest('hex');
}

async function verifyWithKms(signatures: ProofPackage['signatures'], manifestHash: string, payloadHash: string): Promise<void> {
  if (!signatures.length) {
    throw new Error('No signatures present');
  }
  const client = new KMSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.KMS_ENDPOINT,
  });
  for (const signature of signatures) {
    const payload = canonicalJson({ manifestHash, payloadHash, role: signature.role });
    const message = Buffer.from(payload, 'utf8');
    const command = new VerifyCommand({
      KeyId: signature.keyId,
      Message: message,
      Signature: Buffer.from(signature.signature, 'base64'),
      SigningAlgorithm: 'RSASSA_PSS_SHA_256',
      MessageType: 'RAW',
    });
    const result = await client.send(command);
    if (!result.SignatureValid) {
      throw new Error(`Signature invalid for role ${signature.role}`);
    }
  }
}

if (require.main === module) {
  const [file] = process.argv.slice(2);
  if (!file) {
    console.error('Usage: audit_verifier_cli <proof_package.json>');
    process.exit(1);
  }
  verifyFile(file).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
