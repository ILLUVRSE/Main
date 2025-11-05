// kernel/jest.config.cjs
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/test'],
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
  testTimeout: 10000
};

