import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // Module workers (MapLibre's is an ES module that shares code with the main bundle).
  worker: { format: 'es' },
  server: {
    port: 5173,
    // In dev, the FastAPI backend runs on :8000; proxy API calls so the app is same-origin.
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
