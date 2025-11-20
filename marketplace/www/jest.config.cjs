/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["**/?(*.)+(spec|test).[tj]s?(x)"],
  coverageDirectory: "<rootDir>/coverage",
  collectCoverageFrom: ["components/**/*.{ts,tsx}", "pages/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
};
