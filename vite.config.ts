import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Se preferir, pode usar 'path' para paths absolutos no rollupOptions.input
// import { resolve } from 'path';

export default defineConfig({
  // Seu projeto roda/publish em subpasta (ex.: GitHub Pages)
  base: '/pwa-sheets-helloworld/',

  // IMPORTANTE: trata como multi-página (desativa SPA fallback do dev server)
  appType: 'mpa',

  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        cadastro: 'src/presentation/pages/cadastro.html',
        consulta: 'src/presentation/pages/consulta.html',
        editar:   'src/presentation/pages/editar.html',
        // navbar:   'src/presentation/componentes/navbar.html',
        // Se preferir com resolve():
        // main: resolve(__dirname, 'index.html'),
        // consulta: resolve(__dirname, 'src/presentation/pages/consulta.html'),
        // editar: resolve(__dirname, 'src/presentation/pages/editar.html'),
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
        start_url: '/pwa-sheets-helloworld/',   // mantém coerente com base
        display: 'standalone',
        background_color: '#272727ff',
        theme_color: '#272727ff',
        icons: [
          { src: 'Vafyndell-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'Vafyndell-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      // Evita que o service worker redirecione suas páginas MPA para index.html
      workbox: {
        // Quando navegar para essas páginas, NÃO faça fallback para index.html
        navigateFallbackDenylist: [
          // ajuste os caminhos considerando a base '/pwa-sheets-helloworld/'
          /\/pwa-sheets-helloworld\/src\/presentation\/pages\/consulta\.html/,
          /\/pwa-sheets-helloworld\/src\/presentation\/pages\/editar\.html/,
          /\/pwa-sheets-helloworld\/src\/presentation\/pages\/cadastro\.html/,
        ],
      },
    })
  ],

  server: {
    port: 3000
  }
});
