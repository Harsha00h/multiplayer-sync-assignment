import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The client imports /shared/protocol.ts, which lives outside this package root.
    fs: { allow: ['..'] },
  },
  build: { outDir: 'dist', sourcemap: true },
});
