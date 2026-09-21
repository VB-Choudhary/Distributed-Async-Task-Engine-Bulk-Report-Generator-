// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use the Node environment (no browser globals needed)
    environment: 'node',

    // Load .env before tests run so env.ts has values to validate.
    setupFiles: ['dotenv/config'],

    // Collect coverage from src/ only, never from tests/ or dist/
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/api/server.ts'], // server.ts is an entry point, not unit-testable
    },
  },
});
