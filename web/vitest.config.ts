import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Frontend unit-test runner. Kept minimal and scoped to *.test.ts(x) so it
 * never picks up app route files. jsdom gives hooks a DOM to render into.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['app/**/*.test.{ts,tsx}'],
  },
});
