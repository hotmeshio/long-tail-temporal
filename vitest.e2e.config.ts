import { defineConfig } from 'vitest/config';

// Runs against the docker compose stack: docker compose up -d --build
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: 'forks',
  },
});
