import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@tsunagi/ds2-core': fileURLToPath(new URL('./packages/ds2-core/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // packages/: the vendored ds2-core brings its own co-located tests, and they run here too -
    // they are what proves the copy works under this repository's TypeScript and vitest.
    include: ['test/**/*.test.ts', 'packages/**/*.test.ts'],
  },
});
