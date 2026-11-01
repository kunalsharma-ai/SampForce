import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests only; Playwright owns e2e/. The alias matches tsconfig's "@/*" paths.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
