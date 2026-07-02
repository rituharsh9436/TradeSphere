import { defineConfig } from 'vitest/config';

// Pure-logic unit tests (node env). UI is verified by manual smoke test.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
