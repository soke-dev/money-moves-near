import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

/**
 * Where `npm run dev` sends /api.
 *
 * It used to be hard-wired to localhost:4000, so opening the admin console
 * without also running the backend gave a wall of ECONNREFUSED and a login
 * screen that could not work. The deployed console talks to the live API, so
 * that is the default here too; point it somewhere else when you actually
 * have a backend running:
 *
 *   VITE_PROXY_TARGET=http://localhost:4000 npm run dev
 */
const LIVE_API = 'https://backend-production-6f042.up.railway.app'

/**
 * Where /business-api goes: the business API the admin console's Business side
 * talks to - staging by default, like public/_redirects. Point it at a local one
 * with VITE_BUSINESS_PROXY_TARGET=http://localhost:4100.
 */
const BUSINESS_API = 'https://business-api-staging.up.railway.app'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_PROXY_TARGET || LIVE_API
  const businessTarget = env.VITE_BUSINESS_PROXY_TARGET || BUSINESS_API

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/business-api': {
          target: businessTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/business-api/, '/api'),
        },
        '/api': {
          target,
          changeOrigin: true,
          // The live API sits behind TLS; without this the upstream request
          // carries the dev host and Railway answers with its own 404 page.
          secure: true,
        },
      },
    },
  }
})
