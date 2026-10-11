// Ein JSON-Speicher für alles (Videos, Anmeldung, Zugänge). Schreibt atomar (tmp + rename).
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'zentrale.json');

const empty = () => ({
  videos: {},          // id -> Video
  auth: null,          // { salt, hash }
  sessions: {},        // token-Hash -> { at, seen }
  settings: {
    category: '20',    // YouTube-Kategorie (20 = Gaming)
    language: 'de',
    footer: '',        // wird unter jede YouTube-Beschreibung gesetzt
    tags: '',          // Standard-Tags
    autoArchive: true, // nach YouTube + TikTok automatisch nach "hochgeladen"
  },
  youtube: { clientId: '', clientSecret: '', refreshToken: '', channel: null },
  tiktok: { clientKey: '', clientSecret: '', redirectUri: '', refreshToken: '', refreshExpires: 0, user: null },
});

let state = empty();
let timer = null;

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const base = empty();
    state = { ...base, ...raw,
      settings: { ...base.settings, ...raw.settings },
      youtube: { ...base.youtube, ...raw.youtube },
      tiktok: { ...base.tiktok, ...raw.tiktok } };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Speicher nicht lesbar:', e.message);
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
