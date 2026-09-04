import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    esbuild: { jsx: 'automatic' },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
