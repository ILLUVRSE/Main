import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vitest config for Illuvrse Marketplace UI.
 *
 * - Uses jsdom environment for React component tests.
 * - Sets up a testMatch pattern for unit tests under `tests/unit`.
 * - Provides `@/` alias to src for convenience.
 * - Includes a setup file for testing-library and global mocks.
 */

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@/components': path.resolve(__dirname, 'src/components'),
      '@/lib': path.resolve(__dirname, 'src/lib'),
      '@/tests': path.resolve(__dirname, 'tests'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(__dirname, 'tests/setupTests.ts')],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'c8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      all: true,
      include: ['src/**/*.{ts,tsx}'],
    },
    watch: false,
    testTimeout: 5000,
  },
});

