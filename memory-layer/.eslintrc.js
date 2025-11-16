/**
 * .eslintrc.js
 *
 * ESLint configuration for the repository (focus: memory-layer).
 * - Uses @typescript-eslint parser/plugin for TypeScript linting.
 * - Enables recommended rules and Prettier integration.
 * - Keeps some rules lenient during development (e.g., console), but warns on `any` usage.
 *
 * Adjust rule severities as you tighten policy prior to merging.
 */

module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true,
    jest: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    // If you have a top-level tsconfig.json, ESLint can use it for type-aware rules.
    project: ['./tsconfig.json']
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    // Integrate with prettier if you use it
    'plugin:prettier/recommended'
  ],
  rules: {
    // TypeScript niceties
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',

    // General JS rules
    'no-var': 'error',
    'prefer-const': 'error',
    'no-console': 'off', // allow console during development; consider 'warn' for CI
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

    // import resolver rules (turn off unresolved check if your environment has path mapping)
    'import/no-unresolved': 'off'
  },
  settings: {
    'import/resolver': {
      // Use typescript resolver so ESLint understands tsconfig paths
      typescript: {}
    }
  },
  ignorePatterns: ['node_modules/', 'dist/', 'coverage/', 'tmp/']
};

