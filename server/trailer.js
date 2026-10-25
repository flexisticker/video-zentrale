// Kanal-Trailer / Highlight-Video: die stärksten Momente QUER über alle Videos eines Kanals, max. ~5 Minuten.
//  1. Sammeln: alle Shorts des Kanals (Zeitraum wählbar), bewertet nach Viral-Punkten, echten Aufrufen (stats.js), Prüfung, Twitch-Clips
//  2. Claude baut die Dramaturgie: stärkster Einstieg, Steigerung, bestes Highlight zum Schluss – je Moment nur die besten Sekunden (ganze Sätze)
//  3. Schnitt: jeder Moment als eigene Eingabe (Rohvideo, sonst der fertige Short), Bildaufbau wie im Short (9:16) bzw. 16:9 mit Blur bei Hochformat,
//     weißer Blitz + Whoosh an jedem Schnitt, Texte („PLATZ 1“), Logo-Intro/-Outro („Jetzt abonnieren“), Logo als Wasserzeichen, Musik mit Ducking.
// Logo je Kanal: hochladen oder vom YouTube-/Twitch-Profilbild holen (rund ausgeschnitten) → /data/logos/<kanal>.png
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db, save, saveNow, DATA_DIR } from './store.js';
import * as lib from './library.js';
import * as profiles from './profiles.js';
import * as whisper from './whisper.js';
import * as bounds from './bounds.js';
import * as ai from './ai.js';
import * as gpu from './gpu.js';
import * as music from './music.js';
import * as sfx from './sfx.js';
import * as layout from './layout.js';
import * as signals from './signals.js';
import { buildAss } from './captions.js';

const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts');
const ANTON = path.join(FONTS, 'Anton-Regular.ttf');
const TMP = path.join(DATA_DIR, 'tmp');
export const LOGO_DIR = path.join(DATA_DIR, 'logos');
export const logoPath = (profileId) => path.join(LOGO_DIR, String(profileId).replace(/[^\w-]/g, '') + '.png');

const store = () => { const d = db(); if (!d.trailers) d.trailers = []; return d.trailers; };
export const list = () => store().slice(-20).reverse();

function run(cmd, args, onLine) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn('nice', ['-n', '15', cmd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const feed = (d) => { const s = d.toString(); err = (err + s).slice(-6000); if (onLine) for (const l of s.split(/\r?\n/)) onLine(l); };
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    p.on('error', (e) => resolve({ code: -1, err: e.message }));
    p.on('close', (code) => resolve({ code, err }));
  });
}
const ffmpeg = (args, onLine) => run('ffmpeg', ['-hide_banner', '-nostdin', ...args], onLine);
const lastError = (r) => r.err.trim().split('\n').filter((l) => !/^\s*(frame=|size=|out_time|progress=|speed=|bitrate=|total_size|dup_frames|drop_frames|stream_)/.test(l))
  .filter((l) => !/Conversion failed|Error while (processing|filtering)|Terminating thread|Nothing was written/i.test(l)).slice(-2).join(' ').slice(0, 500);

// ---------- Logo ----------
// beliebiges Bild → PNG (max. 1024 px); round = rund ausschneiden (Profilbilder)
export async function saveLogo(profileId, buf, { round = false, source = 'upload' } = {}) {
  const p = profiles.get(profileId);
  if (!p) throw new Error('Kanal nicht gefunden.');
  fs.mkdirSync(LOGO_DIR, { recursive: true });
  const src = path.join(TMP, `logo-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(src, buf);
  const vf = 'scale=1024:1024:force_original_aspect_ratio=decrease,format=rgba'
    + (round ? ",crop='min(iw,ih)':'min(iw,ih)',geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-W/2,Y-H/2),W/2-1),alpha(X,Y),0)'" : '');
  const r = await ffmpeg(['-loglevel', 'error', '-y', '-i', src, '-vf', vf, '-frames:v', '1', logoPath(profileId)]);
  fs.rmSync(src, { force: true });
  if (r.code !== 0) throw new Error('Bild nicht lesbar (PNG, JPG oder WebP nehmen).');
  p.logo = { at: new Date().toISOString(), source };
  saveNow();
  return p.logo;
}

// Profilbild vom verbundenen YouTube-Kanal bzw. Twitch-Konto holen
export async function fetchLogo(profileId, from, { youtube, twitch }) {
  let url = '';
  if (from === 'youtube') url = await youtube.channelImage(profiles.get(profileId));
  else if (from === 'twitch') url = await twitch.profileImage();
  if (!url) throw new Error(from === 'youtube' ? 'Kein Profilbild gefunden – ist YouTube für diesen Kanal verbunden?' : 'Kein Profilbild gefunden – ist Twitch verbunden?');
  const r = await fetch(url);
  if (!r.ok) throw new Error('Profilbild nicht ladbar (' + r.status + ').');
  return saveLogo(profileId, Buffer.from(await r.arrayBuffer()), { round: true, source: from });
}

// ---------- Kandidaten ----------
const createdMs = (v) => Date.parse(v.createdAt || '') || v.mtime || 0;
function candidates(profileId, days) {
  const since = days ? Date.now() - days * 86400_000 : 0;
  const vids = Object.values(db().videos).filter((v) => !v.missing && v.source?.kind === 'short' && ['geschnitten', 'hochgeladen'].includes(v.folder)
    && profiles.effective(v)?.id === profileId && createdMs(v) >= since);
  // je Rohvideo-Stelle nur eine Fassung (die beste)
  const perf = (v) => { const r = [v.perf?.yt?.views, v.perf?.tt?.views].filter(Number.isFinite); return r.length ? r.reduce((a, b) => a + b, 0) : null; };
  const allViews = vids.map(perf).filter((x) => x != null).sort((a, b) => a - b);
  const med = allViews.length ? Math.max(1, allViews[Math.floor(allViews.length / 2)]) : 0;
  const score = (v) => (v.viral?.score || 5) + (med && perf(v) != null ? Math.min(6, 3 * perf(v) / med) : 0) + (v.qc?.ok === false ? -1 : 0)
    + ((v.edit?.signals || []).some((s) => /Zuschauer-Clip/.test(s)) ? 2 : 0);
  const out = [];
  for (const v of vids.sort((a, b) => score(b) - score(a))) {
    const raw = db().videos[v.source.rawId];
    const useRaw = raw && !raw.missing && fs.existsSync(lib.fileOf(raw));
    const key = v.source.rawId;
    if (useRaw && out.some((c) => c.rawId === key && c.start < v.source.end && c.end > v.source.start)) continue;
    out.push({ id: v.id, title: v.title || v.file, score: Math.round(score(v) * 10) / 10, viral: v.viral?.score || null, views: perf(v),
      topic: v.topic || raw?.ai?.game || v.ai?.game || '', rawId: useRaw ? raw.id : null,
      file: useRaw ? lib.fileOf(raw) : lib.fileOf(v), start: useRaw ? v.source.start : 0, end: useRaw ? v.source.end : (v.duration || 30),
      vertical: useRaw ? raw.height > raw.width : true, fromShort: !useRaw, w: useRaw ? raw.width : v.width, h: useRaw ? raw.height : v.height,
      mirror: useRaw && !!raw.mirror, layout: v.source.layout || v.edit?.layout || null, text: v.transcriptText || '' });
    if (out.length >= 60) break;
  }
  return out;
}

// ---------- Planen (Claude) ----------
async function plan(t, cands, profile) {
  const lines = [];
  const sentsOf = new Map();
  for (const [i, c] of cands.entries()) {
    let said = '';
    if (c.rawId) {
      if (!sentsOf.has(c.rawId)) { const w = whisper.loadWords(db().videos[c.rawId]); sentsOf.set(c.rawId, { words: w, sents: bounds.numbered(w ? whisper.sentences(w) : []) }); }
      said = bounds.sentenceLines(sentsOf.get(c.rawId).sents, c.start, c.end, 900);
    } else said = c.text ? 'Gesprochen (ohne Zeiten): ' + c.text.slice(0, 400) : '';
    lines.push(`Moment ${i + 1}: „${c.title}“${c.topic ? ` [${c.topic}]` : ''} – Sekunde ${c.start.toFixed(1)}–${c.end.toFixed(1)}`
      + `${c.viral ? `, Viral ${c.viral}/10` : ''}${c.views != null ? `, ${c.views} Aufrufe` : ''}${c.fromShort ? ' (nur fertiger Short vorhanden – Sätze ohne Nummern)' : ''}\n${said}`);
  }
  const content = [{ type: 'text', text: [
    `Du schneidest einen ${t.opts.format === '9:16' ? 'Highlight-Short (Hochformat)' : 'Kanal-Trailer (YouTube, 16:9)'} für den Kanal „${profile.name}“. Ziel-Länge: ${t.opts.seconds} Sekunden (nicht mehr als +10 %).`,
    `Kanalbeschreibung: ${profile.aiStyle || ''}`,
    'Nimm nur das Allerbeste quer über alle Momente: pro Moment nur die stärksten Sekunden (meist 3–12 s, eine Pointe/Reaktion kann bis 20 s), nichts Langweiliges, keine Erklärungen ohne Pointe.',
    'Dramaturgie: der härteste Moment GANZ VORNE (die ersten 3 Sekunden entscheiden), danach Abwechslung (verschiedene Spiele/Themen, Lacher, Rage, Skill), Tempo steigern, das beste Highlight zum Schluss vor dem Outro.',
    'Jeder Moment darf nur einmal vorkommen. Schneide auf ganze Sätze oder direkt nach der Reaktion – nie mitten im Wort.',
    'Gib je Moment die Satznummern (fromSentence/toSentence, 0 wenn keine) UND start/end in Sekunden der Quelle an (innerhalb des Moments).',
    'text = optional kurze Einblendung (höchstens 4 Wörter, z. B. „Er hat es geschafft“), sonst leer – sparsam, nicht bei jedem Moment.',
    `title = Titel des Videos; tagline = Satz fürs Intro (höchstens 6 Wörter, z. B. „Rage, Lacher und Clutches“); outro = Aufruf am Ende (höchstens 5 Wörter, z. B. „Jetzt abonnieren!“).`,
    t.opts.wish ? `WUNSCH DES CREATORS: „${t.opts.wish}“` : '',
    ai.SENTENCE_RULES,
    '', 'Momente (beste zuerst vorsortiert nach Viral-Punkten und echten Aufrufen):', lines.join('\n\n'),
  ].filter(Boolean).join('\n') }];
  const schema = { type: 'object', additionalProperties: false, required: ['title', 'tagline', 'outro', 'moments'], properties: {
    title: { type: 'string' }, tagline: { type: 'string' }, outro: { type: 'string' },
    moments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['moment', 'fromSentence', 'toSentence', 'start', 'end', 'text'], properties: {
      moment: { type: 'integer' }, fromSentence: { type: 'integer' }, toSentence: { type: 'integer' }, start: { type: 'number' }, end: { type: 'number' }, text: { type: 'string' } } } } } };
  const o = await ai.cutCall(content, schema, { task: 'trailer' });
  const segs = [];
  let total = 0;
  for (const m of o.moments || []) {
    const c = cands[m.moment - 1];
    if (!c) continue;
    const S = c.rawId ? sentsOf.get(c.rawId) : null;
    let a = Number(m.start), b = Number(m.end);
    const bs = S ? bounds.fromSentences(S.sents, m.fromSentence, m.toSentence) : null;
    if (bs && bs.start >= c.start - 5 && bs.end <= c.end + 5) { a = bs.start; b = bs.end; }
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    a = Math.max(c.start - 2, a); b = Math.min(c.end + 2, b);
    if (S?.words) { const r = bounds.snapRange(a, b, { sents: S.sents, words: S.words, dur: Infinity, minLen: 2, maxLen: 22 }); a = r.start; b = r.end; }
    if (b - a < 1.5) continue;
    if (b - a > 25) b = a + 25;
    if (segs.some((x) => x.file === c.file && a < x.b && b > x.a)) continue;
    if (total + (b - a) > t.opts.seconds * 1.1 && segs.length >= 3) break;
    segs.push({ cand: c, file: c.file, a: Math.max(0, a), b, text: String(m.text || '').slice(0, 40), words: S?.words || null });
    total += b - a;
  }
  return { title: String(o.title || '').slice(0, 100), tagline: String(o.tagline || '').slice(0, 60), outro: String(o.outro || 'Jetzt abonnieren!').slice(0, 40), segs };
}

// ohne Claude: beste Momente der Reihe nach, je ~8 s um die Mitte
function planSimple(t, cands) {
  const segs = [];
  let total = 0;
  for (const c of cands) {
    const len = Math.min(10, c.end - c.start);
    const mid = (c.start + c.end) / 2;
    segs.push({ cand: c, file: c.file, a: Math.max(c.start, mid - len / 2), b: Math.min(c.end, mid + len / 2), text: '' });
    total += len;
    if (total >= t.opts.seconds) break;
  }
  return { title: '', tagline: '', outro: 'Jetzt abonnieren!', segs };
}

// ---------- Schnitt ----------
const esc = (s) => String(s).replace(/\\/g, '').replace(/'/g, '’').replace(/:/g, '\\:').replace(/%/g, '\\%');
const assTime = (s) => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h}:${String(m).padStart(2, '0')}:${x.toFixed(2).padStart(5, '0')}`; };
const assClean = (t) => String(t).replace(/[{}\\]/g, '').trim();

// Bild eines Moments auf das Zielformat bringen (eigene Label-Namen je Moment)
function frameFilter(seg, i, W, H) {
  const c = seg.cand;
  const pre = `[${i}:v:0]${c.mirror ? 'hflip,' : ''}setpts=PTS-STARTPTS,fps=30,setsar=1`;
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  if (W < H) {   // Hochformat-Ziel
    if (c.vertical || !c.w) return `${pre},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[s${i}];`;
    const L0 = c.layout?.mode ? c.layout : { mode: 'crop', focus: 0.5 };
    const L = c.mirror ? layout.mirrorLayout(L0) : L0;
    const g = layout.graph(`x${i}`, `s${i}`, { srcW: even(c.w), srcH: even(c.h), layout: L, W, H }).graph
      .replace(/\[(m0|ma|mb|top|bot|bg|fg|r0|ra|rb|rt|rbt|big|norm)\]/g, `[t${i}$1]`);
    return `${pre}[x${i}];${g};`;
  }
  // Querformat-Ziel: Hochformat-Quellen mittig auf unscharfem Hintergrund
  if (c.vertical) return `${pre},split[a${i}][b${i}];[a${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2,eq=brightness=-0.1[bg${i}];`
    + `[b${i}]scale=-2:${H}[fg${i}];[bg${i}][fg${i}]overlay=(W-w)/2:0[s${i}];`;
  return `${pre},scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2[s${i}];`;
}

async function render(t, p, profile, step) {
  const vertical = t.opts.format === '9:16';
  const [W, H] = vertical ? [1080, 1920] : [1920, 1080];
  const logo = fs.existsSync(logoPath(profile.id)) ? logoPath(profile.id) : null;
  const INTRO = t.opts.intro !== false ? 2.6 : 0, OUTRO = t.opts.intro !== false ? 4 : 0;
  const inputs = [];
  let g = '';
  const parts = [];   // [label video, label audio, Dauer]
  // Intro-Karte: Logo poppt auf, Kanalname + Satz
  const card = (kind, dur) => {
    const k = parts.length;
    g += `color=c=0x0b0b12:s=${W}x${H}:r=30:d=${dur},format=yuv420p[cb${k}];`;
    let last = `cb${k}`;
    const size = Math.round(Math.min(W, H) * (vertical ? 0.42 : 0.34));
    if (logo) {
      const idx = inputIndex();
      inputs.push('-loop', '1', '-framerate', '30', '-t', String(dur), '-i', logo);
      g += `[${idx}:v]format=rgba,scale=${size}:${size}:force_original_aspect_ratio=decrease,`
        + `zoompan=z='if(lt(on,8),0.6+on*0.06,1.08-min(0.08,(on-8)*0.01))':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${size}x${size}:fps=30,format=rgba,`
        + `fade=t=out:st=${(dur - 0.35).toFixed(2)}:d=0.35:alpha=1[lg${k}];[${last}][lg${k}]overlay=(W-w)/2:(H-h)/2-${Math.round(H * 0.08)}:shortest=1[cl${k}];`;
      last = `cl${k}`;
    }
    const name = esc(profile.name || '');
    const sub = esc(kind === 'intro' ? (p.tagline || '') : (p.outro || 'Jetzt abonnieren!'));
    const fs1 = Math.round(Math.min(W, H) * 0.09), fs2 = Math.round(Math.min(W, H) * 0.05);
    const y1 = Math.round(H / 2 + (logo ? size / 2 - H * 0.04 : -fs1));
    g += `[${last}]drawtext=fontfile=${ANTON}:text='${name}':fontsize=${fs1}:fontcolor=white:x=(w-text_w)/2:y=${y1}:alpha='min(1,t*3)'`
      + (sub ? `,drawtext=fontfile=${ANTON}:text='${sub.toUpperCase()}':fontsize=${fs2}:fontcolor=0xFFE14D:x=(w-text_w)/2:y=${y1 + Math.round(fs1 * 1.25)}:alpha='min(1,max(0,(t-0.3)*3))'` : '')
      + `,fade=t=in:d=0.2,fade=t=out:st=${(dur - 0.25).toFixed(2)}:d=0.25,setsar=1[cv${k}];`;
    g += `anullsrc=r=48000:cl=stereo,atrim=0:${dur}[ca${k}];`;
    parts.push([`cv${k}`, `ca${k}`, dur]);
  };
  let nextIdx = 0;
  const inputIndex = () => nextIdx++;
  // Momente zuerst als Eingaben 0 … n-1 (Indexe fest), Karten danach
  for (const s of p.segs) { inputs.push('-ss', s.a.toFixed(3), '-t', (s.b - s.a).toFixed(3), '-i', s.file); nextIdx++; }
  const hasAudio = new Map();
  for (const s of p.segs) if (!hasAudio.has(s.file)) hasAudio.set(s.file, (await signals.audioTracks(s.file)) > 0);
  const segParts = p.segs.map((s, i) => {
    g += frameFilter(s, i, W, H);
    const d = s.b - s.a;
    g += `[s${i}]fade=t=in:st=0:d=0.14:color=white,trim=duration=${d.toFixed(3)},format=yuv420p,setsar=1[mv${i}];`;
    if (!hasAudio.get(s.file)) { g += `anullsrc=r=48000:cl=stereo,atrim=0:${d.toFixed(3)}[ma${i}];`; return [`mv${i}`, `ma${i}`, d]; }
    g += `[${i}:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${d.toFixed(3)},afade=t=in:d=0.04,afade=t=out:st=${Math.max(0, d - 0.06).toFixed(3)}:d=0.06[ma${i}];`;
    return [`mv${i}`, `ma${i}`, d];
  });
  if (INTRO) card('intro', INTRO);
  const introParts = parts.splice(0);
  if (OUTRO) card('outro', OUTRO);
  const outroParts = parts.splice(0);
  const seq = [...introParts, ...segParts, ...outroParts];
  const total = seq.reduce((x, s) => x + s[2], 0);
  g += seq.map(([v, a]) => `[${v}][${a}]`).join('') + `concat=n=${seq.length}:v=1:a=1[catv][cata]`;
  // Texte + Untertitel (Hochformat) als ASS über die Momente
  let last = 'catv';
  const tmp = [];
  const offsets = []; { let off = INTRO; for (const s of p.segs) { offsets.push(off); off += s.b - s.a; } }
  const fsz = Math.round(Math.min(W, H) * 0.075);
  let ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\n`
    + 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
    + `Style: T,Anton,${fsz},&H004DE1FF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,1,0,1,${Math.round(fsz * 0.09)},${Math.round(fsz * 0.05)},8,60,60,${Math.round(H * (vertical ? 0.44 : 0.07))},1\n`
    + `Style: G,Anton,${Math.round(fsz * 0.45)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,1,0,1,${Math.round(fsz * 0.05)},0,1,40,40,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  let lines = 0;
  p.segs.forEach((s, i) => {
    const t0 = offsets[i], d = s.b - s.a;
    if (s.text) { ass += `Dialogue: 1,${assTime(t0 + 0.1)},${assTime(t0 + Math.min(d, 2.6))},T,,0,0,0,,{\\fscx60\\fscy60\\t(0,140,\\fscx108\\fscy108)\\t(140,240,\\fscx100\\fscy100)\\fad(0,150)}${assClean(s.text).toUpperCase()}\n`; lines++; }
    if (s.cand.topic && t.opts.labels !== false) { ass += `Dialogue: 0,${assTime(t0 + 0.2)},${assTime(t0 + Math.min(d, 2.2))},G,,0,0,0,,{\\fad(120,200)}${assClean(s.cand.topic).toUpperCase()}\n`; lines++; }
  });
  if (lines) {
    const f = path.join(TMP, `${t.id}-texte.ass`); fs.writeFileSync(f, ass); tmp.push(f);
    g += `;[${last}]ass=${f}:fontsdir=${FONTS}[tx]`; last = 'tx';
  }
  if (vertical && t.opts.captions !== false) {
    // Wort-Untertitel aus den Rohvideo-Transkripten auf die neue Zeitleiste legen
    const words = [];
    p.segs.forEach((s, i) => { for (const w of s.words || []) if (w.s >= s.a && w.e <= s.b) words.push({ s: offsets[i] + w.s - s.a, e: offsets[i] + w.e - s.a, t: w.t }); });
    if (words.length) {
      const f = path.join(TMP, `${t.id}-caps.ass`);
      fs.writeFileSync(f, buildAss(words.filter((w) => !/^(ä+h*m*|ö+h*m*|h+m+)$/i.test(w.t)), { color: db().cut?.captions?.color || '#FFE14D', posY: 0.72 })); tmp.push(f);
      g += `;[${last}]ass=${f}:fontsdir=${FONTS}[cp]`; last = 'cp';
    }
  }
  // Logo als Wasserzeichen während der Momente
  if (logo && t.opts.watermark !== false) {
    const idx = inputIndex();
    inputs.push('-loop', '1', '-framerate', '30', '-t', total.toFixed(2), '-i', logo);
    const ws = Math.round(Math.min(W, H) * 0.11);
    g += `;[${idx}:v]format=rgba,scale=${ws}:${ws}:force_original_aspect_ratio=decrease,colorchannelmixer=aa=0.8[wm];`
      + `[${last}][wm]overlay=${vertical ? 36 : W - ws - 36}:${vertical ? Math.round(H * 0.045) : 32}:enable='between(t,${INTRO.toFixed(2)},${(total - OUTRO).toFixed(2)})':shortest=1[wmk]`;
    last = 'wmk';
  }
  g += `;[${last}]fps=30,format=yuv420p[v]`;
  // Whoosh an jedem Schnitt, Musik mit Ducking
  let aMain = 'cata';
  const whoosh = await sfx.get('whoosh').catch(() => null);
  if (whoosh) {
    const idx = inputIndex();
    inputs.push('-i', whoosh);
    const cuts = offsets.slice(1);
    if (cuts.length) {
      g += `;[${idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.5,asplit=${cuts.length}` + cuts.map((_, k) => `[w${k}]`).join('');
      cuts.forEach((c, k) => { const ms = Math.max(0, Math.round((c - 0.15) * 1000)); g += `;[w${k}]adelay=${ms}|${ms}[wd${k}]`; });
      g += `;[${aMain}]` + cuts.map((_, k) => `[wd${k}]`).join('') + `amix=inputs=${cuts.length + 1}:duration=first:normalize=0[aw]`;
      aMain = 'aw';
    }
  }
  step('Musik wählen');
  let track = null;
  try { track = await music.trackFor({ profile, kind: 'trailer', seconds: total, idea: { mood: 'episch', music: 'energetic hype trailer music with big drops' } }); }
  catch (e) { t.warning = 'Musik: ' + e.message; }
  if (track) {
    const idx = inputIndex();
    inputs.push('-stream_loop', '-1', '-i', track.file);
    g += ';' + music.mixGraph({ hasVoice: true, idx, dur: total, voiceIn: aMain, track });
  } else g += `;[${aMain}]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`;
  const script = path.join(TMP, `${t.id}-trailer.filter`);
  fs.writeFileSync(script, g); tmp.push(script);
  const out = path.join(TMP, `${t.id}-trailer.mp4`);
  step('Schneiden', 0);
  const r = await gpu.encodeWithFallback((venc) => ffmpeg([...inputs, '-filter_complex_script', script, '-map', '[v]', '-map', '[aout]', ...venc,
    '-c:a', 'aac', '-b:a', '192k', '-t', total.toFixed(2), '-movflags', '+faststart', '-progress', 'pipe:1', '-y', out],
  (l) => { const m = /out_time_(?:ms|us)=(\d+)/.exec(l); if (m) step('Schneiden', Math.min(99, Number(m[1]) / 1e6 / total * 100)); }), { hq: true });
  for (const f of tmp) fs.rmSync(f, { force: true });
  if (r.code !== 0) { fs.rmSync(out, { force: true }); throw new Error('Schnitt: ' + lastError(r)); }
  return { out, total, track };
}

// ---------- Ablauf ----------
export function create(b) {
  const profile = profiles.get(b.profileId);
  if (!profile) throw new Error('Kanal wählen.');
  const opts = {
    profileId: profile.id,
    seconds: [30, 60, 90, 120, 180, 240, 300].includes(Number(b.seconds)) ? Number(b.seconds) : 180,
    format: b.format === '9:16' ? '9:16' : '16:9',
    days: [0, 7, 30, 90, 365].includes(Number(b.days)) ? Number(b.days) : 0,
    wish: String(b.wish || '').trim().slice(0, 400),
    intro: b.intro !== false, watermark: b.watermark !== false, labels: b.labels !== false, captions: b.captions !== false,
  };
  if (!candidates(profile.id, opts.days).length) throw new Error('Keine Shorts in diesem Zeitraum gefunden – erst Videos schneiden lassen (oder Zeitraum vergrößern).');
  const t = { id: 'tr' + crypto.randomBytes(5).toString('hex'), at: new Date().toISOString(), state: 'queued', step: '', progress: 0, opts, profileName: profile.name };
  store().push(t);
  if (store().length > 50) store().splice(0, store().length - 50);
  save();
  return t;
}

export async function runJob(id) {
  const t = store().find((x) => x.id === id);
  if (!t) return;
  const step = (s, p = 0) => { t.state = 'running'; t.step = s; t.progress = Math.round(p); save(); };
  fs.mkdirSync(TMP, { recursive: true });
  try {
    const profile = profiles.get(t.opts.profileId);
    if (!profile) throw new Error('Kanal gelöscht.');
    step('Momente sammeln');
    const cands = candidates(profile.id, t.opts.days);
    if (!cands.length) throw new Error('Keine Shorts gefunden.');
    step('KI stellt die Highlights zusammen');
    let p;
    if (ai.canAsk('trailer')) {
      try { p = await plan(t, cands, profile); } catch (e) { t.warning = 'KI: ' + e.message + ' – nach Punkten zusammengestellt.'; }
    }
    if (!p?.segs?.length) p = planSimple(t, cands);
    const { out, total, track } = await render(t, p, profile, step);
    const d = new Date();
    const name = lib.freeName('geschnitten', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${profile.name} – ${t.opts.format === '9:16' ? 'Highlight-Short' : 'Kanal-Trailer'}.mp4`);
    lib.moveFile(out, path.join(lib.dirOf('geschnitten'), name));
    const st = fs.statSync(path.join(lib.dirOf('geschnitten'), name));
    const nv = lib.newVideo('geschnitten', name);
    Object.assign(nv, { size: st.size, mtime: st.mtimeMs, channel: profile.id, channelFrom: 'trailer',
      title: p.title || `${profile.name} – Best of`, source: { kind: 'trailer', trailerId: t.id, parts: p.segs.map((s) => ({ id: s.cand.id, rawId: s.cand.rawId, a: s.a, b: s.b })) },
      note: `${t.opts.format === '9:16' ? 'Highlight-Short' : 'Kanal-Trailer'} aus ${p.segs.length} Momenten (${new Set(p.segs.map((s) => s.cand.id)).size} Videos), ${whisper.fmtTime(total)}.`
        + (p.tagline ? ` Intro: „${p.tagline}“.` : '') + (t.opts.wish ? ` Wunsch: ${t.opts.wish}.` : '') + music.noteOf(track),
      transcriptText: p.segs.map((s) => s.cand.title).join(' · ').slice(0, 2000),
      music: track ? { kind: track.kind, name: track.name, mood: track.mood || '' } : null });
    Object.assign(t, { state: 'done', step: '', progress: 100, doneAt: new Date().toISOString(), outId: nv.id, outFile: name, moments: p.segs.length, seconds: Math.round(total) });
    saveNow();
  } catch (e) {
    console.error('Trailer', e);
    Object.assign(t, { state: 'error', error: e.message, step: '' });
    saveNow();
    for (const f of fs.existsSync(TMP) ? fs.readdirSync(TMP) : []) if (f.startsWith(t.id + '-')) fs.rmSync(path.join(TMP, f), { force: true });
  }
}

export function init() {
  for (const t of store()) if (['queued', 'running'].includes(t.state)) Object.assign(t, { state: 'error', error: 'Durch Neustart unterbrochen – bitte neu starten.' });
}
// kurze Vorschau für den Dialog: wie viele Momente stehen zur Wahl?
export function preview(profileId, days) {
  const c = candidates(profileId, days);
  return { count: c.length, videos: new Set(c.map((x) => x.rawId || x.id)).size, top: c.slice(0, 5).map((x) => ({ title: x.title, viral: x.viral, views: x.views })),
    logo: fs.existsSync(logoPath(profileId)) ? (profiles.get(profileId)?.logo || { at: '' }) : null };
}
