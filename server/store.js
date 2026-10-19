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
    musicStyle: 'modern energetic gaming background music, electronic beats, punchy drums, synth bass', musicMood: 'energisch',
    clipHints: 'Funny Moments, Stellen wo ich mich ärgere oder aufrege (Rage), laute Reaktionen, Fails, überraschende Wendungen, Clutches, '
      + 'peinliche oder absurde Momente, lustige Sprüche – alles, was Zuschauer bindet und zum Teilen/Kommentieren anregt.', shorts: 6,
    hookStyle: 'auto', tempo: 'schnell', hookHint: 'Lieber die Reaktion/den Ausraster oder den Kill vorweg – Hook-Text frech und neugierig.',
    fxLevel: 'viel', fxImages: true,
    ...emptyConnections() },
  { id: '3dbymicha', name: '3dbymicha', color: '#25c4f4', isDefault: false, category: '28', tags: '3d-druck, 3d druck, bambu lab', footer: '',
    aiStyle: 'Gewerblicher Kanal rund um 3D-Druck (Bambu Lab A1 / A1 mini) und Druck von Flexisticker (Tassen, Textilien): '
      + 'Werkstatt-Einblicke, Produkte, Tipps – freundlich, sachlich, zeigt Können; potenzielle Kunden und Maker als Publikum.',
    keywords: '3d, 3d-druck, 3d druck, 3ddruck, 3d print, 3d printing, 3d-drucker, drucker, bambu, bambulab, a1 mini, ams, '
      + 'filament, pla, petg, tpu, slicer, druckbett, nozzle, cad, fusion 360, tinkercad, makerworld, printables, flexisticker, '
      + 'tasse, tassen, sublimation, dtf, plotter, textildruck, werkstatt',
    musicStyle: 'light upbeat corporate background music, acoustic and soft electronic, positive, modern workshop vibe', musicMood: 'fröhlich',
    clipHints: 'Satisfying-Momente (Druck entsteht, Tasse kommt aus der Presse), Vorher/Nachher, überraschende Ergebnisse, kurze Tipps, Fehler und wie ich sie löse.', shorts: 4,
    hookStyle: 'auto', tempo: 'normal', hookHint: 'Das fertige Ergebnis (Druck, Tasse, Teil) zuerst zeigen, danach wie es entsteht.',
    fxLevel: 'dezent', fxImages: false,
    ...emptyConnections() },
  linkedinProfile(),
];

// LinkedIn: nur Download (kein automatischer Upload), professionell, Ich-Form als Person
export const linkedinProfile = () => ({ id: 'linkedin', name: 'LinkedIn', color: '#0a66c2', isDefault: false, type: 'linkedin', category: '28',
  tags: '', footer: '', keywords: '', music: false,
  aiStyle: 'Persönliches LinkedIn-Profil von Michael, Inhaber von Flexisticker (3D-Druck mit Bambu Lab, Textil- und Tassendruck, Sublimation, DTF). '
    + 'Er postet als Person in der Ich-Form: professionell, seriös, sachlich, mit echtem Mehrwert für Geschäftskunden, Einkäufer und Unternehmer – '
    + 'Einblicke in die Werkstatt, gelöste Kundenaufgaben, Ergebnisse, Erfahrungen und Tipps. Keine Gaming-Sprache, kein Slang.',
  musicStyle: 'calm minimal corporate background music, soft piano and light electronic, unobtrusive', musicMood: 'chillig',
  hookStyle: 'cold', tempo: 'ruhig', hookHint: 'Mit der Kernaussage oder dem Ergebnis einsteigen, sachlich.',
  fxLevel: 'aus', fxImages: false,
  ...emptyConnections() });

const empty = () => ({
  videos: {},          // id -> Video
  auth: null,          // { salt, hash }
  sessions: {},        // token-Hash -> { at, seen }
  settings: { language: 'de', autoArchive: true, trashDays: 30 },
  profiles: defaultProfiles(),                                   // Kanäle mit eigenen Verbindungen und Vorgaben
  youtube: { clientId: '', clientSecret: '' },                   // Google-App (für alle Kanäle gleich)
  tiktok: { clientKey: '', clientSecret: '', redirectUri: '' },  // TikTok-App (für alle Konten gleich)
  ai: { apiKey: '', auto: true, autoTips: true, qc: true, scout: true, hints: '', spent: 0, count: 0 },  // Claude (Anthropic-API)
  fal: { key: '', count: 0, model: 'fal-ai/flux-pro/kontext', boosts: 0,     // fal.ai: Freistellen + KI-Aufwertung
    genModel: 'fal-ai/nano-banana/edit', autoThumb: true, generated: 0 },     //   + KI-Titelbild aus Foto & Standbild
  music: { enabled: true, shorts: true, long: false, source: 'mixed', level: 'mittel', lufs: -30, duck: true, duckLevel: 'leicht', longMax: 180,  // Hintergrundmusik
    model: 'sonilo/v1.1/text-to-music', generated: 0, spent: 0, recent: [] },
  helper: { enabled: false, token: '', model: 'large-v3', lastSeen: '', name: '', gpu: '', done: 0, failed: 0 },   // Rechenhelfer-PC
  backup: { auto: true, time: '03:30', keep: 14, lastAt: '', lastFile: '', lastError: '' },        // Sicherung
  photos: [],                                                      // Fotos des Creators für Titelbilder
  cut: { auto: true, hookText: true, longVersion: true, longCopy: false, summary: 0, cutPauses: true, silenceDb: -45, minPause: 20, shorts: 3, shortMin: 15, shortMax: 60,
    voiceTrack: 'auto',                                                              // Tonspur der Stimme (OBS-Mehrspur): auto = Spur 2
    moveRaw: true, whisper: { enabled: true, model: 'small', threads: 4, gpu: true },
    window: { enabled: false, from: '01:00', to: '07:00' },                          // Nachtbetrieb
    captions: { enabled: true, color: '#FFE14D' },                                   // animierte Untertitel in Shorts
    linkedin: { format: '4:5', captions: true },                                     // Clips für LinkedIn (Profi-Stil)
    facecam: { enabled: false, auto: true, x: 0, y: 0, w: 0, h: 0 } },        // feste Facecam (enabled) bzw. automatisch erkennen (auto)                           // Bereich der Facecam (Anteile 0–1)
});

let state = empty();
let timer = null;

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.error('Speicher nicht lesbar:', e.message); }
  if (!raw) return state;
  return normalize(raw);
}

// Ganzen Stand ersetzen (Wiederherstellung einer Sicherung); Anmeldesitzungen bleiben.
export function replace(raw) {
  const sessions = state.sessions;
  normalize(raw);
  state.sessions = sessions;
  saveNow();
  return state;
}

function normalize(raw) {
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
  state.youtube = { clientId: raw.youtube?.clientId || '', clientSecret: raw.youtube?.clientSecret || '', analytics: !!raw.youtube?.analytics };
  state.tiktok = { clientKey: raw.tiktok?.clientKey || '', clientSecret: raw.tiktok?.clientSecret || '', redirectUri: raw.tiktok?.redirectUri || '', directPost: !!raw.tiktok?.directPost, statsList: !!raw.tiktok?.statsList };
  state.ai = { ...base.ai, ...raw.ai };
  state.fal = { ...base.fal, ...raw.fal };
  state.music = { ...base.music, ...raw.music };
  state.backup = { ...base.backup, ...raw.backup };
  state.helper = { ...base.helper, ...raw.helper };
  state.photos = Array.isArray(raw.photos) ? raw.photos : [];
  state.cut = { ...base.cut, ...raw.cut, whisper: { ...base.cut.whisper, ...raw.cut?.whisper },
    captions: { ...base.cut.captions, ...raw.cut?.captions }, facecam: { ...base.cut.facecam, ...raw.cut?.facecam },
    window: { ...base.cut.window, ...raw.cut?.window }, linkedin: { ...base.cut.linkedin, ...raw.cut?.linkedin } };
  for (const k of ['category', 'tags', 'footer']) delete state.settings[k];
  // 1.9: LinkedIn-Kanal einmalig ergänzen (danach darf der Kunde ihn löschen)
  if (!raw.migLinkedin && !state.profiles.some((p) => p.type === 'linkedin')) state.profiles.push(linkedinProfile());
  state.migLinkedin = true;
  // 1.25: beste Spracherkennung auf dem Rechenhelfer (genauere Wort-Zeitmarken und Satzzeichen → sauberere Schnitte)
  if (!raw.migMaxCut && state.helper?.model === 'large-v3-turbo') state.helper.model = 'large-v3';
  state.migMaxCut = true;
  // 1.27: Länge folgt dem Moment (vorher feste 30–45 s) – nur wenn der Kunde die alten Startwerte nie geändert hat
  if (!raw.migVarLen && state.cut.shortMin === 30 && state.cut.shortMax === 45) { state.cut.shortMin = 15; state.cut.shortMax = 60; }
  state.migVarLen = true;
  const defaults = Object.fromEntries(defaultProfiles().map((p) => [p.id, p]));
  for (const p of state.profiles) {
    const c = emptyConnections();
    p.youtube = { ...c.youtube, ...p.youtube };
    p.tiktok = { ...c.tiktok, ...p.tiktok };
    if (p.aiStyle === undefined) p.aiStyle = defaults[p.id]?.aiStyle || '';
    if (p.musicStyle === undefined) p.musicStyle = defaults[p.id]?.musicStyle || '';
    if (p.musicMood === undefined) p.musicMood = defaults[p.id]?.musicMood || '';
    if (p.clipHints === undefined) p.clipHints = defaults[p.id]?.clipHints || '';
    if (p.shorts === undefined && defaults[p.id]?.shorts != null) p.shorts = defaults[p.id].shorts;
    if (p.hookStyle === undefined) p.hookStyle = defaults[p.id]?.hookStyle || (p.type === 'linkedin' ? 'cold' : 'auto');
    if (p.tempo === undefined) p.tempo = defaults[p.id]?.tempo || (p.type === 'linkedin' ? 'ruhig' : 'normal');
    if (p.hookHint === undefined) p.hookHint = defaults[p.id]?.hookHint || '';
    if (p.fxLevel === undefined) p.fxLevel = defaults[p.id]?.fxLevel || (p.type === 'linkedin' ? 'aus' : 'normal');
    if (p.fxImages === undefined) p.fxImages = !!defaults[p.id]?.fxImages;
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
