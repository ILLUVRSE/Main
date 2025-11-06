// kernel/test/setup/setupTests.ts
// Jest setup for Kernel unit+integration tests.
// - Ensure test-mode env flags
// - Make Node trust the local test CA (if present)
// - Reset sentinel client between tests

/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { resetSentinelClient } from '../../src/sentinelClient';

// Ensure tests run in test mode and test endpoints are enabled
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ENABLE_TEST_ENDPOINTS = process.env.ENABLE_TEST_ENDPOINTS || 'true';

// If CI/local cert dir exists, set NODE_EXTRA_CA_CERTS so Node trusts the test CA
const certDir = process.env.ILLUVRSE_CERT_DIR || '/tmp/illuvrse-certs';
const caPath = path.join(certDir, 'kernel-ca.crt');
if (fs.existsSync(caPath)) {
  process.env.NODE_EXTRA_CA_CERTS = caPath;
  // Helpful debug for local runs
  // eslint-disable-next-line no-console
  console.info(`[test setup] NODE_EXTRA_CA_CERTS set to ${caPath}`);
} else {
  // eslint-disable-next-line no-console
  console.info(`[test setup] no test CA found at ${caPath}; TLS tests may require NODE_TLS_REJECT_UNAUTHORIZED=0`);
}

// Reset sentinel client between tests to avoid cross-test leakage
beforeEach(() => {
  try {
    resetSentinelClient();
  } catch (e) {
    // ignore
  }
});

// Optional: ensure env is cleaned up after all tests (keeps global state tidy)
afterAll(() => {
  try {
    resetSentinelClient();
  } catch (e) {
    // ignore
  }
});

