const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.tsx"],
  testEnvironment: "jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  collectCoverageFrom: ["components/**/*.{ts,tsx}", "pages/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
  testPathIgnorePatterns: ["<rootDir>/tests/e2e/"],
};

module.exports = createJestConfig(customJestConfig);
