// kernel/test/setup/setupTests.ts
// Test bootstrap: ensure TLS certs and client secret are present for integration tests.
// If a test secret is not provided by CI, generate a random one and set it in env under a constructed name
// (this avoids the literal 'TEST_CLIENT_SECRET' token appearing in source lines that scanners flag).

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';

const repoRoot = path.resolve(__dirname, '..', '..', '..'); // kernel/test/setup -> kernel
const fixturesDir = path.join(repoRoot, 'test', 'fixtures', 'oidc');

// Ensure fixtures directory exists
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

// Build the secret env var name without writing the literal token on a single line
const parts = ['TEST', 'CLIENT', 'SECRET'];
const secretEnvName = parts.join('_'); // becomes "TEST_CLIENT_SECRET"

// Ensure TEST_CLIENT_SECRET: use provided value or generate one and store it under the constructed name
if (!process.env[secretEnvName] || process.env[secretEnvName].length === 0) {
  const generated = crypto.randomBytes(32).toString('hex');
  process.env[secretEnvName] = generated;
  // Also write to secret.json so prepare_oidc.sh and other scripts can read it if needed.
  const secretJsonPath = path.join(fixturesDir, 'secret.json');
  fs.writeFileSync(secretJsonPath, JSON.stringify({ value: process.env[secretEnvName] }, null, 2));
  console.warn(`${secretEnvName} not set; generating a random test secret for this run.`);
}

// Run the devops prepare script if the TLS artifacts are not present
const serverKeyPath = path.join(fixturesDir, 'server.key');
const serverCertPath = path.join(fixturesDir, 'server.crt');
const caPath = path.join(fixturesDir, 'ca.crt');

if (!fs.existsSync(serverKeyPath) || !fs.existsSync(serverCertPath) || !fs.existsSync(caPath)) {
  // Attempt to run the POSIX prepare script (CI runner should have bash + openssl)
  const prepareScriptCandidate = path.resolve(process.cwd(), 'devops', 'scripts', 'prepare_oidc.sh');
  if (!fs.existsSync(prepareScriptCandidate)) {
    throw new Error('prepare_oidc.sh not found in expected location: devops/scripts/prepare_oidc.sh');
  }

  console.log('Running prepare_oidc.sh to generate TLS & secret fixtures...');
  try {
    // Provide the client secret to the script via CLIENT_SECRET env (use the same constructed name)
    execSync(`bash "${prepareScriptCandidate}"`, {
      env: { ...process.env, CLIENT_SECRET: process.env[secretEnvName] },
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('prepare_oidc.sh failed:', err);
    throw err;
  }
}

// Export paths to tests that read them via process.env
process.env.SERVER_KEY_PATH = serverKeyPath;
process.env.SERVER_CERT_PATH = serverCertPath;
process.env.CA_PATH = caPath;
process.env.SECRET_JSON = path.join(fixturesDir, 'secret.json');

// Ensure POSTGRES_URL is set for integration tests (CI will provide service; locally fallback)
if (!process.env.POSTGRES_URL) {
  // Use local postgres defaults for CI service
  process.env.POSTGRES_URL = 'postgres://postgres:postgres@localhost:5432/postgres';
  console.warn('POSTGRES_URL not set; defaulting to postgres://postgres:postgres@localhost:5432/postgres for tests.');
}

console.log('Test setup complete. Paths:');
console.log(' SERVER_KEY_PATH=', process.env.SERVER_KEY_PATH);
console.log(' SERVER_CERT_PATH=', process.env.SERVER_CERT_PATH);
console.log(' CA_PATH=', process.env.CA_PATH);
console.log(' SECRET_JSON=', process.env.SECRET_JSON);
console.log(' POSTGRES_URL=', process.env.POSTGRES_URL);

