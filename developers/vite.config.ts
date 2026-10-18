import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// The developer docs: docs.usemoneymoves.xyz. A static site - every page is in src/pages.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // An empty PostCSS config stops Vite finding the Expo app's Tailwind 3 setup one folder up.
  css: { postcss: {} },
  server: { port: 5176 },
  preview: { port: 5177 },
})
