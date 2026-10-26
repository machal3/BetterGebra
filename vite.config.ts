/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // "@/components/ui/…" as the shadcn CLI writes the Affect UI imports
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173 },
  build: { target: 'es2022' },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.{js,ts}'] },
});
