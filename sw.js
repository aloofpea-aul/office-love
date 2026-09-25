/* Office Love — service worker
   เก็บไฟล์หน้าเว็บไว้ในเครื่อง ให้เปิดแอปได้แม้สัญญาณขาด
   ข้อมูลที่ส่งเข้า API ไม่ผ่าน cache — ตัวแอปมีคิว IndexedDB ของตัวเองอยู่แล้ว
   ** แก้เลข VERSION ทุกครั้งที่อัปโหลดไฟล์ใหม่ ไม่งั้นเครื่อง รปภ. จะยังเห็นของเก่า ** */
var VERSION = 'officelove-v24';
var SHELL = [
  './',
  './index.html',
  './config.js',
  './admin.html',
  './supervisor.html',
  './report.html',
  './manifest.json'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () { /* ไฟล์ไหนโหลดไม่ได้ก็ข้ามไป */ });
      }));
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // POST ไป API ปล่อยผ่าน
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // แผนที่ / ฟอนต์ / Drive ปล่อยผ่าน

  // network-first: ได้ของใหม่เสมอเมื่อมีเน็ต ตกไปใช้ cache เมื่อสัญญาณขาด
  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
