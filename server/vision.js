// Was Claude vom Bild sieht: Kontaktbögen (Raster aus 9 Bildern mit Sekunde) statt einzelner Standbilder,
// und die Facecam-Box aus Claudes Schätzung an den echten Rahmen der Facecam anlegen (Kanten im Mittelbild).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FONT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts', 'Lato-Bold.ttf');

function run(args, { raw = false, timeout = 180_000 } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    const p = spawn('nice', ['-n', '15', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { stdio: ['ignore', raw ? 'pipe' : 'ignore', 'ignore'] });
    if (raw) p.stdout.on('data', (d) => chunks.push(d));
    const t = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.on('error', () => { clearTimeout(t); resolve(null); });
    p.on('close', (c) => { clearTimeout(t); resolve(c === 0 ? (raw ? Buffer.concat(chunks) : true) : null); });
  });
}

// Kontaktbogen: n×m Bilder gleichmäßig zwischen start und end, Sekunde (ab Videoanfang) oben links eingeblendet.
// Querformat-Kacheln 384 px breit (3×3 → 1152 × 648 ≈ 1.000 Token), Hochformat 216 px.
export async function contactSheet(file, start, end, out, { cols = 3, rows = 3, vertical = false, tile = 0 } = {}) {
  const n = cols * rows;
  const span = Math.max(1, end - start);
  const w = tile || (vertical ? 216 : 384);
  const scale = vertical ? `scale=${w}:-2` : `scale=${w}:-2`;
  const font = FONT.replace(/\\/g, '/').replace(/:/g, '\\:');
  // Beschriftung vor dem Ausdünnen (fps), sonst stimmt die Sekunde nicht genau
  const vf = `${scale},drawtext=fontfile=${font}:text='%{eif\\:t+${start.toFixed(2)}\\:d} s':x=6:y=6:fontsize=${Math.round(w / 14)}:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4,fps=${(n / span).toFixed(5)}:round=down,tile=${cols}x${rows}:padding=4:color=black`;
  const ok = await run(['-y', '-ss', Math.max(0, start).toFixed(2), '-t', span.toFixed(2), '-i', file, '-an', '-vf', vf, '-frames:v', '1', '-q:v', '4', out]);
  return ok && fs.existsSync(out) ? out : null;
}

export const asImage = (file) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(file).toString('base64') } });

// ---------- Facecam-Rahmen verfeinern ----------
// Mittelbild über ~16 Bilder (Graustufen, 480 px breit): Ränder einer eingeblendeten Facecam stehen still und bleiben
// scharf, das bewegte Spiel verschwimmt. Je Kante wird im Umkreis von Claudes Schätzung die stärkste gerade Kante gesucht.
// radius = Suchbereich je Kante (Anteil der Boxgröße); inner = Bereich, der sicher drin liegen muss (z. B. das Gesicht)
export async function refineBox(file, start, end, box, { width = 480, srcW, srcH, radius = 0.2, inner = null } = {}) {
  if (!box || !srcW || !srcH) return box;
  const W = width, H = Math.round(width * srcH / srcW / 2) * 2;
  const n = 16, span = Math.max(2, end - start);
  const buf = await run(['-ss', Math.max(0, start).toFixed(2), '-t', span.toFixed(2), '-i', file, '-an',
    '-vf', `fps=${(n / span).toFixed(4)},scale=${W}:${H},format=gray`, '-frames:v', String(n), '-f', 'rawvideo', '-'], { raw: true, timeout: 120_000 });
  if (!buf || buf.length < W * H * 3) return box;
  const frames = Math.floor(buf.length / (W * H));
  const mean = new Float32Array(W * H);
  for (let f = 0; f < frames; f++) for (let i = 0; i < W * H; i++) mean[i] += buf[f * W * H + i];
  for (let i = 0; i < W * H; i++) mean[i] /= frames;
  const at = (x, y) => mean[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  // Kantenstärke einer senkrechten Linie bei x (zwischen y0 und y1) bzw. waagerechten bei y
  const vEdge = (x, y0, y1) => { let s = 0; for (let y = y0; y <= y1; y++) s += Math.abs(at(x + 1, y) - at(x - 1, y)); return s / Math.max(1, y1 - y0 + 1); };
  const hEdge = (y, x0, x1) => { let s = 0; for (let x = x0; x <= x1; x++) s += Math.abs(at(x, y + 1) - at(x, y - 1)); return s / Math.max(1, x1 - x0 + 1); };
  const px = { x: box.x * W, y: box.y * H, w: box.w * W, h: box.h * H };
  const search = (center, lo, hi, fn, size, min = -Infinity, max = Infinity) => {
    const r = Math.round(Math.max(8, size * radius));
    let best = null, bestV = 0; const vals = [];
    for (let p = Math.round(Math.max(min, center - r)); p <= Math.round(Math.min(max, center + r)); p++) {
      if (p < 1 || p > (fn === vEdge ? W - 2 : H - 2)) continue;
      const v = fn(p, Math.round(lo), Math.round(hi)); vals.push(v);
      if (v > bestV) { bestV = v; best = p; }
    }
    const med = vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)] || 0;
    return best != null && bestV > 12 && bestV > med * 2.2 ? best : null;   // nur eindeutige Kanten
  };
  const y0 = px.y + px.h * 0.15, y1 = px.y + px.h * 0.85, x0 = px.x + px.w * 0.15, x1 = px.x + px.w * 0.85;
  const ib = inner ? { x0: inner.x * W - 3, x1: (inner.x + inner.w) * W + 3, y0: inner.y * H - 3, y1: (inner.y + inner.h) * H + 3 } : null;
  const left = px.x > 3 ? search(px.x, y0, y1, vEdge, px.w, -Infinity, ib ? ib.x0 : Infinity) : null;
  const right = px.x + px.w < W - 3 ? search(px.x + px.w, y0, y1, vEdge, px.w, ib ? ib.x1 : -Infinity) : null;
  const top = px.y > 3 ? search(px.y, x0, x1, hEdge, px.h, -Infinity, ib ? ib.y0 : Infinity) : null;
  const bottom = px.y + px.h < H - 3 ? search(px.y + px.h, x0, x1, hEdge, px.h, ib ? ib.y1 : -Infinity) : null;
  const L = left ?? px.x, R = right ?? px.x + px.w, T = top ?? px.y, B = bottom ?? px.y + px.h;
  if (R - L < W * 0.05 || B - T < H * 0.05) return box;
  const found = [left, right, top, bottom].filter((x) => x != null).length;
  return { x: L / W, y: T / H, w: (R - L) / W, h: (B - T) / H, refined: found };
}
