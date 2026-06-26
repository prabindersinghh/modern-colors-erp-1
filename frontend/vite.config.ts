import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath, URL } from 'node:url'

// Set VITE_HTTPS=true to serve the dev server over HTTPS — required to test the
// phone camera (getUserMedia needs a secure context) from another device on the LAN.
const useHttps = process.env.VITE_HTTPS === 'true'
// Backend origin the dev server proxies /api to.
const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true, // expose on the LAN so a phone can reach it
    https: useHttps ? {} : undefined,
    // Same-origin API: the app calls /api/* and Vite proxies to the backend.
    // Avoids CORS and HTTPS mixed-content issues when testing from a phone.
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
