import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      include: [
        'packages/web-client/src/runtime/**',
        'packages/scheduler-service/src/**'
      ],
      reporter: ['text', 'json-summary']
    }
  }
});
