import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    open: true
  },
  build: {
    chunkSizeWarningLimit: 1000, // Increase limit to 1000kB to silence warnings
  }
})
