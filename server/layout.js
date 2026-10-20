// Bildaufbau für Shorts (9:16) aus Querformat – wie StreamLadder:
//   cam   = Facecam oben, Spiel darunter (Ausschnitt um die Action)
//   crop  = 9:16-Ausschnitt um die Action (focus = waagerechte Mitte 0–1)
//   blur  = ganzes Bild in der Mitte, unscharfer Hintergrund (Übersicht, Text, Karten, 3D-Drucker)
// Reaktionen (fx „cam“): Facecam für ~1,6 s groß (quadratisch oben), danach zurück.
// Alle Maße werden hier in Pixeln ausgerechnet – ffmpeg bekommt feste Zahlen.

const even = (x) => Math.max(2, Math.round(x / 2) * 2);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const SC = 'flags=lanczos';

export const MODES = ['cam', 'crop', 'blur'];

// Claudes Angaben (Prozent) bzw. Einstellung → { mode, cam: {x,y,w,h} (0–1) | null, focus }
export function normalize(l, fallbackCam = null) {
  const pct = (x) => clamp(Number(x) / 100, 0, 1);
  let cam = null;
  if (l && Number(l.camW) > 3 && Number(l.camH) > 3) {
    const x = pct(l.camX), y = pct(l.camY), w = pct(l.camW), h = pct(l.camH);
    if (x + w <= 1.02 && y + h <= 1.02) cam = { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
  }
  if (!cam && fallbackCam) cam = fallbackCam;
  let mode = MODES.includes(l?.mode) ? l.mode : cam ? 'cam' : 'crop';
  if (mode === 'cam' && !cam) mode = 'crop';
  const focus = Number.isFinite(Number(l?.focus)) ? pct(l.focus) : 0.5;
  return { mode, cam, focus };
}

// Ausschnitt mit Seitenverhältnis ar (Breite/Höhe) so groß wie möglich, waagerecht um fx (0–1) – innerhalb der Quelle
function cropBox(srcW, srcH, ar, fx = 0.5, region = null) {
  const R = region || { x: 0, y: 0, w: srcW, h: srcH };
  let w = R.h * ar, h = R.h;
  if (w > R.w) { w = R.w; h = R.w / ar; }
  w = even(w); h = even(h);
  const x = even(clamp(R.x + fx * R.w - w / 2, R.x, R.x + R.w - w));
  const y = even(clamp(R.y + (R.h - h) / 2, R.y, R.y + R.h - h));
  return `crop=${w}:${h}:${x}:${y}`;
}

// Facecam-Ausschnitt mit Seitenverhältnis ar (Mitte der Facecam bleibt Mitte)
function camBox(srcW, srcH, cam, ar) {
  const cx = (cam.x + cam.w / 2) * srcW, cy = (cam.y + cam.h / 2) * srcH;
  let w = cam.w * srcW, h = cam.h * srcH;
  if (w / h > ar) w = h * ar; else h = w / ar;
  w = even(w); h = even(h);
  return `crop=${w}:${h}:${even(clamp(cx - w / 2, 0, srcW - w))}:${even(clamp(cy - h / 2, 0, srcH - h))}`;
}

// → { graph, seam (Pixel: Unterkante Facecam, 0 ohne), mode }
// reactions: [{ t, dur }] Zeiten im fertigen Short
export function graph(input, output, { srcW, srcH, layout, reactions = [], W = 1080, H = 1920 }) {
  const L = layout || { mode: 'crop', focus: 0.5 };
  if (!srcW || !srcH) return { graph: `[${input}]crop=trunc(ih*9/16/2)*2:ih,scale=${W}:${H}:${SC},setsar=1[${output}]`, seam: 0, mode: 'crop' };
  const reacts = L.cam ? reactions.filter((r) => Number.isFinite(r.t)) : [];
  const parts = [];
  let main = '', seam = 0;
  const gameAr = (h) => W / h;
  if (L.mode === 'cam' && L.cam) {
    // Facecam oben im eigenen Seitenverhältnis (zwischen 16:9 und 4:3 → 608–810 px hoch), Spiel darunter
    const camAr = clamp((L.cam.w * srcW) / (L.cam.h * srcH), 4 / 3, 16 / 9);
    const th = even(W / camAr);
    seam = th;
    const bh = H - th;
    main = `[m0]split[ma][mb];[ma]${camBox(srcW, srcH, L.cam, W / th)},scale=${W}:${th}:${SC}[top];`
      + `[mb]${cropBox(srcW, srcH, gameAr(bh), L.focus)},scale=${W}:${bh}:${SC}[bot];[top][bot]vstack,setsar=1`;
  } else if (L.mode === 'blur') {
    main = `[m0]split[ma][mb];[ma]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=22:2,eq=brightness=-0.07:saturation=1.1[bg];`
      + `[mb]scale=${W}:-2:${SC}[fg];[bg][fg]overlay=0:(H-h)/2,setsar=1`;
  } else {
    main = `[m0]${cropBox(srcW, srcH, W / H, L.focus)},scale=${W}:${H}:${SC},setsar=1`;
  }
  if (!reacts.length) return { graph: `[${input}]null[m0];${main}[${output}]`, seam, mode: L.mode };
  // Reaktion groß: quadratische Facecam oben (1080 × 1080), Spiel darunter, für die Dauer der Reaktion drübergelegt
  const sq = W, rest = H - sq;
  const big = `[r0]split[ra][rb];[ra]${camBox(srcW, srcH, L.cam, 1)},scale=${sq}:${sq}:${SC},unsharp=5:5:0.6[rt];`
    + `[rb]${cropBox(srcW, srcH, W / rest, L.focus)},scale=${W}:${rest}:${SC}[rbt];[rt][rbt]vstack,setsar=1[big]`;
  const en = reacts.map((r) => `between(t,${r.t.toFixed(2)},${(r.t + (r.dur || 1.6)).toFixed(2)})`).join('+');
  parts.push(`[${input}]split[m0][r0]`, main + '[norm]', big, `[norm][big]overlay=0:0:enable='${en}'[${output}]`);
  return { graph: parts.join(';'), seam, mode: L.mode };
}

// Bildaufbau zu einer gespiegelten Quelle: Facecam und Fokus wandern auf die andere Seite
export function mirrorLayout(L) {
  if (!L) return L;
  return { ...L, cam: L.cam ? { ...L.cam, x: clamp(1 - L.cam.x - L.cam.w, 0, 1) } : L.cam, focus: Number.isFinite(L.focus) ? 1 - L.focus : L.focus };
}

export function describe(L, reactions = 0) {
  const m = { cam: 'Facecam oben + Spiel', crop: 'Ausschnitt um die Action', blur: 'ganzes Bild + Blur-Hintergrund' }[L?.mode] || '';
  return m ? `Bild: ${m}${reactions ? `, ${reactions}× Reaktion groß` : ''}` : '';
}
