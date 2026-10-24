import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase')) {
            return 'firebase'
          }
          if (id.includes('node_modules/xlsx') || id.includes('node_modules/qrcode')) {
            return 'export-tools'
          }
          if (id.includes('/src/pages/AdminDashboard')) {
            return 'admin'
          }
          return undefined
        },
      },
    },
  },
})
