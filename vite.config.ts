/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  build: { target: 'es2022' },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.{js,ts}'] },
});
