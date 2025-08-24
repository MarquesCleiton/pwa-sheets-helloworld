import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/pwa-sheets-helloworld/',
  plugins: [
    react(),
  ],
    server: {
    port: 3000
  }
});
