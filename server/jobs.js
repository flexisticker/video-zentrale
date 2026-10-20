// Upload-Warteschlange: ein Upload nach dem anderen, Fortschritt im Video-Eintrag (v.yt / v.tt).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { db, save, saveNow, DATA_DIR } from './store.js';
import { fileOf, imagePath, moveVideo } from './library.js';
import * as cover from './cover.js';
import * as youtube from './youtube.js';
import * as tiktok from './tiktok.js';
import * as profiles from './profiles.js';

const queue = [];
let running = false;

export function init() {
  for (const v of Object.values(db().videos)) {
    for (const k of ['yt', 'tt']) {
      const s = v[k];
      if (s && (s.state === 'queued' || s.state === 'uploading')) {
        v[k] = { ...s, state: 'error', error: 'Durch Neustart unterbrochen – bitte erneut starten.' };
      }
      if (k === 'tt' && v[k]?.state === 'processing') watchTikTok(v.id);
    }
  }
  saveNow();
}

export function enqueue(v, platform, direct = null) {
  const k = platform === 'youtube' ? 'yt' : 'tt';
  if (['queued', 'uploading', 'processing'].includes(v[k]?.state)) throw new Error('Läuft bereits.');
  if (v.missing) throw new Error('Videodatei nicht gefunden.');
  const p = profiles.effective(v);
  if (!p) throw new Error('Kein Kanal gewählt.');
  if (!p[platform].refreshToken) throw new Error(`${platform === 'youtube' ? 'YouTube' : 'TikTok'} ist für „${p.name}“ nicht verbunden (Einstellungen).`);
  // Ziel beim Freigeben festhalten – spätere Kanal-Änderungen wirken nicht auf einen laufenden Upload.
  v[k] = { state: 'queued', progress: 0, at: new Date().toISOString(), profileId: p.id, profileName: p.name, history: v[k]?.history || [],
    ...(direct ? { mode: 'direct', direct } : { mode: 'inbox' }) };
  queue.push({ id: v.id, platform });
  saveNow();
  next();
}

export function cancel(v, platform) {
  const k = platform === 'youtube' ? 'yt' : 'tt';
  const i = queue.findIndex((q) => q.id === v.id && q.platform === platform);
  if (i >= 0) { queue.splice(i, 1); v[k] = { ...v[k], state: v[k].history?.length ? 'done' : 'none' }; saveNow(); return true; }
  return false;
}

// Erledigt-Markierung von Hand (z. B. selbst in der App hochgeladen).
export function markDone(v, platform, url) {
  const k = platform === 'youtube' ? 'yt' : 'tt';
  const p = profiles.effective(v);
  v[k] = { ...v[k], state: 'done', manual: true, url: url || v[k]?.url || '', at: new Date().toISOString(), profileId: p?.id || '', profileName: p?.name || '' };
  saveNow();
  autoArchive(v);
}

function ffmpegJpeg(src, dst) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src,
      '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', dst], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', (c) => resolve(c === 0));
  });
}

async function next() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  const v = db().videos[job.id];
  const k = job.platform === 'youtube' ? 'yt' : 'tt';
  let coverTmp = null;
  try {
    if (!v) return;
    const p = profiles.get(v[k].profileId);
    if (!p) throw new Error('Kanal wurde gelöscht.');
    v[k].state = 'uploading';
    save();
    let file = fileOf(v);
    let last = 0;
    const progress = (done, total, note = '') => {
      v[k].progress = total ? Math.round((done / total) * 1000) / 10 : 0;
      v[k].note = note;   // z. B. „Verbindung hing – neuer Versuch 2/8“
      if (note || Date.now() - last > 1000 || done === total) { last = Date.now(); save(); }
    };
    // Titelbild als erstes Bild: Kopie mit Titelbild vorne hochladen (Original bleibt unverändert)
    const cmode = cover.modeOf(v);
    v[k].cover = false; v[k].coverError = '';
    if (cmode !== 'aus' && imagePath(v)) {
      v[k].note = 'Titelbild vorne einfügen …'; save();
      try { coverTmp = await cover.build(v, file, imagePath(v), cmode); if (coverTmp) { file = coverTmp; v[k].cover = cmode; } }
      catch (e) { v[k].coverError = e.message + ' – Video ohne Titelbild vorne hochgeladen.'; }
      v[k].note = ''; save();
    }
    if (job.platform === 'youtube') {
      let img = imagePath(v);
      if (img) {
        const tmp = path.join(DATA_DIR, 'tmp');
        fs.mkdirSync(tmp, { recursive: true });
        const out = path.join(tmp, v.id + '-yt.jpg');
        if (await ffmpegJpeg(img, out)) img = out;
      }
      const r = await youtube.upload(v, p, file, img, progress);
      v.yt = { ...v.yt, state: 'done', progress: 100, id: r.id, url: 'https://youtu.be/' + r.id,
        studio: 'https://studio.youtube.com/video/' + r.id + '/edit', privacy: r.privacy, thumbError: r.thumbError,
        thumbAt: r.thumbSent ? new Date().toISOString() : '', thumbNone: !img, vertical: v.height > v.width,
        error: '', at: new Date().toISOString(),
        channelTitle: p.youtube.channel?.title || '', channelId: p.youtube.channel?.id || '',
        history: [...(v.yt.history || []), { id: r.id, profileId: p.id, at: new Date().toISOString() }] };
    } else {
      // Direkt veröffentlichen: Titelbild (erstes Bild) ausdrücklich als Cover wählen
      const direct = v.tt.mode === 'direct' ? { ...v.tt.direct, ...(v.tt.cover ? { coverMs: 0 } : {}) } : null;
      const publishId = await tiktok.upload(p, file, progress, direct);
      v.tt = { ...v.tt, state: 'processing', progress: 100, publishId, error: '', at: new Date().toISOString() };
      watchTikTok(v.id);
    }
    saveNow();
    autoArchive(v);
  } catch (e) {
    if (v) { v[k] = { ...v[k], state: 'error', error: e.message }; saveNow(); }
  } finally {
    if (coverTmp) fs.rmSync(coverTmp, { force: true });
    running = false;
    next();
  }
}

async function watchTikTok(id) {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, i < 6 ? 5000 : 20000));
    const v = db().videos[id];
    if (!v || v.tt?.state !== 'processing') return;
    try {
      const p = profiles.get(v.tt.profileId);
      if (!p) return;
      const s = await tiktok.checkStatus(p, v.tt.publishId);
      if (s.status === 'SEND_TO_USER_INBOX' || s.status === 'PUBLISH_COMPLETE') {
        v.tt = { ...v.tt, state: 'done', tikStatus: s.status, at: new Date().toISOString(),
          history: [...(v.tt.history || []), { id: v.tt.publishId, profileId: p.id, at: new Date().toISOString() }] };
        saveNow(); autoArchive(v); return;
      }
      if (s.status === 'FAILED') { v.tt = { ...v.tt, state: 'error', error: 'TikTok: ' + (s.reason || 'Verarbeitung fehlgeschlagen') }; saveNow(); return; }
      v.tt = { ...v.tt, tikStatus: s.status || 'leer', tikReason: s.reason || '', checkedAt: new Date().toISOString() }; save();
    } catch (e) { v.tt.lastCheckError = e.message; save(); }
  }
  // Nach ~30 Min. ohne Bestätigung: nicht als erledigt zählen, sondern ehrlich „unbestätigt“
  const v = db().videos[id];
  if (v?.tt?.state === 'processing') { v.tt = { ...v.tt, state: 'unconfirmed', note: 'TikTok hat die Zustellung nicht bestätigt (letzter Status: ' + (v.tt.tikStatus || '–') + ').' }; saveNow(); }
}

function autoArchive(v) {
  if (!db().settings.autoArchive || v.folder !== 'geschnitten') return;
  if (v.yt?.state === 'done' && v.tt?.state === 'done') {
    try { moveVideo(v, 'hochgeladen'); } catch (e) { console.error('Archivieren:', e.message); }
  }
}

export const busy = () => running || queue.length > 0;
