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
    aiStyle: 'Gaming-Kanal: Highlights, Clutches, Fails und Let\'s Plays – locker, humorvoll, mit Hook; Publikum eher jung.',
    keywords: 'gaming, gameplay, lets play, letsplay, zocken, clutch, stream, twitch, ps5, xbox, controller, fortnite, minecraft, '
      + 'valorant, warzone, call of duty, cod, apex, gta, fifa, ea fc, rocket league, cs2, league of legends, elden ring, '
      + 'zelda, mario, pokemon, ranked, boss',
    ...emptyConnections() },
  { id: '3dbymicha', name: '3dbymicha', color: '#25c4f4', isDefault: false, category: '28', tags: '3d-druck, 3d druck, bambu lab', footer: '',
    aiStyle: 'Gewerblicher Kanal rund um 3D-Druck (Bambu Lab A1 / A1 mini) und Druck von Flexisticker (Tassen, Textilien): '
      + 'Werkstatt-Einblicke, Produkte, Tipps – freundlich, sachlich, zeigt Können; potenzielle Kunden und Maker als Publikum.',
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
  ai: { apiKey: '', auto: true, hints: '', spent: 0, count: 0 },  // Claude (Anthropic-API)
  fal: { key: '', count: 0, model: 'fal-ai/flux-pro/kontext', boosts: 0 },  // fal.ai: Freistellen + KI-Aufwertung
  photos: [],                                                      // Fotos des Creators für Titelbilder
  cut: { auto: true, longVersion: true, cutPauses: true, silenceDb: -45, minPause: 20, shorts: 3, shortMin: 30, shortMax: 45,
    moveRaw: true, whisper: { enabled: true, model: 'small', threads: 4 },
    captions: { enabled: true, color: '#FFE14D' },                                   // animierte Untertitel in Shorts
    facecam: { enabled: false, x: 0, y: 0, w: 0, h: 0 } },                           // Bereich der Facecam (Anteile 0–1)
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
  state.ai = { ...base.ai, ...raw.ai };
  state.fal = { ...base.fal, ...raw.fal };
  state.photos = Array.isArray(raw.photos) ? raw.photos : [];
  state.cut = { ...base.cut, ...raw.cut, whisper: { ...base.cut.whisper, ...raw.cut?.whisper },
    captions: { ...base.cut.captions, ...raw.cut?.captions }, facecam: { ...base.cut.facecam, ...raw.cut?.facecam } };
  for (const k of ['category', 'tags', 'footer']) delete state.settings[k];
  const defaults = Object.fromEntries(defaultProfiles().map((p) => [p.id, p]));
  for (const p of state.profiles) {
    const c = emptyConnections();
    p.youtube = { ...c.youtube, ...p.youtube };
    p.tiktok = { ...c.tiktok, ...p.tiktok };
    if (p.aiStyle === undefined) p.aiStyle = defaults[p.id]?.aiStyle || '';
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
