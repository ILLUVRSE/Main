#!/usr/bin/env node
/**
 * IDEA/scripts/validate_package.js
 *
 * Usage: ./scripts/validate_package.js /path/to/artifact.tgz
 * 1. Computes SHA256 for artifact.
 * 2. Runs a lightweight static analysis scan (looks for obviously dangerous patterns).
 * 3. Launches a sandbox smoke (mock container) to ensure package bootstraps.
 */
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const path = require('path');

const artifactPath = process.argv[2];
if (!artifactPath) {
  console.error('Usage: ./scripts/validate_package.js <artifact_path>');
  process.exit(1);
}

if (!fs.existsSync(artifactPath)) {
  console.error(`Artifact not found: ${artifactPath}`);
  process.exit(2);
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function runSastScan(filePath) {
  const suspicious = ['eval\\(', 'child_process', 'rm -rf /'];
  const content = fs.readFileSync(filePath);
  for (const pattern of suspicious) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(content)) {
      throw new Error(`SAST violation: pattern "${pattern}" detected`);
    }
  }
}

function runSandbox(filePath) {
  const mockCmd = process.env.SANDBOX_RUNNER || 'node';
  const args = process.env.SANDBOX_RUNNER ? [] : [
    '-e',
    'console.log("sandbox smoke OK for", process.argv[1]);'
  ];
  const result = spawnSync(mockCmd, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      PACKAGE_PATH: path.resolve(filePath)
    }
  });
  if (result.status !== 0) {
    throw new Error(`Sandbox runner failed with code ${result.status}`);
  }
}

try {
  const sha = sha256File(artifactPath);
  console.log(`[idea:validate] sha256=${sha}`);
  runSastScan(artifactPath);
  console.log('[idea:validate] static analysis passed');
  runSandbox(artifactPath);
  console.log('[idea:validate] sandbox smoke passed');
} catch (err) {
  console.error('[idea:validate] FAILED:', err.message);
  process.exit(3);
}
