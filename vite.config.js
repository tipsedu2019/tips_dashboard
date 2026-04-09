import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5175,
    open: true
  },
  build: {
    chunkSizeWarningLimit: 1000, // Increase limit to 1000kB to silence warnings
    rollupOptions: {
      input: {
        home: path.resolve(__dirname, 'index.html'),
        admin: path.resolve(__dirname, 'admin/index.html'),
        classes: path.resolve(__dirname, 'classes/index.html'),
        reviews: path.resolve(__dirname, 'reviews/index.html'),
        results: path.resolve(__dirname, 'results/index.html'),
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return;
          }

          if (id.includes('react') || id.includes('scheduler')) {
            return 'react-vendor';
          }

          if (id.includes('@supabase')) {
            return 'supabase-vendor';
          }

          if (id.includes('lucide-react')) {
            return 'icon-vendor';
          }
        },
      },
    },
  }
})
