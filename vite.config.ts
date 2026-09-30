import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The browser app. In development Vite serves it on :5173 and proxies /api
 * to the API server on :8787, so the browser sees one origin and the session
 * cookie stays SameSite=Strict. In production the API server serves dist/
 * itself, with the Content-Security-Policy from server/security.ts.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          motion: ['motion'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
})
