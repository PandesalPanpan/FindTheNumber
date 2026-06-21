import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    host: true,
    proxy: {
      // mirror the production nginx: same-origin /ws -> signaling server
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
