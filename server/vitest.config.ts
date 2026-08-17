import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The DB-backed suites (migrate, api) drop and rebuild the same schema;
    // files must never run concurrently against it.
    fileParallelism: false,
  },
});
