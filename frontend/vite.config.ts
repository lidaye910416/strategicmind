import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend target: configurable via VITE_API_TARGET or BACKEND_PORT env var.
// Defaults to 8000 (matching run_server.py default).
const API_TARGET = process.env.VITE_API_TARGET
  || `http://localhost:${process.env.BACKEND_PORT || '8000'}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
})
