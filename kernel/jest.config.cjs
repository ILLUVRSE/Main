// kernel/jest.config.cjs
const enforceCoverage =
  (process.env.CI || '').toLowerCase() === 'true' ||
  (process.env.ENFORCE_COVERAGE || '').toLowerCase() === 'true';

/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/test', '<rootDir>/integration'],
  testMatch: ['**/*.test.ts'],
  verbose: true,
  clearMocks: true,
  moduleFileExtensions: ['ts', 'js', 'json'],
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json'
    }
  },
  // Increase default timeout for slow CI machines if needed; tests are small so keep low.
  testTimeout: 10000,
  collectCoverage: true,
  collectCoverageFrom: [
    'src/auditStore.ts',
    'src/audit/auditPolicy.ts',
    'src/signingProxy.ts',
    'src/internal/multisig.ts',
    'src/rbac.ts',
  ],
  coverageReporters: ['text', 'lcov'],
};

if (enforceCoverage) {
  config.coverageThreshold = {
    'src/auditStore.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
    'src/audit/auditPolicy.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
    'src/signingProxy.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
    'src/internal/multisig.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
    'src/rbac.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
  };
}

module.exports = config;
