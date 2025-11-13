/** jest.config.cjs
 *
 * Basic Jest configuration for a TypeScript Node project using ts-jest.
 * Adjust `testMatch` if you place tests in a different folder.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts', '**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
      diagnostics: false
    }
  },
  collectCoverage: false,
  restoreMocks: true,
  setupFiles: ['dotenv/config'],
  // useful for longer-running tests to increase default timeout
  testTimeout: 30000
};

