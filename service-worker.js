/*
 * service-worker.js — offline app shell + schedule caching.
 * Bump CACHE_VERSION to invalidate old caches on the next activate.
 */
'use strict';

var CACHE_VERSION = 'gfest-v4';

var SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/now.js',
  '/js/app.js',
  '/manifest.webmanifest',
  '/fonts/oswald-latin.woff2',
  '/assets/banner.jpg',
  '/assets/grain.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  // Precache the data too, so the app has events offline after a single load
  // (before this, schedule.json was only cached via SWR once the SW took control
  // on a later reload — the first-load-then-offline path showed an empty app).
  '/data/schedule.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // addAll fails the whole install if any request 404s (e.g. missing icons).
      // Cache resiliently so a missing asset never blocks offline for the rest.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VERSION) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isSchedule(url) {
  return url.pathname.endsWith('/schedule.json') || url.pathname.endsWith('schedule.json');
}

// Stale-while-revalidate for the schedule, keyed by its clean (query-less) URL so
// offline always finds it. An explicit Refresh (cache-busting query) goes network-first.
function handleSchedule(request, url) {
  return caches.open(CACHE_VERSION).then(function (cache) {
    var canonical = new Request(url.origin + url.pathname);

    if (url.search) {
      return fetch(request).then(function (net) {
        if (net && net.ok) cache.put(canonical, net.clone());
        return net;
      }).catch(function () {
        return cache.match(canonical).then(function (c) { return c || Response.error(); });
      });
    }

    return cache.match(canonical).then(function (cached) {
      var network = fetch(request).then(function (net) {
        if (net && net.ok) cache.put(canonical, net.clone());
        return net;
      }).catch(function () { return null; });
      return cached || network.then(function (net) { return net || Response.error(); });
    });
  });
}

// Cache-first for shell/assets; navigations fall back to cached /index.html offline.
function handleShell(request) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (net) {
      if (net && net.ok && net.type === 'basic') {
        var copy = net.clone();
        caches.open(CACHE_VERSION).then(function (cache) { cache.put(request, copy); });
      }
      return net;
    }).catch(function () {
      if (request.mode === 'navigate') return caches.match('/index.html');
      return Response.error();
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // ignore cross-origin

  if (isSchedule(url)) {
    event.respondWith(handleSchedule(request, url));
    return;
  }
  event.respondWith(handleShell(request));
});
