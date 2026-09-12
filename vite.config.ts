import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri serves the dev server on a fixed port and expects the build output in
// `dist/`. `envPrefix` lets us surface a few NOTES_MJ_* knobs to the UI; secrets stay
// in the backend, which reads `.env` itself.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  envPrefix: ['VITE_', 'NOTES_MJ_PUBLIC_'],
  server: {
    port: 5183,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'chrome110',
    sourcemap: true,
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: 'verbose',
  },
});
