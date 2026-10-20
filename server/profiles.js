// Kanäle (z. B. MichaModus = Gaming, 3dbymicha = gewerblich): je eigene YouTube-/TikTok-Verbindung und Vorgaben.
// Vorschlag, wohin ein Video gehört: Angabe aus der .json › Stichwörter in Titel/Datei/Tags › Standardkanal.
import { STYLES, HOOK_LOOKS } from './captions.js';
import crypto from 'node:crypto';
import { db, saveNow, emptyConnections } from './store.js';

export const list = () => db().profiles;
export const get = (id) => db().profiles.find((p) => p.id === id) || null;
export const isPro = (p) => p?.type === 'linkedin';   // nur Download, professioneller Stil
export const fallback = () => db().profiles.find((p) => p.isDefault && !isPro(p)) || db().profiles.find((p) => !isPro(p)) || db().profiles[0] || null;
export const proProfile = () => db().profiles.find(isPro) || null;

// Kanal aus Freitext ("3dbymicha", "MichaModus") finden.
export function find(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  return db().profiles.find((p) => p.id === t || p.name.toLowerCase() === t) || null;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const keywordsOf = (p) => String(p.keywords || '').split(',').map((k) => norm(k).trim()).filter(Boolean);

function hits(text, kw) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc(kw)}($|[^\\p{L}\\p{N}])`, 'u').test(text);
}

// { id, name, reason, manual }
export function suggest(v) {
  const manual = v.channel && get(v.channel);
  if (manual) return { id: manual.id, name: manual.name, manual: true, reason: v.channelFrom === 'json' ? 'aus der .json' : 'von dir gewählt' };
  const byAi = v.ai?.channel && get(v.ai.channel);
  if (byAi) return { id: byAi.id, name: byAi.name, manual: false, reason: 'Claude: ' + (v.ai.channelReason || 'passt zum Inhalt') };
  const title = norm(v.title + ' ' + v.file);
  const rest = norm([v.tags, v.description, v.tiktok, v.note].join(' '));
  let best = null;
  for (const p of list()) {
    if (isPro(p)) continue; // LinkedIn nur von Hand oder über den Ordner „eingang-profi“
    let score = 0; const words = [];
    for (const kw of keywordsOf(p)) {
      const inTitle = hits(title, kw.replace(/-/g, ' ')), inRest = hits(rest, kw.replace(/-/g, ' '));
      if (inTitle || inRest) { score += inTitle ? 2 : 1; if (words.length < 3) words.push(kw); }
    }
    if (score && (!best || score > best.score || (score === best.score && p.isDefault))) best = { p, score, words };
  }
  if (best) return { id: best.p.id, name: best.p.name, manual: false, reason: 'Stichwort: ' + best.words.map((w) => '„' + w + '“').join(', ') };
  const d = fallback();
  return d ? { id: d.id, name: d.name, manual: false, reason: 'Standardkanal' } : null;
}

export const effective = (v) => get(suggest(v)?.id);

// Für die Oberfläche: ohne Tokens.
export function publicProfile(p) {
  return {
    id: p.id, name: p.name, color: p.color, isDefault: !!p.isDefault, keywords: p.keywords || '', aiStyle: p.aiStyle || '',
    musicStyle: p.musicStyle || '', musicMood: p.musicMood || '', type: p.type || '', music: p.music !== false,
    clipHints: p.clipHints || '', shorts: Number.isFinite(p.shorts) ? p.shorts : null,
    hookStyle: p.hookStyle || 'auto', tempo: p.tempo || 'normal', hookHint: p.hookHint || '',
    fxLevel: p.fxLevel || 'normal', fxImages: !!p.fxImages,
    camScenes: (p.camScenes || []).length,
    coverFrame: p.coverFrame || 'aus', captionStyle: p.captionStyle || 'auto', hookLook: p.hookLook || 'auto',
    logo: p.logo || null,
    category: p.category || '20', tags: p.tags || '', footer: p.footer || '',
    youtube: { connected: !!p.youtube?.refreshToken, channel: p.youtube?.channel || null },
    tiktok: { connected: !!p.tiktok?.refreshToken && (!p.tiktok.refreshExpires || Date.now() < p.tiktok.refreshExpires),
      user: p.tiktok?.user || null, refreshExpires: p.tiktok?.refreshExpires || 0 },
  };
}

const str = (x, max) => String(x ?? '').slice(0, max);

export function update(id, b) {
  const p = get(id);
  if (!p) throw Object.assign(new Error('Kanal nicht gefunden.'), { status: 404 });
  if ('name' in b) { const n = str(b.name, 60).trim(); if (!n) throw Object.assign(new Error('Name fehlt.'), { status: 400 }); p.name = n; }
  if ('color' in b && /^#[0-9a-f]{6}$/i.test(b.color)) p.color = b.color;
  for (const [k, max] of [['aiStyle', 1000], ['keywords', 3000], ['category', 4], ['tags', 500], ['footer', 2000], ['musicStyle', 500], ['clipHints', 1000], ['hookHint', 500]]) if (k in b) p[k] = str(b[k], max);
  if (['auto', 'preview', 'cold', 'off'].includes(b.hookStyle)) p.hookStyle = b.hookStyle;
  if (['aus', 'ruhig', 'normal', 'schnell'].includes(b.tempo)) p.tempo = b.tempo;
  if (['aus', 'dezent', 'normal', 'viel'].includes(b.fxLevel)) p.fxLevel = b.fxLevel;
  if (typeof b.fxImages === 'boolean') p.fxImages = b.fxImages;
  if (['aus', 'bild', 'kurz'].includes(b.coverFrame)) p.coverFrame = b.coverFrame;
  if (b.captionStyle === 'auto' || STYLES[b.captionStyle]) p.captionStyle = b.captionStyle;
  if (b.hookLook === 'auto' || HOOK_LOOKS[b.hookLook]) p.hookLook = b.hookLook;
  if (b.clearScenes === true) p.camScenes = [];
  if ('shorts' in b) p.shorts = b.shorts === null || b.shorts === '' ? undefined : Math.max(0, Math.min(10, Math.round(Number(b.shorts)) || 0));
  if (typeof b.music === 'boolean') p.music = b.music;
  if ('musicMood' in b && ['', 'episch', 'lustig', 'spannend', 'chillig', 'energisch', 'fröhlich', 'traurig'].includes(b.musicMood)) p.musicMood = b.musicMood;
  if (b.isDefault === true && !isPro(p)) for (const q of list()) q.isDefault = q === p;
  saveNow();
  return p;
}

export function create(b) {
  const name = str(b.name, 60).trim() || 'Neuer Kanal';
  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30) || 'kanal';
  if (get(id)) id += '-' + crypto.randomBytes(2).toString('hex');
  const p = { id, name, color: '#f2b33d', isDefault: list().length === 0, aiStyle: '', musicStyle: '', musicMood: '', keywords: '', category: '20', tags: '', footer: '', ...emptyConnections() };
  list().push(p);
  saveNow();
  return p;
}

export function remove(id) {
  const p = get(id);
  if (!p) return;
  if (list().length <= 1) throw Object.assign(new Error('Mindestens ein Kanal muss bleiben.'), { status: 409 });
  if (p.youtube.refreshToken || p.tiktok.refreshToken) throw Object.assign(new Error('Erst YouTube/TikTok dieses Kanals trennen.'), { status: 409 });
  db().profiles = list().filter((q) => q !== p);
  if (p.isDefault) db().profiles[0].isDefault = true;
  for (const v of Object.values(db().videos)) if (v.channel === id) { v.channel = ''; v.channelFrom = ''; }
  saveNow();
}

// Von Hand korrigierte Facecam-Ausschnitte merken (je Kanal höchstens 8; ähnliche werden ersetzt)
export function addScene(id, box) {
  const p = get(id);
  if (!p || !box) return;
  const ov = (a, b) => { const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
    const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); return i / (a.w * a.h + b.w * b.h - i || 1); };
  p.camScenes = [{ x: box.x, y: box.y, w: box.w, h: box.h, at: new Date().toISOString() }, ...(p.camScenes || []).filter((s) => ov(s, box) < 0.6)].slice(0, 8);
  saveNow();
}
