// Saubere Schnittgrenzen: nie mitten im Satz oder Wort schneiden.
// Grundlage sind die Wort-Zeitmarken von Whisper (wie bei Opus Clip & Co.): Claude wählt ganze Sätze,
// danach rastet jeder Start/Ende hier auf Satzgrenze + Sprechpause ein (Sicherheitsnetz, falls Claude daneben liegt).
// Ohne Sprache: Bildwechsel oder leiseste Stelle in der Nähe statt mitten in einen Knall.

const PAD_IN = 0.25;    // Luft vor dem ersten Wort
const PAD_OUT = 0.45;   // Luft nach dem letzten Wort (Ausklingen, Lachen)
const STRETCH = 6;      // so weit darf das Ende verlängert werden, um einen Satz fertig zu machen
const OVER_MAX = 5;     // so weit darf ein Clip die Maximallänge überziehen, um einen Satz fertig zu machen

// Sätze mit fortlaufender Nummer (1 …) – für Claude und fürs Einrasten
export const numbered = (segs) => (segs || []).map((x, i) => ({ ...x, id: i + 1 }));

// Für Claude: „S12 [312.4–315.8] Text“ im Bereich from–to
export function sentenceLines(sents, from = 0, to = Infinity, maxChars = 9000) {
  const lines = [];
  let n = 0;
  for (const x of sents) {
    if (x.e <= from || x.s >= to) continue;
    const l = `S${x.id} [${x.s.toFixed(1)}–${x.e.toFixed(1)}] ${x.t}`;
    n += l.length + 1;
    if (n > maxChars) { lines.push('[… gekürzt]'); break; }
    lines.push(l);
  }
  return lines.join('\n');
}

// Satznummern (von/bis) → Zeiten; ungültig → null
export function fromSentences(sents, a, b) {
  const i = Number(a), j = Number(b);
  if (!sents?.length || !Number.isInteger(i) || !Number.isInteger(j) || i < 1 || j < i || j > sents.length) return null;
  return { start: sents[i - 1].s, end: sents[j - 1].e };
}

const wordAt = (words, t) => (words || []).find((w) => w.s < t && w.e > t);
const sentAt = (sents, t) => sents.find((x) => x.s <= t && x.e >= t);

// leiseste Zehntelsekunde in [a, b] (fine = Lautheit je 0,1 s, „momentary“ hinkt ~0,3 s nach)
function quietest(fine, a, b) {
  if (!fine?.length || b <= a) return null;
  let best = null, bestVal = Infinity;
  for (let t = a; t <= b + 1e-6; t += 0.1) {
    const v = fine[Math.round((t + 0.3) * 10)];
    if (v === undefined) continue;
    if (v < bestVal - 0.5) { bestVal = v; best = t; }
  }
  return best;
}
const nearScene = (scenes, t, r) => (scenes || []).filter((x) => Math.abs(x - t) <= r).sort((x, y) => Math.abs(x - t) - Math.abs(y - t))[0];

// Ende hinter einem Satz: Luft lassen, aber vor dem nächsten Wort bleiben; möglichst in der leisesten Stelle
function outPoint(e, words, fine, dur) {
  const next = (words || []).find((w) => w.s >= e - 0.01);
  const limit = Math.min(dur, next ? Math.max(e + 0.05, next.s - 0.08) : e + 1.2);
  const q = quietest(fine, e + 0.15, Math.min(limit, e + 0.9));
  return Math.min(limit, q != null ? Math.max(q, e + 0.2) : e + PAD_OUT);
}
// Start vor einem Satz: Luft lassen, aber nach dem vorigen Wort
function inPoint(s, words) {
  const prev = [...(words || [])].reverse().find((w) => w.e <= s + 0.01);
  return Math.max(0, prev ? Math.min(s - 0.03, Math.max(prev.e + 0.06, s - PAD_IN)) : s - PAD_IN);
}

// Start/Ende einrasten. opts: sents (numbered), words, fine, scenes, dur, minLen, maxLen
export function snapRange(start, end, { sents = [], words = [], fine = null, scenes = [], dur = Infinity, minLen = 0, maxLen = Infinity } = {}) {
  const notes = [];
  let a = start, b = end;
  const speech = sents.length > 0;

  // ---- Start ----
  const sa = speech ? sentAt(sents, a + 0.05) : null;
  if (sa && sa.s < a - 0.05) {
    // mitten im Satz → an den Satzanfang (davor), wenn das nicht zu weit ist, sonst an den nächsten Satz
    const next = sents.find((x) => x.s >= a);
    if (a - sa.s <= 5 || !next) { a = sa.s; notes.push('Start auf Satzanfang'); } else { a = next.s; notes.push('Start auf nächsten Satz'); }
  } else if (speech) {
    // in einer Pause: an den nächsten Satzanfang, wenn er nah ist
    const next = sents.find((x) => x.s >= a);
    if (next && next.s - a < 1.5) a = next.s;
  }
  if (speech && sents.some((x) => Math.abs(x.s - a) < 0.01)) a = inPoint(a, words);
  else {
    const sc = nearScene(scenes, a, 1.5);
    if (sc != null && !wordAt(words, sc)) { a = sc; notes.push('Start auf Bildwechsel'); }
    else { const q = quietest(fine, Math.max(0, a - 1), a + 0.5); if (q != null && !wordAt(words, q)) a = q; }
  }

  // ---- Ende ----
  const lim = Number.isFinite(maxLen) ? a + maxLen + OVER_MAX : Infinity;
  const se = speech ? sentAt(sents, b - 0.05) : null;
  if (se && se.e > b + 0.05) {
    // mitten im Satz → zu Ende sprechen lassen, wenn's kurz ist; sonst vor dem Satz aufhören
    const prev = [...sents].reverse().find((x) => x.e <= b && x.s >= a);
    if (se.e - b <= STRETCH && se.e <= lim) { b = se.e; notes.push('Ende nach dem Satz'); }
    else if (prev && prev.e - a >= minLen * 0.8) { b = prev.e; notes.push('Ende vor angefangenem Satz'); }
    else if (se.e <= lim + 10) { b = se.e; notes.push('Ende nach langem Satz'); }
  }
  // zu lang → am letzten Satzende vor der Grenze aufhören
  if (Number.isFinite(maxLen) && b - a > maxLen + OVER_MAX && speech) {
    const cut = [...sents].reverse().find((x) => x.e > a + Math.max(minLen, 5) && x.e - a <= maxLen + OVER_MAX);
    if (cut) { b = cut.e; notes.push('auf Maximallänge an Satzende gekürzt'); }
  }
  if (speech && sents.some((x) => Math.abs(x.e - b) < 0.01)) b = outPoint(b, words, fine, dur);
  else {
    const sc = nearScene(scenes, b, 1.5);
    if (sc != null && sc > a + minLen * 0.8 && !wordAt(words, sc)) { b = sc; notes.push('Ende auf Bildwechsel'); }
    else { const q = quietest(fine, b - 0.5, b + 1); if (q != null && !wordAt(words, q)) b = q; }
    const w = wordAt(words, b);
    if (w) b = outPoint(w.e, words, fine, dur);
  }
  // nie mitten im Wort anfangen
  const w0 = wordAt(words, a);
  if (w0) a = inPoint(w0.s, words);
  a = Math.max(0, a); b = Math.min(dur, b);
  if (b - a < 1) return { start: start, end: end, notes: [] };
  return { start: Math.round(a * 100) / 100, end: Math.round(b * 100) / 100, notes };
}

// Hook-Vorschau (Höhepunkt vorweg): auf ganze Wörter legen, kurz halten
export function snapHook(hook, { words = [], fine = null } = {}) {
  if (!hook || hook.mode !== 'preview' || !Number.isFinite(hook.at) || !Number.isFinite(hook.len)) return hook;
  let a = hook.at, b = hook.at + hook.len;
  const ws = wordAt(words, a);
  if (ws) a = inPoint(ws.s, words);
  const we = wordAt(words, b);
  if (we) b = we.e - b < 1.2 ? we.e + 0.12 : Math.max(a + 1.5, we.s - 0.05);
  else { const q = quietest(fine, b - 0.3, b + 0.4); if (q != null) b = q; }
  return { ...hook, at: Math.round(a * 100) / 100, len: Math.round(Math.max(1.5, b - a) * 100) / 100 };
}

// Zu entfernende Pausen (Langfassung) so schrumpfen, dass kein Wort angeschnitten wird
export function protectWords(cut, words) {
  if (!words?.length) return cut;
  return cut.map(([a, b]) => {
    for (const w of words) {
      if (w.e > a - 0.2 && w.s < a) a = w.e + 0.3;       // Satz klingt noch aus
      if (w.s < b + 0.25 && w.e > b) b = w.s - 0.3;       // nächster Satz beginnt
      if (w.s >= a && w.e <= b) return null;              // mitten drin wird gesprochen → Pause nicht entfernen
    }
    return b - a >= 1.5 ? [a, b] : null;
  }).filter(Boolean);
}

// Bausteine für die Kurzfassung: zusammenhängende Sätze (statt starrer 15-s-Stücke), bewertet nach Lautstärke/Bildwechseln
export function sentenceBlocks(sents, { loud = [], scenes = [], cut = [], target = 15, min = 6, max = 28 } = {}) {
  const blocks = [];
  let cur = null;
  const inCut = (t) => cut.some(([a, b]) => t >= a && t <= b);
  for (const x of sents) {
    if (inCut((x.s + x.e) / 2)) { if (cur) { blocks.push(cur); cur = null; } continue; }
    const gap = cur ? x.s - cur.end : 0;
    if (cur && (gap > 2.5 || (cur.end - cur.start >= target && gap > 0.4) || x.e - cur.start > max)) { blocks.push(cur); cur = null; }
    if (!cur) cur = { start: x.s, end: x.e, from: x.id, to: x.id };
    else { cur.end = x.e; cur.to = x.id; }
  }
  if (cur) blocks.push(cur);
  return blocks.filter((b) => b.end - b.start >= min).map((b) => {
    let sum = 0, n = 0, peak = -70;
    for (let i = Math.floor(b.start); i < Math.ceil(b.end) && i < loud.length; i++) { sum += loud[i]; n++; peak = Math.max(peak, loud[i]); }
    const sc = scenes.filter((t) => t >= b.start && t <= b.end).length;
    return { ...b, start: Math.round(b.start * 10) / 10, end: Math.round(b.end * 10) / 10, peak: Math.round(peak), score: (n ? sum / n : -70) + sc * 0.6, scenes: sc };
  });
}
