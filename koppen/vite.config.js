import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './', // Makes all generated asset links strictly relative
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: [
      'accomplished-essentials-cons-discs.trycloudflare.com'
    ]
  }
})
