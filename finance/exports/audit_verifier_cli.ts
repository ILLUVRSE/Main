import fs from 'fs';
import { verifyHashChain } from '../service/src/utils/hashchain';
import { canonicalJson } from '../service/src/utils/canonicalize';

interface ProofPackage {
  ledgerLines: string[];
  hashChain: { hash: string }[];
  signatures: { role: string }[];
}

function verify(file: string): boolean {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as ProofPackage;
  const ok = verifyHashChain(pkg.ledgerLines, pkg.hashChain as any);
  if (!ok) {
    throw new Error('Hash chain verification failed');
  }
  if (!pkg.signatures.length) {
    throw new Error('No signatures present');
  }
  console.log('Verification succeeded for', canonicalJson({ file }));
  return true;
}

if (require.main === module) {
  const [file] = process.argv.slice(2);
  if (!file) {
    console.error('Usage: audit_verifier_cli <proof_package.json>');
    process.exit(1);
  }
  verify(file);
}
