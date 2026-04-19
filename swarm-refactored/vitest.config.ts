import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
    testTimeout: 60000,
    hookTimeout: 30000,
    setupFiles: ['dotenv/config'],
  },
});
