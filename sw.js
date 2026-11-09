'use strict';

/* 只缓存「外壳」，聊天请求永远走网络。
   某项资源缺失也不会让安装失败；更新时改 CACHE 里的版本号。 */

const CACHE = 'hilvi-shell-v4';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './persona.js',
  './style.css',
  './manifest.json',
  './avatar.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 逐个缓存：任何一项 404 都不该让整个 Service Worker 装不上
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 模型接口和别的域，直接走网络，不缓存
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => hit || caches.match('./index.html'));
      return hit || network;
    })
  );
});
