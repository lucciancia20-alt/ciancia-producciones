import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Aislar face-api y tensorflow en su propio chunk diferido
            if (id.includes('@vladmandic/face-api') || id.includes('@tensorflow')) {
              return 'face-api-engine';
            }
            // Firebase en chunk separado
            if (id.includes('firebase')) {
              return 'firebase-core';
            }
            // Lucide icons en chunk separado
            if (id.includes('lucide-react')) {
              return 'lucide-icons';
            }
            // React y React Router en chunk base
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'react-framework';
            }
          }
        },
      },
    },
  },
});
