const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

const customConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.tsx"],
  testEnvironment: "jest-environment-jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  collectCoverageFrom: ["src/**/*.{ts,tsx}"],
  testPathIgnorePatterns: ["<rootDir>/e2e/"],
};

module.exports = createJestConfig(customConfig);
