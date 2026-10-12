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

export function buildAss(words, { width = 1080, height = 1920, color = '#FFE14D', posY = 0.7, font = 'Anton' } = {}) {
  const size = Math.round(width * 0.12);
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${font},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,1,0,1,${Math.round(size * 0.09)},${Math.round(size * 0.05)},5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const hi = assColor(color);
  const x = Math.round(width / 2), y = Math.round(height * posY);
  const lines = [];
  for (const ch of chunks(words.filter((w) => clean(w.t)))) {
    for (let i = 0; i < ch.length; i++) {
      const start = ch[i].s;
      const end = i < ch.length - 1 ? ch[i + 1].s : Math.max(ch[i].e, start + 0.25);
      if (end <= start) continue;
      const text = ch.map((w, j) => {
        const t = clean(w.t).toUpperCase();
        // aktuelles Wort: Farbe + kurzer „Pop“
        return j === i ? `{\\c${hi}\\fscx112\\fscy112\\t(0,90,\\fscx100\\fscy100)}${t}{\\c&HFFFFFF&\\fscx100\\fscy100}` : t;
      }).join(' ');
      lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,{\\pos(${x},${y})}${text}`);
    }
  }
  return head + lines.join('\n') + '\n';
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
export function buildHookAss(text, { until = 2.2, width = 1080, height = 1920, pro = false, color = '#FFE14D' } = {}) {
  const t = clean(text);
  if (!t || until <= 0) return '';
  const size = Math.round(width * (pro ? 0.06 : 0.1));
  const font = pro ? 'Lato' : 'Anton';
  const box = pro ? '&H5A000000' : '&H00000000';
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,${font},${size},&H00FFFFFF,&H00FFFFFF,${box},${box},-1,0,0,0,100,100,1,0,3,${Math.round(size * 0.28)},0,8,80,80,${Math.round(height * (pro ? 0.08 : 0.13))},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const anim = pro ? '{\\fad(150,200)}' : `{\\fad(0,180)\\c${assColor(color)}\\fscx60\\fscy60\\t(0,140,\\fscx108\\fscy108)\\t(140,240,\\fscx100\\fscy100)}`;
  return head + `Dialogue: 1,${assTime(0)},${assTime(until)},Hook,,0,0,0,,${anim}${pro ? t : t.toUpperCase()}\n`;
}

// Effekt-Texte (z. B. „WARTE …“ beim Freeze) mittig, groß, mit Pop. items: [{ t, dur, text }]
export function buildFxAss(items, { width = 1080, height = 1920, color = '#FFE14D' } = {}) {
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
Style: Fx,Anton,${size},${assColor(color)},&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,2,0,1,${Math.round(size * 0.1)},${Math.round(size * 0.06)},5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  return head + list.map((x) => `Dialogue: 2,${assTime(x.t)},${assTime(x.t + (x.dur || 1))},Fx,,0,0,0,,{\\pos(${Math.round(width / 2)},${Math.round(height * 0.36)})\\fscx40\\fscy40\\t(0,120,\\fscx110\\fscy110)\\t(120,220,\\fscx100\\fscy100)\\fad(0,150)}${clean(x.text).toUpperCase()}`).join('\n') + '\n';
}
