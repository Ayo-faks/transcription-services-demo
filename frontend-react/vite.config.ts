import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'exclude-config-local',
      generateBundle(_, bundle) {
        delete bundle['config.local.js'];
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:7072',
      '/.auth': 'http://127.0.0.1:7072',
    },
  },
})
