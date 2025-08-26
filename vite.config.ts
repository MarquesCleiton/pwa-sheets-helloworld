import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/pwa-sheets-helloworld/',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        cadastro: 'src/presentation/pages/cadastro.html',
        consulta: 'src/presentation/pages/consulta.html',
        navbar: 'src/presentation/componentes/navbar.html',
        
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Vafyndell',
        short_name: 'Vafyndell',
        start_url: '/pwa-sheets-helloworld/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0d6efd',
        icons: [
          {
            src: 'Vafyndell-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'Vafyndell-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  server: {
    port: 3000
  }
});
