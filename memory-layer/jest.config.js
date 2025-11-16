/**
 * jest.config.js
 *
 * Jest configuration for the Memory Layer TypeScript tests.
 * Uses ts-jest to transform TypeScript files. Keeps transformation
 * limited to the memory-layer test folders and project sources.
 *
 * This config assumes a `tsconfig.jest.json` exists (next file)
 * that sets `module: commonjs` and appropriate target for Jest.
 */

module.exports = {
  // Use ts-jest preset
  preset: 'ts-jest',

  // Test environment
  testEnvironment: 'node',

  // Only run tests inside the memory-layer test directory
  testMatch: [
    '<rootDir>/memory-layer/test/**/*.test.ts',
    '<rootDir>/memory-layer/test/**/*.spec.ts',
    '<rootDir>/memory-layer/test/integration/**/*.test.ts',
    '<rootDir>/memory-layer/test/integration/**/*.spec.ts'
  ],

  // Transform TypeScript using ts-jest
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },

  // Ignore node_modules except if you need to transform specific packages (rare)
  transformIgnorePatterns: ['/node_modules/'],

  // Module file extensions for imports
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json', 'node'],

  // Use a separate tsconfig for Jest to force CommonJS and avoid ESM issues
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.jest.json',
      diagnostics: {
        // show diagnostics to help debug test-time type problems
        warnOnly: true
      }
    }
  },

  // Increase default timeout for integration tests that may start DB containers
  testTimeout: 60_000,

  // Reporters and verbose
  verbose: true
};

