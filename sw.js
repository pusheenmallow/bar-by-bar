// Keeps the app working with no internet. Scores and progress are never touched here:
// they stay in the browser's database on this device.
const VERSION = 'e38cca63dd';
const CACHE = `bar-by-bar-${VERSION}`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/ui.js', 'js/model.js', 'js/store.js', 'js/session.js', 'js/images.js', 'js/metronome.js', 'js/sound.js', 'js/clock.js', 'js/theme.js',
  'js/detect-client.js', 'js/detect-core.js', 'js/detect-worker.js',
  'js/screens/home.js', 'js/screens/player.js', 'js/screens/map.js', 'js/screens/trainer.js', 'js/screens/check.js',
  'js/screens/whole.js', 'js/screens/stats.js', 'js/screens/score.js',
  'js/screens/common.js', 'js/screens/pick.js', 'js/screens/parent.js', 'js/screens/add.js', 'js/screens/review.js', 'js/screens/settings.js',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs',
  'fonts/lexend.woff2', 'fonts/music-signs.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('bar-by-bar-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'update') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith((async () => {
    const hit = await caches.match(event.request, { ignoreSearch: true });
    if (hit) return hit;
    if (event.request.mode === 'navigate') return caches.match('index.html');
    return fetch(event.request);
  })());
});
