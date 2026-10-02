/* Service Worker：ネットワーク優先・失敗時キャッシュ（更新が即反映され、オフラインでも動く） */
const CACHE = 'tr-select-v43';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/calc.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  // HTTP キャッシュ（GitHub Pages は max-age=600）を通さず最新を取得
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') { return; }
  const same = new URL(e.request.url).origin === self.location.origin;
  // 同一オリジンは毎回サーバーに再検証（no-cache：変更なしなら 304 で軽い）。更新が即反映される
  e.respondWith(
    fetch(same ? e.request.url : e.request, same ? { cache: 'no-cache', credentials: 'same-origin' } : undefined).then(function (res) {
      if (res && res.ok && same) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
