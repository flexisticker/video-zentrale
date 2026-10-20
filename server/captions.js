// Animierte Untertitel (Wort für Wort) als ASS-Datei für ffmpeg/libass.
// words: [{ s, e, t }] in Sekunden, bereits relativ zum Clip-Anfang.
const assTime = (s) => {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${x.toFixed(2).padStart(5, '0')}`;
};
// #RRGGBB → &HBBGGRR& (ASS)
const assColor = (hex) => { const h = String(hex || '#ffffff').replace('#', '').padEnd(6, 'f'); return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`; };
const clean = (t) => String(t).replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();

// Wörter zu kurzen Blöcken (max. 3 Wörter / 18 Zeichen, Bruch bei Pause oder Satzende)
export function chunks(words) {
  const out = []; let cur = [];
  const flush = () => { if (cur.length) out.push(cur); cur = []; };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const len = cur.map((x) => x.t).join(' ').length + w.t.length;
    if (prev && (w.s - prev.e > 0.6 || cur.length >= 3 || len > 18 || /[.!?]$/.test(prev.t))) flush();
    cur.push(w);
  }
  flush();
  return out;
}

// ---------- Text-Vorlagen (wie StreamLadder / Opus Clip) ----------
// mode:  hi = ganzer Block sichtbar, aktives Wort hervorgehoben · reveal = Wörter erscheinen nacheinander
//        karaoke = Block füllt sich Wort für Wort · single = immer nur ein Wort, groß
// anim:  pop | bounce | shake | none        box: farbiger Kasten hinter dem aktiven Wort
export const STYLES = {
  klassik: { name: 'Klassisch', desc: 'Gelbes aktives Wort, kurzer Pop', font: 'Anton', size: 0.12, upper: true, mode: 'hi', anim: 'pop', hi: '#FFE14D', words: 3 },
  hormozi: { name: 'Hormozi', desc: 'Fett, Großbuchstaben, grüne Schlüsselwörter', font: 'Archivo Black', size: 0.1, upper: true, mode: 'hi', anim: 'pop', hi: '#3CF06E', emph: '#FFE14D', words: 3, outline: 0.11 },
  karaoke: { name: 'Karaoke', desc: 'Satz füllt sich Wort für Wort', font: 'Poppins Black', size: 0.1, upper: false, mode: 'karaoke', hi: '#FFE14D', words: 5, chars: 28 },
  pop: { name: 'Pop', desc: 'Jedes Wort springt einzeln rein', font: 'Bangers', size: 0.13, upper: true, mode: 'reveal', anim: 'bounce', hi: '#FFFFFF', emph: '#FF4FA3', words: 3, spacing: 2 },
  box: { name: 'Box', desc: 'Farbiger Kasten hinter dem aktiven Wort', font: 'Poppins Black', size: 0.105, upper: true, mode: 'hi', anim: 'pop', box: '#FF6B2E', hi: '#FFFFFF', words: 3 },
  neon: { name: 'Neon', desc: 'Leuchtende Schrift', font: 'Bebas Neue', hookScale: 1.35, size: 0.15, upper: true, mode: 'hi', anim: 'pop', hi: '#FFFFFF', glow: '#FF2BD6', base: '#BFF8FF', words: 3, spacing: 3 },
  comic: { name: 'Comic', desc: 'Dicke Kontur, leicht schräg', font: 'Luckiest Guy', size: 0.12, upper: true, mode: 'hi', anim: 'bounce', hi: '#FFD23F', emph: '#FF4B3E', words: 3, outline: 0.13, tilt: -4 },
  einzelwort: { name: 'Einzelwort', desc: 'Immer nur ein Wort, groß', font: 'Archivo Black', size: 0.15, upper: true, mode: 'single', anim: 'bounce', hi: '#FFFFFF', emph: '#FFE14D', words: 1 },
  schreibmaschine: { name: 'Schreibmaschine', desc: 'Wörter tippen sich nacheinander ein', font: 'Rubik Mono One', size: 0.07, upper: true, mode: 'reveal', anim: 'none', hi: '#FFFFFF', emph: '#57E2FF', words: 4, chars: 24, box: '#000000', boxAll: true },
  glitch: { name: 'Glitch', desc: 'Kurzer Farbversatz bei jedem Wort', font: 'Archivo Black', size: 0.1, upper: true, mode: 'hi', anim: 'none', hi: '#FFFFFF', emph: '#FFE14D', words: 3, glitch: true },
  wackeln: { name: 'Wackeln', desc: 'Aktives Wort wackelt (Rage, Action)', font: 'Anton', size: 0.13, upper: true, mode: 'hi', anim: 'shake', hi: '#FF5A3C', emph: '#FFE14D', words: 3 },
  marker: { name: 'Marker', desc: 'Handschrift, locker', font: 'Permanent Marker', size: 0.1, upper: false, mode: 'hi', anim: 'pop', hi: '#FFB020', words: 3 },
};
export const STYLE_IDS = Object.keys(STYLES);
// Hook-/Einblende-Texte: kasten (schwarzer Kasten) · banner (farbiges Band, schräg) · umriss (große Schrift mit Kontur) · neon
export const HOOK_LOOKS = { kasten: 'Kasten', banner: 'Farbiges Band', umriss: 'Große Kontur-Schrift', neon: 'Neon' };

const HEAD = (width, height, styles) => `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
// Wörter zu Blöcken je Stil
function chunksFor(words, st) {
  const max = st.words || 3, chars = st.chars || 18;
  const out = []; let cur = [];
  const flush = () => { if (cur.length) out.push(cur); cur = []; };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const len = cur.map((x) => x.t).join(' ').length + w.t.length;
    if (prev && (w.s - prev.e > 0.6 || cur.length >= max || len > chars || /[.!?]$/.test(prev.t))) flush();
    cur.push(w);
  }
  flush();
  return out;
}
const normWord = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
// Schlüsselwort? (Claude-Liste, sonst Zahlen)
const isEmph = (w, set) => set.has(normWord(w.t)) || /\d/.test(w.t);

// words: [{ s, e, t }] relativ zum Clip. style: Vorlagen-ID. emph: Schlüsselwörter (Claude). color: eigene Akzentfarbe (nur „klassik“)
export function buildStyledAss(words, { style = 'klassik', width = 1080, height = 1920, posY = 0.7, emph = [], color = '' } = {}) {
  const st = STYLES[style] || STYLES.klassik;
  const size = Math.round(width * st.size);
  const ol = Math.round(size * (st.outline ?? 0.09)), sh = st.glow ? 0 : Math.round(size * 0.05);
  const hi = assColor(style === 'klassik' && color ? color : st.hi);
  const emC = assColor(st.emph || (style === 'klassik' && color ? color : st.hi));
  const baseC = assColor(st.base || '#FFFFFF');
  const sp = st.spacing || (st.upper ? 1 : 0);
  const styles = [
    `Style: Cap,${st.font},${size},${st.mode === 'karaoke' ? hi : baseC},${st.mode === 'karaoke' ? baseC : '&H00FFFFFF'},&H00000000,&H64000000,0,0,0,0,100,100,${sp},${st.tilt || 0},1,${ol},${sh},5,60,60,0,1`,
  ];
  if (st.box) styles.push(`Style: Box,${st.font},${size},${baseC},&H00FFFFFF,&HFF000000,&HFF000000,0,0,0,0,100,100,${sp},0,3,${Math.round(size * 0.16)},0,5,60,60,0,1`);
  if (st.glow) styles.push(`Style: Glow,${st.font},${size},${assColor(st.glow)},&H00FFFFFF,${assColor(st.glow)},&H00000000,0,0,0,0,100,100,${sp},0,1,${Math.round(size * 0.12)},0,5,60,60,0,1`);
  const set = new Set((emph || []).map(normWord).filter(Boolean));
  const x = Math.round(width / 2), y = Math.round(height * posY);
  const pos = `\\pos(${x},${y})`;
  const word = (w) => { const t = clean(w.t); return st.upper ? t.toUpperCase() : t; };
  const anim = (on) => !on ? '' : st.anim === 'pop' ? '\\fscx112\\fscy112\\t(0,90,\\fscx100\\fscy100)'
    : st.anim === 'bounce' ? '\\fscx55\\fscy55\\t(0,110,\\fscx118\\fscy118)\\t(110,200,\\fscx100\\fscy100)'
      : st.anim === 'shake' ? '\\frz-7\\t(0,70,\\frz6)\\t(70,140,\\frz-4)\\t(140,210,\\frz0)' : '';
  const lines = [];
  const list = words.filter((w) => clean(w.t));
  const add = (layer, a, b, styleName, text) => { if (b > a) lines.push(`Dialogue: ${layer},${assTime(a)},${assTime(b)},${styleName},,0,0,0,,${text}`); };
  for (const ch of chunksFor(list, st)) {
    const endOf = (i) => (i < ch.length - 1 ? ch[i + 1].s : Math.max(ch[i].e, ch[i].s + 0.3));
    if (st.mode === 'karaoke') {
      // ganzer Block auf einmal, Farbe läuft Wort für Wort durch (\kf in Hundertstel)
      const a = ch[0].s, b = Math.max(ch[ch.length - 1].e, a + 0.4);
      const txt = ch.map((w, j) => { const d = Math.max(1, Math.round(((j < ch.length - 1 ? ch[j + 1].s : w.e) - w.s) * 100)); return `{\\kf${d}}${isEmph(w, set) ? `{\\c${emC}}` : ''}${word(w)}${isEmph(w, set) ? `{\\c${hi}}` : ''}`; });
      // Vorlauf (Zeit vor dem ersten Wort) als leeres \k
      add(0, a, b, 'Cap', `{${pos}\\fad(60,80)}` + txt.join(' '));
      continue;
    }
    for (let i = 0; i < ch.length; i++) {
      const a = ch[i].s, b = endOf(i);
      if (b <= a) continue;
      const shown = st.mode === 'reveal' ? ch.slice(0, i + 1) : st.mode === 'single' ? [ch[i]] : ch;
      const at = st.mode === 'single' ? 0 : i;
      const parts = shown.map((w, j) => {
        const active = j === at, em = isEmph(w, set);
        const c = active ? (em && st.emph ? emC : hi) : (em && st.mode !== 'hi' ? emC : baseC);
        const big = em ? '\\fscx118\\fscy118' : '';
        if (st.box && (active || st.boxAll)) return `{\\3c${assColor(active ? st.box : '#000000')}\\3a&H00&\\c${c}${big}${active ? anim(true) : ''}}${word(w)}{\\3a&HFF&\\c${baseC}\\fscx100\\fscy100}`;
        return active ? `{\\c${c}${big}${anim(true)}}${word(w)}{\\c${baseC}\\fscx100\\fscy100\\frz0}` : (big ? `{\\c${c}${big}}${word(w)}{\\c${baseC}\\fscx100\\fscy100}` : word(w));
      });
      const text = parts.join(' ');
      if (st.box) add(0, a, b, 'Box', `{${pos}}` + text);
      if (st.glow) {
        const plain = shown.map(word).join(' ');
        add(0, a, b, 'Glow', `{${pos}\\blur9\\alpha&H30&}` + plain);
      }
      if (!st.box) add(1, a, b, 'Cap', `{${pos}}` + text);
      if (st.glitch) {
        const plain = shown.map(word).join(' '), g = Math.min(b, a + 0.12), d = Math.round(size * 0.06);
        add(2, a, g, 'Cap', `{\\pos(${x - d},${y})\\c&H3C3CFF&\\alpha&H40&\\bord0\\shad0}` + plain);
        add(2, a, g, 'Cap', `{\\pos(${x + d},${y + 2})\\c&HFFF03C&\\alpha&H40&\\bord0\\shad0}` + plain);
      }
    }
  }
  return HEAD(width, height, styles) + lines.join('\n') + '\n';
}

// Klassische Untertitel (wie bis 1.29) – bleibt für Trailer & Co.
export function buildAss(words, { width = 1080, height = 1920, color = '#FFE14D', posY = 0.7 } = {}) {
  return buildStyledAss(words, { style: 'klassik', width, height, posY, color });
}

// Ruhige, seriöse Untertitel (LinkedIn): Satzteile in normaler Schreibweise, weiß auf halbtransparentem Kasten, unten.
export function buildCalmAss(words, { width = 1080, height = 1350, posY = 0.86, font = 'Lato' } = {}) {
  const size = Math.round(width * 0.052);
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${font},${size},&H00FFFFFF,&H00FFFFFF,&H5A000000,&H5A000000,-1,0,0,0,100,100,0,0,3,${Math.round(size * 0.35)},0,2,90,90,${Math.round(height * (1 - posY))},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  // Wörter zu Zeilen bis ca. 38 Zeichen, Bruch bei Pause/Satzende
  const lines = []; let cur = [];
  const flush = () => { if (cur.length) lines.push(cur); cur = []; };
  for (const w of words.filter((x) => clean(x.t))) {
    const prev = cur[cur.length - 1];
    const len = cur.map((x) => clean(x.t)).join(' ').length + clean(w.t).length + 1;
    if (prev && (w.s - prev.e > 0.8 || len > 38 || /[.!?]$/.test(prev.t))) flush();
    cur.push(w);
  }
  flush();
  const ev = lines.map((l, i) => {
    const start = l[0].s;
    const next = lines[i + 1]?.[0].s ?? Infinity;
    const end = Math.min(next, Math.max(l[l.length - 1].e + 0.4, start + 0.8));
    return `Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${l.map((w) => clean(w.t)).join(' ')}`;
  });
  return head + ev.join('\n') + '\n';
}

// Hook-Text oben im Bild für die ersten Sekunden (groß, mit Kasten, kurzer „Pop“). pro = ruhig für LinkedIn.
// top = Abstand von oben in Pixeln (z. B. an die Naht unter der Facecam, damit das Gesicht frei bleibt)
export function buildHookAss(text, { until = 2.2, width = 1080, height = 1920, pro = false, color = '#FFE14D', top = null, look = 'kasten', style = '' } = {}) {
  const t = clean(text);
  if (!t || until <= 0) return '';
  const st = STYLES[style];
  const font = pro ? 'Lato' : st?.font || 'Anton';
  const size = Math.round(width * (pro ? 0.06 : look === 'umriss' ? 0.115 : 0.1) * (pro ? 1 : st?.hookScale || 1));
  const mv = top != null ? Math.round(top) : Math.round(height * (pro ? 0.08 : 0.13));
  // Akzentfarbe: erste kräftige Farbe der Vorlage (nicht fast schwarz/weiß)
  const vivid = (hex) => { if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return false; const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return Math.max(r, g, b) - Math.min(r, g, b) > 60; };
  const acc = assColor([st?.box, st?.emph, st?.hi, st?.glow, color].find(vivid) || '#FFE14D');
  let styleLine, anim;
  if (pro) {
    styleLine = `Style: Hook,${font},${size},&H00FFFFFF,&H00FFFFFF,&H5A000000,&H5A000000,-1,0,0,0,100,100,1,0,3,${Math.round(size * 0.28)},0,8,80,80,${mv},1`;
    anim = '{\\fad(150,200)}';
  } else if (look === 'banner') {
    // farbiges Band, schwarze Schrift, leicht schräg
    styleLine = `Style: Hook,${font},${size},&H00101010,&H00FFFFFF,${acc},${acc},-1,0,0,0,100,100,1,3,3,${Math.round(size * 0.32)},0,8,40,40,${mv},1`;
    anim = '{\\fad(0,180)\\fscx40\\fscy100\\t(0,140,\\fscx106)\\t(140,240,\\fscx100)}';
  } else if (look === 'umriss') {
    styleLine = `Style: Hook,${font},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,2,0,1,${Math.round(size * 0.13)},${Math.round(size * 0.07)},8,60,60,${mv},1`;
    anim = `{\\fad(0,180)\\c${acc}\\fscx60\\fscy60\\t(0,140,\\fscx110\\fscy110)\\t(140,240,\\fscx100\\fscy100)}`;
  } else if (look === 'neon') {
    styleLine = `Style: Hook,${font},${size},&H00FFFFFF,&H00FFFFFF,&H00D62BFF,&H00000000,-1,0,0,0,100,100,2,0,1,${Math.round(size * 0.1)},0,8,60,60,${mv},1`;
    anim = '{\\fad(120,180)\\blur4}';
  } else {
    styleLine = `Style: Hook,${font},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,3,${Math.round(size * 0.28)},0,8,80,80,${mv},1`;
    anim = `{\\fad(0,180)\\c${assColor(color)}\\fscx60\\fscy60\\t(0,140,\\fscx108\\fscy108)\\t(140,240,\\fscx100\\fscy100)}`;
  }
  return HEAD(width, height, [styleLine]).replace('WrapStyle: 2', 'WrapStyle: 0') + `Dialogue: 1,${assTime(0)},${assTime(until)},Hook,,0,0,0,,${anim}${pro ? t : t.toUpperCase()}\n`;
}

// Effekt-Texte (z. B. „WARTE …“ beim Freeze) mittig, groß, mit Pop. items: [{ t, dur, text }]
export function buildFxAss(items, { width = 1080, height = 1920, color = '#FFE14D', style = '' } = {}) {
  const list = (items || []).filter((x) => clean(x.text));
  if (!list.length) return '';
  const size = Math.round(width * 0.11);
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Fx,${STYLES[style]?.font || 'Anton'},${size},${assColor(color)},&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,2,0,1,${Math.round(size * 0.1)},${Math.round(size * 0.06)},5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  return head + list.map((x) => `Dialogue: 2,${assTime(x.t)},${assTime(x.t + (x.dur || 1))},Fx,,0,0,0,,{\\pos(${Math.round(width / 2)},${Math.round(height * 0.36)})\\fscx40\\fscy40\\t(0,120,\\fscx110\\fscy110)\\t(120,220,\\fscx100\\fscy100)\\fad(0,150)}${clean(x.text).toUpperCase()}`).join('\n') + '\n';
}
