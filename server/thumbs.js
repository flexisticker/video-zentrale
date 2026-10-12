// Titelbilder: Standbild + freigestelltes Foto des Creators + großer Text + Kanalfarbe (1280 × 720).
// Fotos werden über fal.ai freigestellt (BiRefNet), sonst wie hochgeladen genutzt (PNG mit Transparenz am besten).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as credits from './credits.js';
import { db, save, saveNow, DATA_DIR } from './store.js';
import * as profiles from './profiles.js';

const FAL = process.env.FAL_BASE || 'https://fal.run';
const PHOTO_DIR = path.join(DATA_DIR, 'fotos');
const VAR_DIR = path.join(DATA_DIR, 'varianten');
const TMP = path.join(DATA_DIR, 'tmp');
const FONT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts', 'Anton-Regular.ttf');
export const LABELS = ['überrascht', 'schockiert', 'lachend', 'jubelnd', 'zeigend', 'nachdenklich', 'cool', 'sonstiges'];

const fal = () => db().fal;
export const photos = () => db().photos;
export const photoPath = (p) => path.join(PHOTO_DIR, p.file);
export const variantPath = (v, k) => path.join(VAR_DIR, `${v.id}-${k}.jpg`);

export function falStatus() {
  return { configured: !!fal().key, keyHint: fal().key ? '…' + fal().key.slice(-4) : '', count: fal().count || 0,
    boosts: fal().boosts || 0, model: fal().model, labels: LABELS,
    genModel: fal().genModel, autoThumb: fal().autoThumb !== false, generated: fal().generated || 0 };
}
export function falConfigure(b) {
  if (typeof b.key === 'string' && b.key.trim()) fal().key = b.key.trim();
  if (typeof b.model === 'string' && /^[a-z0-9][a-z0-9\-/.]{2,80}$/i.test(b.model.trim())) fal().model = b.model.trim();
  if (typeof b.genModel === 'string' && /^[a-z0-9][a-z0-9\-/.]{2,80}$/i.test(b.genModel.trim())) fal().genModel = b.genModel.trim();
  if (typeof b.autoThumb === 'boolean') fal().autoThumb = b.autoThumb;
  if (b.removeKey === true) fal().key = '';
  saveNow();
}

const isPng = (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isJpg = (b) => b[0] === 0xff && b[1] === 0xd8;
const isWebp = (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP';
// PNG mit Alphakanal? (Farbtyp 4 oder 6 im IHDR)
const pngHasAlpha = (b) => isPng(b) && (b[25] === 4 || b[25] === 6);

async function removeBackground(buf, mime) {
  const r = await fetch(FAL + '/fal-ai/birefnet', {
    method: 'POST',
    headers: { Authorization: 'Key ' + fal().key, 'Content-Type': 'application/json' },
    // „Portrait“-Modell in hoher Auflösung: sauberere Haarkanten bei Personenfotos (Schema per fal-Connector geprüft)
    body: JSON.stringify({ image_url: `data:${mime};base64,${buf.toString('base64')}`, model: 'Portrait', operating_resolution: '2048x2048', output_format: 'png' }),
  });
  const j = await r.json().catch(() => ({}));
  { const fe = credits.falError(r.status, j); if (fe) throw new Error(fe); }
  if (!r.ok || !j.image?.url) throw new Error('fal.ai: ' + (j.detail?.[0]?.msg || j.detail || j.error || r.status));
  const img = await fetch(j.image.url);
  if (!img.ok) throw new Error('fal.ai: Ergebnis nicht abrufbar.');
  fal().count = (fal().count || 0) + 1;
  return Buffer.from(await img.arrayBuffer());
}

export async function addPhoto(buf, { label, channel }) {
  if (!isPng(buf) && !isJpg(buf) && !isWebp(buf)) throw Object.assign(new Error('Nur JPG, PNG oder WebP.'), { status: 400 });
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const id = crypto.randomBytes(6).toString('hex');
  let out = buf, cut = pngHasAlpha(buf), note = '';
  if (!cut && fal().key) {
    try { out = await removeBackground(buf, isPng(buf) ? 'image/png' : isJpg(buf) ? 'image/jpeg' : 'image/webp'); cut = true; }
    catch (e) { note = e.message; }
  }
  const ext = isPng(out) ? '.png' : isJpg(out) ? '.jpg' : '.webp';
  fs.writeFileSync(path.join(PHOTO_DIR, id + ext), out);
  const p = { id, file: id + ext, label: LABELS.includes(label) ? label : 'sonstiges', channel: profiles.get(channel) ? channel : '',
    cut, note, at: new Date().toISOString(), rev: Date.now() };
  photos().push(p);
  saveNow();
  return p;
}

export async function recut(id) {
  const p = photos().find((x) => x.id === id);
  if (!p) throw Object.assign(new Error('Foto nicht gefunden.'), { status: 404 });
  if (!fal().key) throw new Error('Kein fal.ai-Schlüssel eingetragen.');
  const buf = fs.readFileSync(photoPath(p));
  const out = await removeBackground(buf, isPng(buf) ? 'image/png' : isJpg(buf) ? 'image/jpeg' : 'image/webp');
  fs.rmSync(photoPath(p), { force: true });
  p.file = p.id + '.png'; p.cut = true; p.note = '';
  p.rev = Date.now(); // neue Bildadresse, sonst zeigt der Browser das alte Bild aus dem Zwischenspeicher
  fs.writeFileSync(photoPath(p), out);
  saveNow();
  return p;
}

export function updatePhoto(id, b) {
  const p = photos().find((x) => x.id === id);
  if (!p) throw Object.assign(new Error('Foto nicht gefunden.'), { status: 404 });
  if (LABELS.includes(b.label)) p.label = b.label;
  if (typeof b.channel === 'string') p.channel = profiles.get(b.channel) ? b.channel : '';
  saveNow();
  return p;
}

export function removePhoto(id) {
  const p = photos().find((x) => x.id === id);
  if (!p) return;
  fs.rmSync(photoPath(p), { force: true });
  db().photos = photos().filter((x) => x !== p);
  saveNow();
}

// Fotos, die für einen Kanal infrage kommen
export const photosFor = (channelId) => photos().filter((p) => !p.channel || p.channel === channelId);

function ffmpeg(args) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
    p.on('error', (e) => resolve({ code: -1, err: e.message }));
    p.on('close', (code) => resolve({ code, err }));
  });
}

// Text auf höchstens 2 Zeilen verteilen
function lines(text) {
  const words = String(text || '').toUpperCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 6);
  if (words.length <= 1 || words.join(' ').length <= 11) return [words.join(' ')];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const d = Math.max(a.length, b.length);
    if (!best || d < best.d) best = { d, l: [a, b] };
  }
  return best.l;
}

const hex = (c) => '0x' + String(c || '#7c5cff').replace('#', '').slice(0, 6);
const rgb = (c) => { const h = String(c || '#7c5cff').replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0); };

// Ein Titelbild bauen. side = Seite des Fotos ('right' | 'left').
export async function compose({ frame, photo, text, side = 'right', color, out }) {
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const L = lines(text);
  const maxLen = Math.max(1, ...L.map((l) => l.length));
  const size = Math.max(70, Math.min(150, Math.floor(600 / (maxLen * 0.46))));
  const files = L.map((l, i) => { const f = path.join(TMP, `${crypto.randomBytes(4).toString('hex')}-t${i}.txt`); fs.writeFileSync(f, l); return f; });
  const textX = photo ? (side === 'right' ? '60' : 'w-text_w-60') : '(w-text_w)/2';
  const lineH = Math.round(size * 1.05);
  const top = Math.round(360 - (L.length * lineH) / 2);
  const draw = files.map((f, i) => `drawtext=fontfile=${FONT}:textfile=${f}:fontsize=${size}:fontcolor=${i === 0 ? '0xFFE14D' : 'white'}`
    + `:borderw=${Math.round(size / 14)}:bordercolor=black:shadowx=4:shadowy=6:shadowcolor=black@0.6:x=${textX}:y=${top + i * lineH}`).join(',');
  const shade = photo ? (side === 'right' ? 'drawbox=x=0:y=0:w=760:h=720:color=black@0.35:t=fill' : 'drawbox=x=520:y=0:w=760:h=720:color=black@0.35:t=fill')
    : 'drawbox=x=0:y=0:w=1280:h=720:color=black@0.25:t=fill';
  const bg = `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,eq=saturation=1.35:contrast=1.1:brightness=0.02,unsharp=5:5:0.6,${shade}[bg]`;
  let graph, inputs = ['-i', frame];
  if (photo) {
    const [r, g, b] = rgb(color);
    const px = side === 'right' ? 'W-w+10' : '-10';
    inputs.push('-i', photo);
    graph = `${bg};[1:v]format=rgba,scale=w='if(gt(iw/ih,1.05),720,-1)':h='if(gt(iw/ih,1.05),-1,700)'[p];[p]split[p1][p2];`
      + `[p2]lutrgb=r=${r}:g=${g}:b=${b},boxblur=16:1[glow];[bg][glow]overlay=x=${px}:y=H-h+12[b1];[b1][p1]overlay=x=${px}:y=H-h+12[b2];`
      + `[b2]drawbox=x=0:y=ih-14:w=iw:h=14:color=${hex(color)}:t=fill,${draw}[out]`;
  } else {
    graph = `${bg};[bg]drawbox=x=0:y=ih-14:w=iw:h=14:color=${hex(color)}:t=fill,${draw}[out]`;
  }
  const r = await ffmpeg([...inputs, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', '-q:v', '3', out]);
  for (const f of files) fs.rmSync(f, { force: true });
  if (r.code !== 0) throw new Error('Titelbild: ' + r.err.trim().split('\n').pop());
  return out;
}

// 3 Varianten zu einem Video (Vorschläge von Claude in v.ai.thumbs, sonst einfache Auswahl).
// framePathOf(n) liefert den Pfad des Standbilds n.
export async function makeVariants(v, framePathOf) {
  if (v.height > v.width) return []; // Hochformat: Titelbild wählt man in TikTok/Shorts selbst
  const ch = profiles.effective(v);
  const color = ch?.color;
  const avail = photosFor(ch?.id);
  const byLabel = (label, i) => avail.find((p) => p.label === label) || avail[i % Math.max(1, avail.length)];
  const fallbackText = (v.ai?.thumbnailText || v.title || '').split(/\s+/).slice(0, 3).join(' ');
  // photo: Ausdruck (Claude) · '' = bewusst ohne Foto · undefined = irgendein Foto der Reihe nach
  const plan = (v.ai?.thumbs?.length ? v.ai.thumbs : [
    { frame: v.ai?.thumbnailFrame || 2, text: fallbackText, side: 'right' },
    { frame: 4, text: fallbackText, side: 'left' },
    { frame: 5, photo: '', text: fallbackText, side: 'right' },
  ]).slice(0, 3);
  const out = [];
  for (let k = 0; k < plan.length; k++) {
    const t = plan[k];
    const frame = framePathOf(t.frame) || framePathOf(2) || framePathOf(1);
    if (!frame) continue;
    const ph = !avail.length || t.photo === '' ? null : t.photo ? byLabel(t.photo, k) : avail[k % avail.length];
    try {
      await compose({ frame, photo: ph ? photoPath(ph) : null, text: t.text || fallbackText, side: t.side === 'left' ? 'left' : 'right', color, out: variantPath(v, k + 1) });
      out.push({ k: k + 1, text: t.text || fallbackText, photo: ph?.label || '', frame: t.frame, side: t.side });
    } catch (e) { console.error(e.message); }
  }
  v.thumbVariants = out;
  v.thumbVariantsAt = Date.now();
  save();
  return out;
}

// KI-Aufwertung einer Variante über fal.ai (Bildbearbeitungs-Modell, Standard FLUX Kontext) → Variante 4.
const BOOST_PROMPT = 'Enhance this YouTube thumbnail so it attracts more clicks: dramatic cinematic lighting, vivid but natural colors, '
  + 'stronger depth and contrast in the background, a subtle colored rim light around the person. Keep the person\'s face, identity, '
  + 'expression and pose exactly the same. Keep all text exactly as it is (same words, same spelling, same position). Do not add any new text, logos or watermarks.';

export async function boost(v, k) {
  if (!fal().key) throw new Error('Kein fal.ai-Schlüssel eingetragen (Einstellungen → Titelbilder).');
  const src = variantPath(v, k);
  if (!fs.existsSync(src)) throw Object.assign(new Error('Variante nicht gefunden.'), { status: 404 });
  const model = fal().model || 'fal-ai/flux-pro/kontext';
  const r = await fetch(`${FAL}/${model}`, {
    method: 'POST',
    headers: { Authorization: 'Key ' + fal().key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: BOOST_PROMPT, image_url: 'data:image/jpeg;base64,' + fs.readFileSync(src).toString('base64'),
      num_images: 1, output_format: 'jpeg', aspect_ratio: '16:9' }),
  });
  const j = await r.json().catch(() => ({}));
  { const fe = credits.falError(r.status, j); if (fe) throw new Error(fe); }
  const url = j.images?.[0]?.url || j.image?.url;
  if (!r.ok || !url) throw new Error('fal.ai: ' + (j.detail?.[0]?.msg || j.detail || j.error || r.status));
  const img = await fetch(url);
  if (!img.ok) throw new Error('fal.ai: Ergebnis nicht abrufbar.');
  const raw = path.join(TMP, `${v.id}-boost-raw`);
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(raw, Buffer.from(await img.arrayBuffer()));
  // auf 1280 × 720 bringen (Modelle liefern mitunter andere Größen)
  const out = variantPath(v, 4);
  const res = await ffmpeg(['-i', raw, '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720', '-frames:v', '1', '-q:v', '3', out]);
  fs.rmSync(raw, { force: true });
  if (res.code !== 0) throw new Error('KI-Bild nicht lesbar.');
  fal().boosts = (fal().boosts || 0) + 1;
  v.thumbVariants = [...(v.thumbVariants || []).filter((x) => x.k !== 4), { k: 4, text: 'KI-Aufwertung', ai: true, from: k }];
  v.thumbVariantsAt = Date.now();
  saveNow();
  return v.thumbVariants;
}

// KI-Titelbild: Bild-KI (Standard Nano Banana Edit) bekommt Foto des Creators + Standbild + Bildidee von Claude → Variante 5.
export const autoAiThumb = () => !!fal().key && fal().autoThumb !== false;

const toDataUri = (file) => {
  const buf = fs.readFileSync(file);
  const mime = isPng(buf) ? 'image/png' : isWebp(buf) ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
};

// Bildaufbau-Ideen für mehrere Vorschläge (Variante 1 = Claudes Szene, falls vorhanden)
const STYLES = [
  'Reaction layout: the person large on one side with a strong emotion, the key moment of the video on the other side.',
  'Close-up: extreme close-up of the person\'s face with an exaggerated emotion, the scene blurred and dramatic behind, headline on the opposite side.',
  'Focus on the moment: the most important object or action from the frame large in the center, highlighted with a glowing outline or arrow, the person smaller in a corner reacting.',
];

const PRO_STYLES = [
  'Professional portrait layout: the person on one side, calm and confident, looking into the camera; the product or workshop scene on the other side.',
  'Product hero shot: the finished product from the frame large and sharp in the center on a clean background, the person small in a corner.',
  'Behind the scenes: the person working at the machine or workbench, natural light, the headline in a clean area at the top.',
];

// Ein KI-Titelbild erzeugen → Variante k
async function genOne(v, { k, frame, photo, text, scene, vertical }) {
  const ch = profiles.effective(v);
  const pro = profiles.isPro(ch);
  const color = ch?.color || '#7c5cff';
  const images = photo ? [toDataUri(photoPath(photo)), toDataUri(frame)] : [toDataUri(frame)];
  const prompt = [
    `Create a high-impact, click-worthy ${vertical ? 'vertical 9:16 cover for a short video (TikTok / YouTube Shorts)' : 'YouTube thumbnail in 16:9'}.`,
    photo ? 'Use the person from the FIRST image as the main subject: keep his face, identity, hairstyle and skin tone exactly the same; large, sharp and well lit, filling about 40% of the frame.' : '',
    `Use the ${photo ? 'SECOND' : 'FIRST'} image (a frame from the video) as the scene and background reference.`,
    scene ? 'Composition: ' + scene : '',
    text ? (pro ? `Add the headline text "${text}" in a clean bold sans-serif, spelled exactly like that, at most two lines, well readable, with a subtle shadow.`
      : `Add the headline text "${text}" in huge bold uppercase letters with a thick dark outline, spelled exactly like that, at most two lines, highly readable on a phone.`) : 'No text.',
    pro ? `Clean, professional, trustworthy business look for LinkedIn: calm friendly expression, natural light, workshop or product in focus, `
      + `modern sans-serif headline, accent color ${color}, no exaggerated emotions, no comic effects, no clickbait arrows.`
      : `Accent color ${color}. Vivid colors, strong contrast, depth, professional ${vertical ? 'short-video' : 'YouTube'} style.`,
    'No other text, no watermarks, no logos, no borders.',
  ].filter(Boolean).join(' ');
  const r = await fetch(`${FAL}/${fal().genModel || 'fal-ai/nano-banana/edit'}`, {
    method: 'POST',
    headers: { Authorization: 'Key ' + fal().key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_urls: images, aspect_ratio: vertical ? '9:16' : '16:9', output_format: 'jpeg', num_images: 1 }),
  });
  const j = await r.json().catch(() => ({}));
  { const fe = credits.falError(r.status, j); if (fe) throw new Error(fe); }
  const url = j.images?.[0]?.url;
  if (!r.ok || !url) throw new Error('fal.ai: ' + (j.detail?.[0]?.msg || j.detail || j.error || r.status));
  const img = await fetch(url);
  if (!img.ok) throw new Error('fal.ai: Ergebnis nicht abrufbar.');
  fs.mkdirSync(TMP, { recursive: true }); fs.mkdirSync(VAR_DIR, { recursive: true });
  const raw = path.join(TMP, `${v.id}-ai-raw-${k}`);
  fs.writeFileSync(raw, Buffer.from(await img.arrayBuffer()));
  const size = vertical ? '1080:1920' : '1280:720';
  const res = await ffmpeg(['-i', raw, '-vf', `scale=${size}:force_original_aspect_ratio=increase,crop=${size}`, '-frames:v', '1', '-q:v', '3', variantPath(v, k)]);
  fs.rmSync(raw, { force: true });
  if (res.code !== 0) throw new Error('KI-Bild nicht lesbar.');
  fal().generated = (fal().generated || 0) + 1;
  return { k, text, ai: true, gen: true, photo: photo?.label || '', vertical: !!vertical };
}

// Bisheriger Einzelaufruf (automatisch nach Claudes Vorschlag): ein KI-Titelbild → Variante 5
export async function generateAi(v, framePathOf) {
  return generateAiOptions(v, framePathOf, { count: 1 });
}

// 1–3 KI-Titelbilder zur Auswahl → Varianten 5, 6, 7 (ersetzen frühere KI-Titelbilder).
// Geht auch nachträglich und ohne Claude-Vorschlag (dann Titel als Text, Standbilder gleichmäßig verteilt).
export async function generateAiOptions(v, framePathOf, { count = 1, text: customText } = {}) {
  if (!fal().key) throw new Error('Kein fal.ai-Schlüssel eingetragen (Einstellungen → Titelbilder).');
  const n = Math.max(1, Math.min(3, Number(count) || 1));
  const idea = v.ai?.aiThumb || { frame: v.ai?.thumbnailFrame || 2, photo: '', text: v.ai?.thumbnailText || '', scene: '' };
  const frames = [idea.frame, 2, 4, 3, 5, 1, 6].filter((x, i, a) => a.indexOf(x) === i).map((x) => framePathOf(x)).filter(Boolean);
  if (!frames.length) throw new Error('Keine Standbilder vom Video.');
  const ch = profiles.effective(v);
  const avail = photosFor(ch?.id);
  // Claude wollte bewusst kein Foto (z. B. 3D-Druck-Produkt im Fokus) → erste Variante ohne Foto
  const first = idea.photo === '' && v.ai?.aiThumb ? null : (avail.find((p) => p.label === idea.photo) || avail[0] || null);
  const others = avail.filter((p) => p !== first);
  const shortTitle = String(v.title || '').replace(/[#|–-].*$/, '').split(/\s+/).slice(0, 4).join(' ');
  const rawText = String(customText != null && String(customText).trim() ? customText : (idea.text || shortTitle));
  const text = (profiles.isPro(ch) ? rawText : rawText.toUpperCase()).slice(0, 40);
  const vertical = v.height > v.width;
  const styles = profiles.isPro(ch) ? PRO_STYLES : STYLES;
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push({ k: 5 + i, frame: frames[i % frames.length], photo: i === 0 ? first : (others[i - 1] || avail[0] || null),
      text, scene: i === 0 && idea.scene ? idea.scene : styles[(idea.scene ? i - 1 : i) % styles.length], vertical });
  }
  // fal erlaubt neuen Konten 2 gleichzeitige Anfragen
  const results = [];
  const errors = [];
  for (let i = 0; i < jobs.length; i += 2) {
    const part = await Promise.allSettled(jobs.slice(i, i + 2).map((j) => genOne(v, j)));
    for (const r of part) r.status === 'fulfilled' ? results.push(r.value) : errors.push(r.reason?.message || String(r.reason));
  }
  if (!results.length) throw new Error(errors[0] || 'KI-Titelbild fehlgeschlagen.');
  v.thumbVariants = [...results, ...(v.thumbVariants || []).filter((x) => !x.gen)];
  v.thumbVariantsAt = Date.now();
  if (v.ai) v.ai.aiThumbError = errors.length ? `${errors.length} von ${n} nicht erzeugt: ${errors[0]}` : '';
  saveNow();
  return v.thumbVariants;
}

// ---------- KI-Sticker für Shorts (Effekt „sticker“) ----------
// Aus einem freigestellten Foto des Kanals (sonst ohne Person) ein Comic-Sticker zur Idee; freigestellt als PNG,
// je Idee + Foto nur einmal erzeugt (/data/sticker). Kosten: Bild ca. 0,04 $ + Freistellen.
const STICKER_DIR = path.join(DATA_DIR, 'sticker');
export async function makeSticker(idea, channelId) {
  const text = String(idea || '').trim().slice(0, 300);
  if (!text || !fal().key) return null;
  const list = photosFor(channelId);
  // Foto passend zur Stimmung wählen (Label im Text), sonst das erste
  const photo = list.find((p) => p.label && text.toLowerCase().includes(String(p.label).toLowerCase())) || list[0] || null;
  const key = crypto.createHash('sha1').update(text.toLowerCase() + '|' + (photo?.id || '')).digest('hex').slice(0, 16);
  const out = path.join(STICKER_DIR, key + '.png');
  if (fs.existsSync(out)) return out;
  const prompt = [
    photo ? 'Turn the person from the image into an expressive cartoon sticker; keep his face recognizable.' : 'An expressive cartoon sticker.',
    `Scene/idea: ${text}.`,
    'Bold clean outlines, vivid colors, exaggerated emotion, thick white sticker border, centered, isolated on a plain solid white background. No text, no letters, no watermark.',
  ].join(' ');
  const model = photo ? 'fal-ai/nano-banana/edit' : 'fal-ai/nano-banana';
  const r = await fetch(`${FAL}/${model}`, {
    method: 'POST', headers: { Authorization: 'Key ' + fal().key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, ...(photo ? { image_urls: [toDataUri(photoPath(photo))] } : {}), aspect_ratio: '1:1', output_format: 'png', num_images: 1 }),
  });
  const j = await r.json().catch(() => ({}));
  { const fe = credits.falError(r.status, j); if (fe) throw new Error(fe); }
  const url = j.images?.[0]?.url;
  if (!r.ok || !url) throw new Error('fal.ai-Sticker: ' + (j.detail?.[0]?.msg || j.detail || j.error || r.status));
  const img = await fetch(url);
  if (!img.ok) throw new Error('fal.ai-Sticker: Ergebnis nicht abrufbar.');
  const buf = Buffer.from(await img.arrayBuffer());
  fs.mkdirSync(STICKER_DIR, { recursive: true });
  let png = buf;
  try { png = await removeBackground(buf, 'image/png'); } catch (e) { console.error('Sticker freistellen:', e.message); }
  fs.writeFileSync(out, png);
  fal().generated = (fal().generated || 0) + 1;
  saveNow();
  return out;
}
