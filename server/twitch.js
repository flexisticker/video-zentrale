// Twitch: stärkstes Highlight-Signal für Streamer – wenn der Chat explodiert, ist gerade etwas passiert.
//  - Anmeldung per Geräte-Code (wie YouTube): eigene App auf dev.twitch.tv, Client-ID (+ optional Secret)
//  - Chat-Mitschnitt live über EventSub-WebSocket (offizielle Schnittstelle, Recht user:read:chat):
//    gespeichert werden nur Zeit + Nachrichtentext (keine Namen) je Stream unter /data/twitch/chat-<stream>.jsonl
//  - Stream-Beginn/-Ende (stream.online/offline), Zuschauer-Clips (mit Stelle im VOD), Stream-Marker (/marker, Recht user:read:broadcast)
//  - optional: VOD nach Streamende automatisch in den Eingang laden (yt-dlp – inoffizieller Download-Weg)
// Zuordnung Aufnahme ↔ Stream: Twitch-VOD (Offset 0) bzw. OBS-Aufnahme über die Uhrzeit im Dateinamen.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { db, save, saveNow, DATA_DIR } from './store.js';
import * as lib from './library.js';

const ID = process.env.TWITCH_ID_BASE || 'https://id.twitch.tv';
const API = process.env.TWITCH_API_BASE || 'https://api.twitch.tv';
const WS_URL = process.env.TWITCH_WS_URL || 'wss://eventsub.wss.twitch.tv/ws';
const SCOPES = 'user:read:chat user:read:broadcast';
const DIR = path.join(DATA_DIR, 'twitch');
const YTDLP = process.env.YTDLP_BIN || 'yt-dlp';

const cfg = () => {
  const d = db();
  if (!d.twitch) d.twitch = {};
  const t = d.twitch;
  t.clientId ??= ''; t.clientSecret ??= ''; t.refreshToken ??= ''; t.user ??= null;
  t.chat ??= true; t.vodImport ??= false; t.vodFolder ??= 'eingang'; t.streams ??= []; t.clips ??= {};
  return t;
};

let access = { token: '', until: 0 };
let pending = null;      // laufende Geräte-Anmeldung
let ws = null, wsState = { state: 'aus', error: '', since: 0, messages: 0 };
let live = null;         // { id, startedAt, title, game }

export function status() {
  const c = cfg();
  return {
    configured: !!c.clientId, hasSecret: !!c.clientSecret, connected: !!c.refreshToken, user: c.user,
    chat: c.chat, vodImport: c.vodImport, vodFolder: c.vodFolder, ytdlp: ytdlpState,
    pending: pending && Date.now() < pending.until ? { code: pending.userCode, url: pending.url, until: pending.until, error: pending.error || '' } : null,
    eventsub: { ...wsState }, live,
    streams: c.streams.slice(-15).reverse().map((s) => ({ id: s.id, startedAt: s.startedAt, endedAt: s.endedAt || '', title: s.title || '', game: s.game || '',
      messages: s.messages || 0, vodId: s.vodId || '', imported: s.imported || '', importError: s.importError || '' })),
  };
}

export function configure(b) {
  const c = cfg();
  if (typeof b.clientId === 'string') c.clientId = b.clientId.trim();
  if (typeof b.clientSecret === 'string' && b.clientSecret.trim()) c.clientSecret = b.clientSecret.trim();
  if (b.removeSecret === true) c.clientSecret = '';
  if (typeof b.chat === 'boolean') c.chat = b.chat;
  if (typeof b.vodImport === 'boolean') c.vodImport = b.vodImport;
  if (lib.INBOXES.includes(b.vodFolder)) c.vodFolder = b.vodFolder;
  saveNow();
  restart();
}

export function disconnect() {
  const c = cfg();
  c.refreshToken = ''; c.user = null; access = { token: '', until: 0 }; pending = null;
  saveNow(); stopWs();
}

async function form(url, data) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

// ---------- Anmeldung (Device Code Grant Flow) ----------
export async function startDevice() {
  const c = cfg();
  if (!c.clientId) throw new Error('Erst die Client-ID der Twitch-App eintragen.');
  const r = await form(ID + '/oauth2/device', { client_id: c.clientId, scopes: SCOPES });
  if (!r.ok) throw new Error('Twitch: ' + (r.j.message || r.status));
  pending = { device: r.j.device_code, userCode: r.j.user_code, url: r.j.verification_uri, interval: (r.j.interval || 5) * 1000, until: Date.now() + (r.j.expires_in || 1800) * 1000 };
  poll();
  return { code: pending.userCode, url: pending.url };
}

async function poll() {
  const p = pending;
  if (!p || Date.now() > p.until) return;
  await new Promise((res) => setTimeout(res, p.interval));
  if (pending !== p) return;
  const c = cfg();
  const data = { client_id: c.clientId, scopes: SCOPES, device_code: p.device, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' };
  if (c.clientSecret) data.client_secret = c.clientSecret;
  const r = await form(ID + '/oauth2/token', data).catch((e) => ({ ok: false, j: { message: e.message } }));
  if (r.ok && r.j.access_token) {
    c.refreshToken = r.j.refresh_token || '';
    access = { token: r.j.access_token, until: Date.now() + (r.j.expires_in || 3600) * 1000 - 60_000 };
    pending = null;
    await whoAmI().catch(() => {});
    saveNow(); restart();
    return;
  }
  const msg = String(r.j.message || '');
  if (/authorization_pending|pending/i.test(msg)) return poll();
  if (/slow_down/i.test(msg)) { p.interval += 5000; return poll(); }
  p.error = msg || 'Anmeldung fehlgeschlagen';
}

async function token() {
  const c = cfg();
  if (access.token && Date.now() < access.until) return access.token;
  if (!c.refreshToken) throw new Error('Twitch ist nicht verbunden.');
  const data = { client_id: c.clientId, grant_type: 'refresh_token', refresh_token: c.refreshToken };
  if (c.clientSecret) data.client_secret = c.clientSecret;
  const r = await form(ID + '/oauth2/token', data);
  if (!r.ok || !r.j.access_token) {
    if (r.status === 400 || r.status === 401) { c.refreshToken = ''; saveNow(); }
    throw new Error('Twitch-Anmeldung abgelaufen – bitte neu verbinden.');
  }
  access = { token: r.j.access_token, until: Date.now() + (r.j.expires_in || 3600) * 1000 - 60_000 };
  if (r.j.refresh_token && r.j.refresh_token !== c.refreshToken) { c.refreshToken = r.j.refresh_token; saveNow(); }
  return access.token;
}

export async function helix(pathQ, { method = 'GET', body } = {}) {
  const t = await token();
  const r = await fetch(API + '/helix' + pathQ, { method, headers: { Authorization: 'Bearer ' + t, 'Client-Id': cfg().clientId,
    ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) access = { token: '', until: 0 };
  if (!r.ok) throw new Error(`Twitch ${r.status}: ${j.message || ''}`.trim());
  return j;
}

async function whoAmI() {
  const j = await helix('/users');
  const u = j.data?.[0];
  if (u) cfg().user = { id: u.id, login: u.login, name: u.display_name || u.login };
  return cfg().user;
}

// ---------- Streams & Chat-Mitschnitt ----------
const streamById = (id) => cfg().streams.find((s) => s.id === id);
function upsertStream(x) {
  const c = cfg();
  let s = streamById(x.id);
  if (!s) { s = { id: x.id, messages: 0 }; c.streams.push(s); if (c.streams.length > 400) c.streams.splice(0, c.streams.length - 400); }
  Object.assign(s, Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined && v !== '')));
  save();
  return s;
}
export const chatFile = (streamId) => path.join(DIR, `chat-${String(streamId).replace(/[^\w-]/g, '')}.jsonl`);

async function currentStream() {
  const u = cfg().user;
  if (!u) return null;
  const j = await helix('/streams?user_id=' + u.id);
  const s = j.data?.[0];
  if (!s) return null;
  live = { id: s.id, startedAt: s.started_at, title: s.title, game: s.game_name };
  upsertStream({ id: s.id, startedAt: s.started_at, title: s.title, game: s.game_name });
  return live;
}

function onChat(ev) {
  if (!live) return;
  const text = String(ev.message?.text || '').slice(0, 300);
  const emotes = (ev.message?.fragments || []).filter((f) => f.type === 'emote').map((f) => f.text).slice(0, 10);
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFile(chatFile(live.id), JSON.stringify([Date.now(), text, emotes]) + '\n', () => {});
  const s = streamById(live.id);
  if (s) { s.messages = (s.messages || 0) + 1; save(); }
  wsState.messages++;
}

function stopWs() {
  if (ws) { try { ws.onclose = null; ws.close(); } catch { /* egal */ } }
  ws = null; wsState = { ...wsState, state: 'aus' };
}
let retry = null;
function restart() {
  stopWs();
  clearTimeout(retry);
  const c = cfg();
  if (!c.refreshToken || !c.clientId || !c.user) return;
  connectWs(WS_URL);
}
function connectWs(url) {
  try { ws = new WebSocket(url); } catch (e) { wsState = { ...wsState, state: 'Fehler', error: e.message }; return; }
  wsState = { ...wsState, state: 'verbinde', error: '' };
  const me = ws;
  let keep = null;
  const alive = (sec) => { clearTimeout(keep); keep = setTimeout(() => { try { me.close(); } catch { /* egal */ } }, (sec + 15) * 1000); };
  ws.onmessage = async (m) => {
    let j; try { j = JSON.parse(m.data); } catch { return; }
    const type = j.metadata?.message_type;
    if (type === 'session_welcome') {
      alive(j.payload.session.keepalive_timeout_seconds || 10);
      if (url !== WS_URL && wsState.session) { wsState = { ...wsState, state: 'verbunden', session: j.payload.session.id }; return; }   // nach Umzug bleiben die Abos
      wsState = { ...wsState, state: 'verbunden', session: j.payload.session.id, since: Date.now() };
      try { await subscribe(j.payload.session.id); await currentStream(); }
      catch (e) { wsState = { ...wsState, state: 'Fehler', error: e.message }; }
    } else if (type === 'session_keepalive') alive(10);
    else if (type === 'session_reconnect') { const next = j.payload.session.reconnect_url; me.onclose = null; connectWs(next); setTimeout(() => { try { me.close(); } catch { /* egal */ } }, 2000); }
    else if (type === 'notification') {
      alive(10);
      const t = j.metadata.subscription_type, ev = j.payload.event;
      if (t === 'channel.chat.message') onChat(ev);
      else if (t === 'stream.online') {
        live = { id: ev.id, startedAt: ev.started_at };
        upsertStream({ id: ev.id, startedAt: ev.started_at });
        currentStream().catch(() => {});
      } else if (t === 'stream.offline') {
        const s = live && streamById(live.id);
        if (s) { s.endedAt = new Date().toISOString(); save(); scheduleImport(s.id); }
        live = null;
      }
    } else if (type === 'revocation') wsState = { ...wsState, error: 'Twitch hat ein Abo beendet: ' + (j.payload?.subscription?.status || '') };
  };
  ws.onclose = () => {
    clearTimeout(keep);
    if (ws !== me) return;
    wsState = { ...wsState, state: 'getrennt' };
    retry = setTimeout(restart, 15_000);
  };
  ws.onerror = () => { wsState = { ...wsState, error: 'Verbindung zu Twitch unterbrochen' }; };
}

async function subscribe(session) {
  const c = cfg();
  const uid = c.user.id;
  const transport = { method: 'websocket', session_id: session };
  const subs = [['stream.online', '1', { broadcaster_user_id: uid }], ['stream.offline', '1', { broadcaster_user_id: uid }]];
  if (c.chat) subs.push(['channel.chat.message', '1', { broadcaster_user_id: uid, user_id: uid }]);
  for (const [type, version, condition] of subs) await helix('/eventsub/subscriptions', { method: 'POST', body: { type, version, condition, transport } });
}

// ---------- VODs, Clips, Marker ----------
const durSec = (d) => { const m = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/.exec(d || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };

// VODs (Archiv) holen und mit bekannten Streams verknüpfen
export async function syncVideos() {
  const u = cfg().user;
  if (!u) return [];
  const j = await helix(`/videos?user_id=${u.id}&type=archive&first=30`);
  for (const x of j.data || []) {
    upsertStream({ id: x.stream_id || 'v' + x.id, vodId: x.id, startedAt: x.created_at, title: x.title, vodDuration: durSec(x.duration), vodViews: x.view_count });
  }
  return j.data || [];
}

// Zuschauer-Clips eines Zeitraums (mit Stelle im VOD)
export async function clipsFor(stream) {
  const u = cfg().user;
  if (!u || !stream?.startedAt) return [];
  const c = cfg();
  const cached = c.clips[stream.id];
  if (cached && Date.now() - cached.at < 3 * 3600_000 && stream.endedAt && cached.at > Date.parse(stream.endedAt) + 3600_000) return cached.list;
  const from = new Date(Date.parse(stream.startedAt) - 60_000).toISOString();
  const to = new Date((stream.endedAt ? Date.parse(stream.endedAt) : Date.now()) + 2 * 86400_000).toISOString();
  const j = await helix(`/clips?broadcaster_id=${u.id}&started_at=${from}&ended_at=${to}&first=100`);
  const list = (j.data || []).filter((x) => !stream.vodId || !x.video_id || x.video_id === stream.vodId)
    .map((x) => ({ id: x.id, title: x.title, views: x.view_count, dur: x.duration, offset: x.vod_offset, createdAt: x.created_at, url: x.url }));
  c.clips[stream.id] = { at: Date.now(), list };
  save();
  return list;
}

export async function markersFor(stream) {
  if (!stream?.vodId) return [];
  try {
    const j = await helix(`/streams/markers?video_id=${stream.vodId}&first=100`);
    return (j.data?.[0]?.videos?.[0]?.markers || []).map((m) => ({ t: m.position_seconds, text: m.description || '' }));
  } catch { return []; }
}

// ---------- Zuordnung Aufnahme ↔ Stream ----------
// Zeit aus OBS-Dateinamen („2026-10-19 20-15-03.mkv“) bzw. Twitch-Download („… 2026-10-19 …“)
function timeFromName(name) {
  const m = /(20\d\d)-(\d\d)-(\d\d)[ _T](\d\d)[-_.:](\d\d)(?:[-_.:](\d\d))?/.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime() : null;
}

// → { stream, offset (Sekunden: Videozeit 0 = Streamzeit offset) } oder null
export function matchStream(v) {
  const c = cfg();
  if (v.twitch?.none) return null;
  if (v.twitch?.streamId) { const s = streamById(v.twitch.streamId); return s ? { stream: s, offset: v.twitch.offset || 0 } : null; }
  const name = path.basename(v.file || '');
  // 1) VOD-Nummer im Namen (Import bzw. Twitch-Download „v123456789“)
  for (const s of c.streams) if (s.vodId && new RegExp(`(^|\\D)v?${s.vodId}(\\D|$)`).test(name)) return { stream: s, offset: 0 };
  const started = (s) => Date.parse(s.startedAt);
  const ended = (s) => s.endedAt ? Date.parse(s.endedAt) : s.vodDuration ? started(s) + s.vodDuration * 1000 : started(s) + 12 * 3600_000;
  // 2) Uhrzeit im Dateinamen (OBS-Aufnahme beim Streamen)
  const t = timeFromName(name);
  if (t) {
    const s = c.streams.find((x) => t >= started(x) - 15 * 60_000 && t <= ended(x));
    if (s) return { stream: s, offset: (t - started(s)) / 1000 };
  }
  // 3) Heruntergeladenes VOD: Länge passt (± 3 Min.) und Datei ist nach dem Stream entstanden
  if (v.duration > 600) {
    const s = c.streams.find((x) => {
      const len = (ended(x) - started(x)) / 1000;
      return Math.abs(len - v.duration) < 180 && (v.mtime || 0) >= ended(x) - 600_000 && (v.mtime || 0) - ended(x) < 30 * 86400_000;
    });
    if (s) return { stream: s, offset: 0, guessed: true };
  }
  return null;
}

// Chat-Zeitleiste eines Streams (Sekunden ab Streambeginn)
function loadChat(stream) {
  try {
    const t0 = Date.parse(stream.startedAt);
    return fs.readFileSync(chatFile(stream.id), 'utf8').split('\n').filter(Boolean).map((l) => {
      const [at, text, em] = JSON.parse(l);
      return { t: (at - t0) / 1000, text, em: em || [] };
    });
  } catch { return []; }
}

const HYPE = /^(lul|lol|kekw|omegalul|lmao|xd+|haha+|pog|pogchamp|poggers|w|l|gg|f|monkas|wtf|\?+|!+|omg|krass|alter|lets ?go)$/i;

// Signale für den Schnitt: extra = [{ t, w, label }], forced = [{ t, label, start, end }], lines = Text für Claude
export async function signalsFor(v, duration) {
  const c = cfg();
  if (!c.refreshToken && !c.streams.length) return { extra: [], forced: [], lines: '' };
  const m = matchStream(v);
  if (!m) return { extra: [], forced: [], lines: '' };
  if (!v.twitch || v.twitch.streamId !== m.stream.id) { v.twitch = { streamId: m.stream.id, offset: Math.round(m.offset * 10) / 10, guessed: !!m.guessed, title: m.stream.title || '' }; save(); }
  const off = m.offset;
  const extra = [], forced = [], lines = [];
  // Chat: Nachrichten je 10 s gegenüber dem üblichen Tempo; Chat reagiert 3–10 s später → 6 s vorziehen
  const chat = loadChat(m.stream).map((x) => ({ ...x, t: x.t - off - 6 })).filter((x) => x.t >= 0 && x.t < duration);
  if (chat.length >= 20) {
    const n = Math.ceil(duration / 10);
    const cnt = new Array(n).fill(0), hype = new Array(n).fill(0), tops = Array.from({ length: n }, () => new Map());
    for (const x of chat) {
      const i = Math.floor(x.t / 10);
      cnt[i]++;
      const words = [...new Set([...x.em, ...String(x.text).split(/\s+/)].filter((w) => HYPE.test(w)).map((w) => w.toUpperCase()))];
      if (words.length) { hype[i]++; for (const w of words) tops[i].set(w, (tops[i].get(w) || 0) + 1); }
    }
    const sorted = [...cnt].sort((a, b) => a - b);
    const med = Math.max(1, sorted[Math.floor(n / 2)]);
    const spikes = cnt.map((k, i) => ({ i, k, z: (k - med) / Math.max(2, Math.sqrt(med) * 2) + hype[i] / Math.max(2, med) }))
      .filter((x) => x.z >= 1.5 && x.k >= 4).sort((a, b) => b.z - a.z).slice(0, 30);
    for (const s of spikes) {
      const top = [...tops[s.i].entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w, k]) => `${w} ×${k}`).join(', ');
      const label = `Chat: ${s.k} Nachr./10 s${top ? ` (${top})` : ''}`;
      extra.push({ t: s.i * 10 + 5, w: Math.min(3, 0.8 + s.z * 0.5), label, spread: 6 });
      lines.push(`Sekunde ${s.i * 10}–${s.i * 10 + 10}: ${label}`);
    }
  }
  // Zuschauer-Clips: sicher dabei
  try {
    for (const k of await clipsFor(m.stream)) {
      if (!Number.isFinite(k.offset)) continue;
      const a = k.offset - off, b = a + (k.dur || 30);
      if (b < 0 || a > duration) continue;
      const label = `Zuschauer-Clip „${String(k.title).slice(0, 50)}“ (${k.views} Aufrufe)`;
      forced.push({ t: (a + b) / 2, start: Math.max(0, a), end: Math.min(duration, b), label });
      extra.push({ t: (a + b) / 2, w: 3, label, spread: Math.ceil((b - a) / 2) });
      lines.push(`Sekunde ${Math.round(a)}–${Math.round(b)}: ${label}`);
    }
  } catch (e) { lines.push('(Zuschauer-Clips nicht abrufbar: ' + e.message + ')'); }
  // Marker: werden meist kurz NACH dem Moment gesetzt
  for (const mk of await markersFor(m.stream)) {
    const t = mk.t - off - 8;
    if (t < 0 || t > duration) continue;
    const label = `Stream-Marker${mk.text ? ` „${mk.text.slice(0, 50)}“` : ''}`;
    forced.push({ t, label }); extra.push({ t, w: 2.5, label });
    lines.push(`Sekunde ${Math.round(t)}: ${label}`);
  }
  return { extra, forced, lines: lines.slice(0, 80).join('\n') };
}

// Von Hand zuordnen (streamId + offset) oder „kein Stream“
export function assign(v, { streamId, offset, none } = {}) {
  if (none) v.twitch = { none: true };
  else if (streamId && streamById(streamId)) v.twitch = { streamId, offset: Number(offset) || 0, manual: true, title: streamById(streamId).title || '' };
  else delete v.twitch;
  save();
  return v.twitch || null;
}

// ---------- VOD-Import (yt-dlp) ----------
let ytdlpState = { checked: false, ok: false, version: '' };
function checkYtdlp() {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn(YTDLP, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => { ytdlpState = { checked: true, ok: false, version: '' }; resolve(ytdlpState); });
    p.on('close', (c) => { ytdlpState = { checked: true, ok: c === 0, version: out.trim() }; resolve(ytdlpState); });
  });
}

const importing = new Set();
function scheduleImport(streamId) {
  if (!cfg().vodImport) return;
  setTimeout(() => importVod(streamId).catch((e) => console.error('VOD-Import:', e.message)), Number(process.env.TWITCH_IMPORT_DELAY_MS || 10 * 60_000));
}

export async function importVod(streamId) {
  const c = cfg();
  if (importing.has(streamId)) throw new Error('Läuft schon.');
  let s = streamById(streamId);
  if (!s) throw new Error('Stream unbekannt.');
  if (!s.vodId) { await syncVideos(); s = streamById(streamId); }
  if (!s?.vodId) throw new Error('Zu diesem Stream gibt es (noch) kein VOD auf Twitch.');
  if (!ytdlpState.ok) await checkYtdlp();
  if (!ytdlpState.ok) throw new Error('yt-dlp fehlt im Container.');
  importing.add(streamId);
  s.importError = ''; s.importing = true; save();
  const d = new Date(s.startedAt);
  const pad = (x) => String(x).padStart(2, '0');
  const title = lib.safeName(String(s.title || 'Twitch-Stream')).replace(/\.+$/, '').slice(0, 60) || 'Twitch-Stream';
  const name = lib.freeName(c.vodFolder, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())} ${title} (Twitch v${s.vodId}).mp4`);
  const tmp = path.join(DATA_DIR, 'tmp', `twitch-${s.vodId}.mp4`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  try {
    const r = await new Promise((resolve) => {
      let err = '';
      const p = spawn('nice', ['-n', '15', YTDLP, '--no-part', '--no-progress', '-f', 'best', '--remux-video', 'mp4', '-o', tmp, 'https://www.twitch.tv/videos/' + s.vodId], { stdio: ['ignore', 'ignore', 'pipe'] });
      p.stderr.on('data', (x) => { err = (err + x).slice(-3000); });
      p.on('error', (e) => resolve({ code: -1, err: e.message }));
      p.on('close', (code) => resolve({ code, err }));
    });
    if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error('Download fehlgeschlagen: ' + (r.err.trim().split('\n').pop() || r.code));
    lib.moveFile(tmp, path.join(lib.dirOf(c.vodFolder), name));
    s.imported = name; s.importedAt = new Date().toISOString();
  } catch (e) { s.importError = e.message; throw e; }
  finally { s.importing = false; importing.delete(streamId); fs.rmSync(tmp, { force: true }); save(); }
  return name;
}

export function init() {
  fs.mkdirSync(DIR, { recursive: true });
  checkYtdlp();
  restart();
  // alte Chat-Mitschnitte (> 120 Tage) aufräumen
  try { for (const f of fs.readdirSync(DIR)) { const p = path.join(DIR, f); if (Date.now() - fs.statSync(p).mtimeMs > 120 * 86400_000) fs.rmSync(p, { force: true }); } } catch { /* egal */ }
  // VODs regelmäßig abgleichen (Streams vor dem ersten Start, Längen)
  setInterval(() => { if (cfg().refreshToken) syncVideos().catch(() => {}); }, 3 * 3600_000).unref?.();
  setTimeout(() => { if (cfg().refreshToken) syncVideos().catch(() => {}); }, 20_000).unref?.();
}
