/* Office Love — service worker
   เก็บไฟล์หน้าเว็บไว้ในเครื่อง ให้เปิดแอปได้เร็วและใช้ได้แม้สัญญาณขาด

   เดิมใช้แบบ "เอาของใหม่จากเน็ตก่อนเสมอ" ทำให้ทุกครั้งที่เปิดแอป
   ต้องรอดาวน์โหลดไฟล์หน้าเว็บ 200 KB ก่อน โค้ดถึงจะเริ่มทำงาน
   ตอนนี้เปลี่ยนเป็น "ใช้ของในเครื่องทันที แล้วโหลดของใหม่เงียบ ๆ ไว้ใช้รอบหน้า"
   แอปจึงเปิดติดทันที และยังได้ของใหม่เสมอในการเปิดครั้งถัดไป

   ** แก้เลข VERSION ทุกครั้งที่อัปโหลดไฟล์ใหม่ ไม่งั้นเครื่อง รปภ. จะยังเห็นของเก่า **
   ** อัปไฟล์ใหม่แล้ว ให้เปิดแอป 2 ครั้ง — ครั้งแรกโหลดเก็บ ครั้งที่สองถึงเห็นของใหม่ ** */
var VERSION = 'officelove-v40';
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

/** โหลดของใหม่มาเก็บไว้เงียบ ๆ ไม่ให้ผู้ใช้ต้องรอ */
function refresh(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () { return null; });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // POST ไป API ปล่อยผ่าน
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // แผนที่ / ฟอนต์ / Drive ปล่อยผ่าน

  e.respondWith(
    caches.open(VERSION).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) {
          refresh(req);                                   // มีของในเครื่อง ส่งให้ทันที
          return hit;                                     // แล้วค่อยอัปเดตไว้ใช้รอบหน้า
        }
        // ยังไม่เคยเก็บไฟล์นี้ ต้องรอเน็ต
        return refresh(req).then(function (res) {
          if (res) return res;
          return caches.match('./index.html').then(function (f) {
            return f || new Response('ออฟไลน์ และยังไม่มีไฟล์เก็บไว้ในเครื่อง',
                     { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
          });
        });
      });
    })
  );
});
