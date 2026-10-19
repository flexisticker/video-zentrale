// Signale für die Momentfindung („Was ist ein Highlight?“) – wie bei Opus Clip/StreamLadder mehr als nur Lautstärke:
//  - Stimme getrennt vom Spiel (OBS-Mehrspur: Spur 2 = Mikrofon), sonst Mischspur
//  - Tonfall je Satz: wie laut gegenüber deiner normalen Stimme, wie schnell, Ausrufe, Hype-/Rage-Wörter, Wiederholungen
//  - Geräusch-Marker aus der Spracherkennung ([Lachen], (schreit) …)
//  - Twitch: Chat-Ausschläge, Zuschauer-Clips, Stream-Marker (siehe twitch.js)
// Daraus eine Bewertung je Sekunde → Spitzen = Kandidaten für Claude (mit Begründung in Worten).
import { spawn } from 'node:child_process';
import { db } from './store.js';

// Anzahl Tonspuren einer Datei
export function audioTracks(file) {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(0));
    p.on('close', () => resolve(out.trim().split(/\s+/).filter(Boolean).length));
  });
}

// Welche Tonspur ist die Stimme? Einstellung cut.voiceTrack: 'auto' (Spur 2, wenn es mehrere gibt), 'off' oder Nummer 1–6.
export function voiceIndex(count) {
  const v = db().cut?.voiceTrack ?? 'auto';
  if (v === 'off' || count < 2) return null;
  if (v === 'auto') return 1;
  const n = Number(v) - 1;
  return Number.isInteger(n) && n >= 0 && n < count ? n : null;
}

const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : -70; };

// Stimme vorhanden? (nicht nur Stille/Rauschen auf der Spur)
export function voiceUsable(vals) {
  if (!vals?.length) return false;
  const active = vals.filter((x) => x > -50).length;
  return active >= Math.max(5, vals.length * 0.03);
}

const HYPE = /\b(alter|digga|diggah|junge|boah|krass|omg|oh mein gott|wtf|scheiße|scheisse|fuck|verdammt|gg|let'?s go|lets go|komm schon|nein nein|ernsthaft|hilfe|was zum|wie bitte|niemals|unglaublich|hä+|ey+|aaa+h*|waa+s|neee+in|ja+ ja+|geil|brutal|insane|clutch|tot|gestorben)\b/i;

// Tonfall je Satz → { loud (dB über deiner Sprech-Mitte), rate (Wörter/s im Verhältnis zur Mitte), tags[], score }
// fine = Lautheit je 0,1 s (Stimme, sonst Mischung); events = Geräusch-Marker aus Whisper
export function prosody(sents, words, fine, events = []) {
  if (!sents?.length) return [];
  const peakOf = (s, e) => { let m = -70; for (let i = Math.floor(s * 10); i <= Math.ceil(e * 10); i++) if (fine?.[i] > m) m = fine[i]; return m; };
  const rates = [], peaks = [];
  const rows = sents.map((x) => {
    const ws = (words || []).filter((w) => w.s >= x.s - 0.01 && w.e <= x.e + 0.01);
    const dur = Math.max(0.3, x.e - x.s);
    const rate = ws.length / dur;
    const peak = fine ? peakOf(x.s, x.e + 0.3) : -70;
    if (ws.length >= 3) rates.push(rate);
    if (peak > -60) peaks.push(peak);
    return { x, ws, rate, peak };
  });
  const mRate = median(rates) || 2.5, mPeak = median(peaks);
  return rows.map(({ x, ws, rate, peak }) => {
    const tags = [];
    let score = 0;
    const loud = fine && peak > -60 ? Math.round(peak - mPeak) : 0;
    if (loud >= 6) { tags.push(`laut +${loud} dB`); score += Math.min(3, (loud - 3) / 3); }
    const r = rate / mRate;
    if (ws.length >= 4 && r >= 1.35) { tags.push('schnell'); score += 0.6; }
    if (/!|\?!/.test(x.t)) { tags.push('Ausruf'); score += 0.5; }
    const hype = HYPE.exec(x.t);
    if (hype) { tags.push(`„${hype[0].toLowerCase()}“`); score += 0.8; }
    const low = ws.map((w) => w.t.toLowerCase().replace(/[^\p{L}]/gu, '')).filter(Boolean);
    if (low.some((w, i) => i >= 2 && w.length > 1 && w === low[i - 1] && w === low[i - 2])) { tags.push('Wiederholung'); score += 0.5; }
    const ev = events.filter((e) => e.s < x.e + 1.5 && e.e > x.s - 0.5);
    for (const k of [...new Set(ev.map((e) => e.kind))]) {
      const name = { laugh: 'LACHEN', shout: 'SCHREIT', cheer: 'JUBEL', bang: 'KNALL' }[k];
      if (name) { tags.push(name); score += k === 'laugh' ? 2 : 1.5; }
    }
    return { id: x.id, loud, rate: Math.round(r * 100) / 100, tags, score: Math.round(score * 10) / 10 };
  });
}

// Satzliste mit Tonfall-Markern versehen (bounds.sentenceLines zeigt x.tag in Klammern)
export function annotate(sents, pros) {
  const m = new Map(pros.map((p) => [p.id, p]));
  return sents.map((x) => { const p = m.get(x.id); return p?.tags.length ? { ...x, tag: p.tags.join(', ') } : x; });
}

// Bewertung je Sekunde aus allen Signalen. extra = [{ t, w, label }] (Twitch: Chat, Clips, Marker …)
export function timeline({ duration, loud, voice, scenes = [], events = [], sents = [], pros = [], cut = [], extra = [] }) {
  const n = Math.max(1, Math.ceil(duration || loud?.length || 0));
  const z = (arr) => {
    if (!arr?.length) return null;
    const s = [...arr].filter((x) => x > -69).sort((a, b) => a - b);
    if (!s.length) return null;
    const med = s[Math.floor(s.length / 2)], hi = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
    const spread = Math.max(3, hi - med);
    return arr.map((v) => Math.max(-1, Math.min(2, (v - med) / spread)));
  };
  const zl = z(loud) || [], zv = voice ? z(voice) : null;
  const score = new Array(n).fill(0);
  const why = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) score[i] = (zl[i] ?? -1) * (zv ? 0.6 : 1) + (zv ? (zv[i] ?? -1) * 0.9 : 0);
  for (const t of scenes) { const i = Math.floor(t); if (i < n) score[i] += 0.5; }
  const add = (t, w, label, spread = 2) => {
    for (let i = Math.max(0, Math.floor(t) - spread); i <= Math.min(n - 1, Math.floor(t) + spread); i++) score[i] += w * (1 - Math.abs(i - t) / (spread + 1));
    const i = Math.min(n - 1, Math.max(0, Math.floor(t)));
    if (label && !why[i].includes(label)) why[i].push(label);
  };
  for (const e of events) if (['laugh', 'shout', 'cheer', 'bang'].includes(e.kind)) add(e.s, e.kind === 'laugh' ? 2 : 1.5, { laugh: 'Lachen', shout: 'Schrei', cheer: 'Jubel', bang: 'Knall' }[e.kind]);
  const sm = new Map(sents.map((x) => [x.id, x]));
  for (const p of pros) { const x = sm.get(p.id); if (x && p.score >= 1) add((x.s + x.e) / 2, Math.min(2.5, p.score * 0.7), p.tags.slice(0, 2).join(', '), Math.ceil((x.e - x.s) / 2)); }
  for (const x of extra) add(x.t, x.w, x.label, x.spread ?? 3);
  for (const [a, b] of cut) for (let i = Math.floor(a); i < Math.min(b, n); i++) score[i] = -3;
  return { score, why };
}

// Spitzen → Kandidaten-Fenster (Kontext vor dem Moment länger als danach: Vorgeschichte, dann Reaktion).
// forced = Zeitpunkte, die sicher dabei sein sollen (Zuschauer-Clips, Marker, Claude-Späher).
// min = so viele Kandidaten mindestens (auch schwache), darüber nur echte Ausschläge
export function peaks({ score, why }, { duration, max = 24, min = 6, before = 22, after = 14, gap = 18, forced = [] } = {}) {
  const n = score.length;
  if (duration < before + after + 5) return duration >= 10 ? [{ start: 0, end: duration, at: duration / 2, score: 0, why: [] }] : [];
  // glätten (5 s), damit einzelne Ausreißer nicht gewinnen
  const sm = score.map((_, i) => { let s = 0, c = 0; for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < n) { s += score[j]; c++; } return s / c; });
  const order = sm.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const picked = [];
  const take = (t, label, sc, range = null) => {
    const near = picked.find((p) => Math.abs(p.at - t) < gap);
    if (near) { if (label && !near.why.includes(label)) near.why.unshift(label); return false; }   // Begründung nicht verlieren
    // vorgegebener Bereich (Claude-Späher: ganze Geschichte) mit etwas Luft, sonst Fenster um den Moment
    const start = Math.max(0, Math.round(range ? Math.min(range.start - 8, t - before / 2) : t - before));
    const end = Math.min(duration, Math.round(range ? Math.max(range.end + 8, t + after / 2) : t + after));
    const reasons = [];
    for (let i = Math.max(0, start); i < Math.min(n, end); i++) for (const w of why[i]) if (!reasons.includes(w)) reasons.push(w);
    if (label && !reasons.includes(label)) reasons.unshift(label);
    picked.push({ start, end, at: Math.round(t), score: Math.round(sc * 10) / 10, why: reasons.slice(0, 6) });
    return true;
  };
  for (const f of forced) if (picked.length < max) take(f.t, f.label, sm[Math.min(n - 1, Math.floor(f.t))] ?? 0, Number.isFinite(f.start) && Number.isFinite(f.end) ? f : null);
  for (const [v, i] of order) {
    if (picked.length >= max || v < -0.5 || (v < 0.15 && picked.length >= min)) break;
    take(i + 0.5, '', v);
  }
  return picked.sort((a, b) => a.start - b.start);
}
