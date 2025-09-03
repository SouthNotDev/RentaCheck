import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      // Proxy API calls during dev to avoid CORS
      '/api': {
        target: process.env.VITE_PROXY_API || 'http://localhost:3000',
        changeOrigin: true,
        // Preserve path
        rewrite: (p) => p,
      },
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});