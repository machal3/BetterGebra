/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // "@/components/ui/…" as the shadcn CLI writes the Affect UI imports
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173 },
  build: {
    target: 'es2022',
    // React in a chunk of its own: it changes far less often than the app, so browsers keep it cached
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }] } } },
  },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.{js,ts}'] },
});
