import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@server': path.resolve(__dirname, './server'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname)],
    },
  },
});
