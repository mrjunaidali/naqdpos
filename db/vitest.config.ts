import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // One shared test database: files run one after another.
    fileParallelism: false,
  },
});
