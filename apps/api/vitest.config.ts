import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // *.db.test.ts need naqdpos_test and run with `pnpm db:test`; they share one database.
    fileParallelism: false,
  },
});
