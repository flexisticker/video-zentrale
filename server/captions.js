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
