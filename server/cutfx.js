// Schnitt-Feinheiten für Shorts: Hook am Anfang, Tempo (Pausen/Füllwörter raus), Zeitleiste für Untertitel.
// Ein Short ist eine Liste von Abschnitten der Quelle (Sekunden), die hintereinander abgespielt werden:
//   { a, b }            normaler Abschnitt
//   { a, b, hook }      Hook-Vorschau (Höhepunkt vorweg)
//   { a, b, rev }       „Zurückspulen“ (rückwärts, 3-fach schnell)
//   { ..., zoom }       leichter Punch-in (1.08–1.15) für schnelle Schnitte

// Tempo-Stufen: Mindestlänge einer Sprechpause, die raus darf; wie viel leiser als der Clip sie sein muss (dB);
// Füllwörter raus; Punch-in-Zoom bei jedem zweiten Schnitt.
export const TEMPO = {
  aus: null,
  ruhig: { gap: 1.0, quiet: 8, fillers: false, zoom: false },
  normal: { gap: 0.6, quiet: 6, fillers: true, zoom: false },
  schnell: { gap: 0.35, quiet: 4, fillers: true, zoom: true },
};
export const TEMPO_NAMES = { aus: 'aus (nichts herausschneiden)', ruhig: 'ruhig (nur lange Pausen)', normal: 'normal (Pausen + „ähm“)', schnell: 'schnell (Jump Cuts + Zooms)' };
export const HOOK_STYLES = { auto: 'Claude entscheidet', preview: 'Höhepunkt vorweg + Zurückspulen', cold: 'direkt mitten rein', off: 'aus' };

const FILLER = /^(ä+h*m*|äh+m*|ö+h*m*|e+h*m+|h+m+|m+h+m+)$/i;
const isFiller = (t) => FILLER.test(String(t).trim().replace(/[.,!?…]/g, ''));
const PAD = 0.12;            // so viel Luft bleibt vor/nach einem Wort
const MAX_REMOVE = 0.35;     // höchstens 35 % eines Clips herausschneiden

const median = (arr) => { if (!arr.length) return -70; const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// Lautheit in 0,1-s-Schritten zwischen a und b (fine[i] = Wert für Zehntelsekunde i)
function slice(fine, a, b) { return fine ? fine.slice(Math.max(0, Math.floor(a * 10)), Math.ceil(b * 10)) : []; }

// Welche Bereiche zwischen a und b dürfen raus? → behaltene Abschnitte [[a,b], …]
export function tempoKeep(words, fine, a, b, level) {
  const t = TEMPO[level];
  if (!t || !words?.length || !fine?.length) return [[a, b]];
  const ws = words.filter((w) => w.e > a && w.s < b).sort((x, y) => x.s - y.s);
  if (ws.length < 2) return [[a, b]];
  const base = median(slice(fine, a, b));
  // Momentan-Lautheit mittelt über 0,4 s und hinkt nach → Prüfung erst 0,4 s nach dem letzten Wort beginnen
  // Nachhall/Atmer am Rand sind erlaubt: mindestens 85 % der Pause müssen deutlich leiser sein als der Clip
  const quiet = (x, y) => {
    const s = slice(fine, Math.min(x + 0.4, (x + y) / 2), y);
    return s.length > 0 && s.filter((v) => v <= base - t.quiet).length >= s.length * 0.85;
  };
  const cut = [];
  // Leerlauf vor dem ersten Wort (nur wenn wirklich leise – sonst ist es vielleicht schon Action)
  if (ws[0].s - a > t.gap + PAD && quiet(a, ws[0].s - PAD)) cut.push([a, ws[0].s - PAD]);
  for (let i = 0; i < ws.length - 1; i++) {
    const x = ws[i].e + PAD, y = ws[i + 1].s - PAD;
    if (y - x >= t.gap && quiet(x, y)) cut.push([x, y]);
  }
  if (t.fillers) for (const w of ws) if (isFiller(w.t)) cut.push([w.s - 0.03, w.e + 0.03]);
  // zusammenführen, Mini-Schnitte weglassen, Obergrenze
  cut.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [x, y] of cut) {
    const cx = Math.max(a, x), cy = Math.min(b, y);
    if (cy - cx < 0.15) continue;
    const last = merged[merged.length - 1];
    if (last && cx <= last[1] + 0.05) last[1] = Math.max(last[1], cy); else merged.push([cx, cy]);
  }
  let removed = 0;
  const allowed = [];
  for (const r of merged.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))) {   // längste Pausen zuerst
    if (removed + (r[1] - r[0]) > (b - a) * MAX_REMOVE) continue;
    allowed.push(r); removed += r[1] - r[0];
  }
  allowed.sort((x, y) => x[0] - y[0]);
  const keep = [];
  let pos = a;
  for (const [x, y] of allowed) { if (x - pos >= 0.2) keep.push([pos, x]); pos = y; }
  if (b - pos >= 0.2) keep.push([pos, b]);
  return keep.length ? keep : [[a, b]];
}

// Hook prüfen und an den Clip anpassen → { mode, at, len, text } oder null
export function cleanHook(h, start, end, style = 'auto', pro = false) {
  if (!h || style === 'off') return null;
  let mode = style === 'auto' ? h.mode : style;
  if (pro && mode === 'preview') mode = 'cold';          // LinkedIn: ruhig, keine Effekte
  if (!['preview', 'cold'].includes(mode)) return h.text && !pro ? { mode: 'none', at: start, len: 0, text: String(h.text).slice(0, 60) } : null;
  const len = Math.max(1, Math.min(2.5, Number(h.len) || 1.5));
  let at = Number(h.at);
  if (!Number.isFinite(at)) return null;
  at = Math.max(start, Math.min(end - len, at));
  // Höhepunkt liegt schon am Anfang → keine Vorschau nötig
  if (mode === 'preview' && at - start < 3) mode = 'cold';
  // „direkt rein“ nur, wenn danach noch genug Clip bleibt (mind. 60 % bzw. 20 s) – sonst Höhepunkt als Vorschau
  if (mode === 'cold' && end - (at - 0.4) < Math.min(20, (end - start) * 0.6)) mode = pro ? 'none' : 'preview';
  if (mode === 'none') return h.text ? { mode: 'none', at: start, len: 0, text: String(h.text).slice(0, 60) } : null;
  if (mode === 'cold' && at - start < 0.6) return h.text ? { mode: 'none', at: start, len: 0, text: String(h.text).slice(0, 60) } : null;
  return { mode, at: Math.round(at * 10) / 10, len: Math.round(len * 10) / 10, text: String(h.text || '').slice(0, 60) };
}

// Abschnittsliste für einen Short
export function buildParts({ start, end, hook, words, fine, tempo = 'aus' }) {
  let from = start;
  const parts = [];
  if (hook?.mode === 'preview') {
    parts.push({ a: hook.at, b: hook.at + hook.len, hook: true, zoom: 1.12 });
    // Zurückspulen: die letzte Sekunde der Vorschau rückwärts, 3-fach schnell
    parts.push({ a: Math.max(hook.at, hook.at + hook.len - 1.2), b: hook.at + hook.len, rev: true });
  } else if (hook?.mode === 'cold') from = Math.max(start, hook.at - 0.4);
  const keep = tempoKeep(words, fine, from, end, tempo);
  const zoom = TEMPO[tempo]?.zoom;
  keep.forEach(([a, b], i) => parts.push({ a, b, ...(zoom && i % 2 === 1 ? { zoom: 1.08 } : {}) }));
  return parts;
}

export const partLen = (p) => (p.b - p.a) / (p.rev ? 3 : 1);
export const totalLen = (parts) => parts.reduce((s, p) => s + partLen(p), 0);

// Wörter auf die neue Zeitleiste legen (Vorschau-Teil bekommt seine Wörter, Zurückspulen keine)
export function mapWords(words, parts) {
  const out = [];
  let off = 0;
  for (const p of parts) {
    // Füllwörter („ähm“) nie als Untertitel zeigen
    if (!p.rev) for (const w of words || []) if (w.s >= p.a && w.e <= p.b && !isFiller(w.t)) out.push({ s: off + w.s - p.a, e: off + w.e - p.a, t: w.t });
    off += partLen(p);
  }
  return out;
}

// Wie lange der Hook-Text zu sehen ist
export function hookTextUntil(parts, hook) {
  if (!hook?.text) return 0;
  if (hook.mode === 'preview') return Math.min(3.5, partLen(parts[0]) + partLen(parts[1] || { a: 0, b: 0 }) + 0.6);
  return 2.2;
}

// ffmpeg-Filter: Abschnitte schneiden und zusammensetzen → [cv] (+ [ca]). base = Startzeit der Eingabe (-ss).
export function concatGraph(parts, { base, hasAudio, W0, H0 }) {
  let g = '';
  parts.forEach((p, i) => {
    const a = (p.a - base).toFixed(3), b = (p.b - base).toFixed(3);
    const z = p.zoom && W0 && H0 ? `,crop=trunc(iw/${p.zoom}/2)*2:trunc(ih/${p.zoom}/2)*2,scale=${W0}:${H0}` : '';
    const rev = p.rev ? ',reverse,setpts=PTS/3' : '';
    g += `[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS,fps=30${z}${rev},fps=30,setsar=1[v${i}];`;
    if (hasAudio) {
      const d = partLen(p).toFixed(3);
      const ar = p.rev ? ',areverse,atempo=2,atempo=1.5,volume=0.5' : '';
      g += `[0:a:0]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS${ar},aformat=sample_rates=48000:channel_layouts=stereo,`
        + `afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, d - 0.03).toFixed(3)}:d=0.03[a${i}];`;
    }
  });
  g += parts.map((_, i) => `[v${i}]` + (hasAudio ? `[a${i}]` : '')).join('') + `concat=n=${parts.length}:v=1:a=${hasAudio ? 1 : 0}[cv]` + (hasAudio ? '[ca]' : '');
  return g;
}

// kurze Beschreibung für die Notiz am Video
export function describe(hook, tempo, parts, start, end) {
  const bits = [];
  if (hook?.mode === 'preview') bits.push(`Hook: Höhepunkt (${String(hook.len).replace('.', ',')} s) vorweg + Zurückspulen`);
  else if (hook?.mode === 'cold') bits.push('Hook: steigt direkt mitten in der Action ein');
  if (hook?.text) bits.push(`Hook-Text „${hook.text}“`);
  const cuts = parts.filter((p) => !p.hook && !p.rev).length - 1;
  if (tempo && tempo !== 'aus' && cuts > 0) {
    const kept = parts.filter((p) => !p.hook && !p.rev).reduce((s, p) => s + p.b - p.a, 0);
    const from = hook?.mode === 'cold' ? Math.max(start, hook.at - 0.4) : start;
    bits.push(`Tempo ${tempo}: ${cuts} Schnitt${cuts === 1 ? '' : 'e'}, ${Math.max(0, end - from - kept).toFixed(1).replace('.', ',')} s Pausen raus`);
  }
  return bits.join(' · ');
}
