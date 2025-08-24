// service-worker.js

const CACHE_NAME = "pwa-cadastro-v1";
const urlsToCache = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./dist/main.js"
];

// Instala e armazena arquivos no cache
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
  console.log("Service Worker instalado");
});

// Ativação do SW
self.addEventListener("activate", event => {
  console.log("Service Worker ativado");
});

// Intercepta requisições e responde com cache se offline
self.addEventListener("fetch", event => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
