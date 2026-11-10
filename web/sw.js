/**
 * Service worker : met en cache l'« enveloppe » de l'app (HTML, JS, icônes) pour qu'elle s'ouvre vite.
 * Les données (Supabase) et les recherches ISBN ne passent jamais par ce cache.
 * Après une modification des fichiers de web/, augmente VERSION pour que les téléphones prennent la nouvelle version.
 */
const VERSION = 'biblio-v2';
const SHELL = ['./', 'index.html', 'api.js', 'isbn.js', 'scanner.js', 'config.js', 'manifest.webmanifest',
               'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Réseau d'abord (on a toujours la dernière version en ligne), cache si hors connexion.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && !url.search) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
