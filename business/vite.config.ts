import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// The dashboard talks to the business API: in development through the proxy below to a local
// business-api; in staging and production the host passes /api on, so the session cookie stays
// first-party. ?demo (or VITE_API_MODE=preview) shows the sample data instead.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // An empty PostCSS config stops Vite searching upward and finding the Expo
  // app's Tailwind 3 setup one folder up; Tailwind 4 runs as a plugin here.
  css: { postcss: {} },
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:4100' },
  },
})
