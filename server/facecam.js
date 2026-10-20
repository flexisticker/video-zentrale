// Facecam automatisch finden: Gesichter aus der PC-Analyse (alle 2 s, analyse.js) → wo sitzt die Facecam in diesem Clip?
//  - Gesichter werden nach Lage gruppiert; die häufigste Lage ist die Facecam des Clips
//  - Sitzt Claudes Schätzung nicht um das Gesicht, wird der Rahmen aus dem Gesicht abgeleitet und an die echten Kanten gelegt
//  - Wechselt die Facecam im Clip die Position (zweite Gruppe, zeitlich danach), gibt es cam2 + switchAt (Quellzeit)
//  - Von Hand korrigierte Ausschnitte (Szenen je Kanal) haben Vorrang, wenn sie zur gefundenen Lage passen
import * as analyse from './analyse.js';
import * as vision from './vision.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const inside = (p, b, pad = 0) => p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
export function iou(a, b) {
  if (!a || !b) return 0;
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return i / (a.w * a.h + b.w * b.h - i || 1);
}
const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// Gesichter im Bereich [a, b] (Quellzeit) – null, wenn die PC-Analyse keine Gesichtssuche gemacht hat
export function facesIn(raw, a, b) {
  const r = analyse.load(raw);
  if (!r?.facesChecked) return null;
  return (r.faces || []).filter((f) => f.t >= a - 1 && f.t <= b + 1 && f.s >= 0.6 && f.w > 0.012 && f.h > 0.02);
}
export function videoFaces(raw) {
  const r = analyse.load(raw);
  return r?.facesChecked ? (r.faces || []).filter((f) => f.s >= 0.6) : null;
}

// Gesichter nach Lage gruppieren (gleiche Facecam = Mitte nah beieinander, ähnliche Größe)
export function clusters(faces) {
  const out = [];
  for (const f of [...faces].sort((a, b) => a.t - b.t)) {
    const c = center(f);
    const g = out.find((k) => Math.abs(k.cx - c.x) < 0.07 && Math.abs(k.cy - c.y) < 0.09 && f.w / k.w < 1.7 && k.w / f.w < 1.7);
    if (g) { g.list.push(f); g.cx = (g.cx * (g.list.length - 1) + c.x) / g.list.length; g.cy = (g.cy * (g.list.length - 1) + c.y) / g.list.length; }
    else out.push({ cx: c.x, cy: c.y, w: f.w, list: [f] });
  }
  return out.map((g) => {
    const box = { x: median(g.list.map((f) => f.x)), y: median(g.list.map((f) => f.y)), w: median(g.list.map((f) => f.w)), h: median(g.list.map((f) => f.h)) };
    const ts = g.list.map((f) => f.t);
    return { n: g.list.length, box, tmin: Math.min(...ts), tmax: Math.max(...ts), times: ts };
  }).sort((a, b) => b.n - a.n);
}

// Erste Schätzung des Facecam-Rahmens aus dem Gesicht (typische Facecam: Gesicht mittig, etwas oberhalb der Mitte)
export function seedFromFace(face) {
  const w = clamp(face.w * 3, 0.08, 0.6), h = clamp(face.h * 2.6, 0.12, 0.8);
  const c = center(face);
  return { x: clamp(c.x - w / 2, 0, 1 - w), y: clamp(c.y - h * 0.45, 0, 1 - h), w, h };
}

// Gemerkte Szene (von Hand korrigiert) passend zur Lage? → genau diese nehmen
export function snapScene(cam, scenes, face = null) {
  if (!cam || !scenes?.length) return null;
  let best = null, bv = 0.35;
  for (const s of scenes) {
    const v = iou(cam, s);
    const fits = face ? inside(center(face), s) : true;
    if (fits && v > bv) { bv = v; best = s; }
  }
  return best ? { x: best.x, y: best.y, w: best.w, h: best.h } : null;
}

async function frameFor(file, a, b, seed, face, src) {
  try {
    const r = await vision.refineBox(file, a, b, seed, { srcW: src.w, srcH: src.h, radius: 0.6, inner: face });
    // Gesicht muss im Ergebnis liegen, sonst lieber die Schätzung
    return r && inside(center(face), r) ? { x: r.x, y: r.y, w: r.w, h: r.h } : seed;
  } catch { return seed; }
}

// L = Bildaufbau (layout.normalize). → angepasster Bildaufbau + Notiz (wie gefunden)
export async function resolve(raw, file, start, end, L, { scenes = [] } = {}) {
  const faces = facesIn(raw, start, end);
  const src = { w: raw.width, h: raw.height };
  if (!faces || !src.w || src.h > src.w) {
    const sn = L.cam && snapScene(L.cam, scenes);
    return sn ? { L: { ...L, cam: sn }, how: 'gemerkter Ausschnitt' } : { L, how: '' };
  }
  const cl = clusters(faces);
  if (!cl.length) {
    // kein Gesicht im Clip: Liegt Claudes Facecam dort, wo sonst im Video Gesichter sind, bleibt sie (kurz weggeschaut);
    // sonst gibt es hier keine Facecam → ganzes Bild statt eines falschen Ausschnitts
    if (L.mode === 'cam' && L.cam) {
      const all = videoFaces(raw) || [];
      const known = all.some((f) => inside(center(f), L.cam, 0.02));
      if (!known) return { L: { ...L, mode: 'blur', cam: null }, how: 'kein Gesicht gefunden → ganzes Bild' };
    }
    return { L, how: '' };
  }
  const main = cl[0];
  // Großes Gesicht = ganze Szene ist Kamerabild (kein eingeblendetes Facecam-Fenster) → Ausschnitt auf das Gesicht
  if (main.box.w > 0.22) return { L: { mode: 'crop', cam: null, focus: center(main.box).x }, how: 'Kamerabild – Ausschnitt aufs Gesicht' };
  const camFor = async (g, a, b) => {
    const sc = snapScene(seedFromFace(g.box), scenes, g.box);
    if (sc) return { cam: sc, how: 'gemerkter Ausschnitt' };
    if (L.cam && inside(center(g.box), L.cam) && L.cam.w < g.box.w * 8) return { cam: L.cam, how: 'Gesicht bestätigt' };
    return { cam: await frameFor(file, a, b, seedFromFace(g.box), g.box, src), how: 'aus dem Gesicht abgeleitet' };
  };
  // Positionswechsel: zweite Lage mit genug Bildern, zeitlich klar getrennt
  const second = cl.find((g, i) => i > 0 && g.n >= Math.max(2, main.n * 0.3) && (g.tmin > main.tmax - 1 || g.tmax < main.tmin + 1));
  if (second) {
    const [first, later] = second.tmin > main.tmax - 1 ? [main, second] : [second, main];
    // Gesichter liegen alle 2 s vor → Wechsel zwischen letzter alter und erster neuer Sichtung
    const switchAt = Math.max(start + 0.5, Math.min(end - 0.5, (first.tmax + later.tmin) / 2));
    const A = await camFor(first, start, switchAt), B = await camFor(later, switchAt, end);
    return { L: { ...L, mode: 'cam', cam: A.cam, cam2: B.cam, switchAt }, how: `Facecam wechselt bei ${Math.round(switchAt - start)} s die Position (${A.how})` };
  }
  const A = await camFor(main, start, end);
  return { L: { ...L, mode: L.mode === 'blur' ? 'blur' : 'cam', cam: A.cam }, how: A.how };
}
