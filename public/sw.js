// Service Worker: macht die Zentrale als App installierbar. Bewusst ohne Zwischenspeicher für Daten –
// alles kommt immer frisch vom Server; nur bei fehlender Verbindung erscheint ein Hinweis.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<body style="background:#0e0f14;color:#e9ebf3;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center">'
    + '<div><h2>Keine Verbindung zur Zentrale</h2><p>Bist du im Heimnetz (WLAN)?</p><button onclick="location.reload()" style="padding:12px 20px;font-size:16px">Erneut versuchen</button></div>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
