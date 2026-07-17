import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://vytalcare-scy4.onrender.com/health',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path
      }
    }
  }
})