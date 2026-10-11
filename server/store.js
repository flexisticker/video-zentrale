// Ein JSON-Speicher für alles (Videos, Kanäle, Anmeldung, Zugänge). Schreibt atomar (tmp + rename).
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'zentrale.json');

export const emptyConnections = () => ({
  youtube: { refreshToken: '', channel: null },
  tiktok: { refreshToken: '', refreshExpires: 0, user: null },
});

// Startwerte für die beiden Kanäle des Kunden (alles in den Einstellungen änderbar).
export const defaultProfiles = () => [
  { id: 'michamodus', name: 'MichaModus', color: '#7c5cff', isDefault: true, category: '20', tags: 'gaming, deutsch', footer: '',
    keywords: 'gaming, gameplay, lets play, letsplay, zocken, clutch, stream, twitch, ps5, xbox, controller, fortnite, minecraft, '
      + 'valorant, warzone, call of duty, cod, apex, gta, fifa, ea fc, rocket league, cs2, league of legends, elden ring, '
      + 'zelda, mario, pokemon, ranked, boss',
    ...emptyConnections() },
  { id: '3dbymicha', name: '3dbymicha', color: '#25c4f4', isDefault: false, category: '28', tags: '3d-druck, 3d druck, bambu lab', footer: '',
    keywords: '3d, 3d-druck, 3d druck, 3ddruck, 3d print, 3d printing, 3d-drucker, drucker, bambu, bambulab, a1 mini, ams, '
      + 'filament, pla, petg, tpu, slicer, druckbett, nozzle, cad, fusion 360, tinkercad, makerworld, printables, flexisticker, '
      + 'tasse, tassen, sublimation, dtf, plotter, textildruck, werkstatt',
    ...emptyConnections() },
];

const empty = () => ({
  videos: {},          // id -> Video
  auth: null,          // { salt, hash }
  sessions: {},        // token-Hash -> { at, seen }
  settings: { language: 'de', autoArchive: true },
  profiles: defaultProfiles(),                                   // Kanäle mit eigenen Verbindungen und Vorgaben
  youtube: { clientId: '', clientSecret: '' },                   // Google-App (für alle Kanäle gleich)
  tiktok: { clientKey: '', clientSecret: '', redirectUri: '' },  // TikTok-App (für alle Konten gleich)
});

let state = empty();
let timer = null;

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.error('Speicher nicht lesbar:', e.message); }
  if (!raw) return state;
  const base = empty();
  state = { ...base, ...raw, settings: { ...base.settings, ...raw.settings } };
  // 1.0 → 1.1: Verbindungen und Vorgaben lagen global, jetzt je Kanal (gehen an den Standardkanal).
  if (!Array.isArray(raw.profiles)) {
    const p = state.profiles[0];
    const s = raw.settings || {};
    if (s.category) p.category = s.category;
    if (s.tags) p.tags = s.tags;
    if (s.footer) p.footer = s.footer;
    if (raw.youtube?.refreshToken) p.youtube = { refreshToken: raw.youtube.refreshToken, channel: raw.youtube.channel || null };
    if (raw.tiktok?.refreshToken) p.tiktok = { refreshToken: raw.tiktok.refreshToken, refreshExpires: raw.tiktok.refreshExpires || 0, user: raw.tiktok.user || null };
  }
  state.youtube = { clientId: raw.youtube?.clientId || '', clientSecret: raw.youtube?.clientSecret || '' };
  state.tiktok = { clientKey: raw.tiktok?.clientKey || '', clientSecret: raw.tiktok?.clientSecret || '', redirectUri: raw.tiktok?.redirectUri || '' };
  for (const k of ['category', 'tags', 'footer']) delete state.settings[k];
  for (const p of state.profiles) {
    const c = emptyConnections();
    p.youtube = { ...c.youtube, ...p.youtube };
    p.tiktok = { ...c.tiktok, ...p.tiktok };
  }
  return state;
}

export function db() { return state; }

export function saveNow() {
  clearTimeout(timer); timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, FILE);
}

// Viele kleine Änderungen (Fortschritt) zusammenfassen.
export function save() {
  if (!timer) timer = setTimeout(() => { try { saveNow(); } catch (e) { console.error(e); } }, 400);
}
