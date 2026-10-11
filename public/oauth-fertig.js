'use strict';
// Rückkehr von Google/TikTok: Ergebnis zeigen, Hauptfenster informieren, Popup schließen.
const q = new URLSearchParams(location.search);
const ok = q.get('ok') === '1';
document.getElementById('title').textContent = ok ? `✓ ${q.get('platform')} verbunden` : `${q.get('platform') || 'Verbindung'} fehlgeschlagen`;
document.getElementById('text').textContent = ok ? `Kanal „${q.get('kanal')}“. Dieses Fenster schließt sich gleich.` : (q.get('error') || 'Unbekannter Fehler.');
if (!ok) document.getElementById('text').className = 'err';
try { window.opener?.postMessage({ type: 'vz-oauth', ok, platform: q.get('platform'), kanal: q.get('kanal'), error: q.get('error') }, location.origin); } catch { /* egal */ }
if (ok && window.opener) setTimeout(() => window.close(), 1500);
