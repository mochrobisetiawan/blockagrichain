import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy /api ke backend Go (http://localhost:8080) saat development.
// (Backend C# lama memakai :5080 — kini stack utama adalah Go + Fabric asli.)
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
