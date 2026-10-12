// Claude schlägt Titel, Beschreibung, Tags, TikTok-Text, Kanal und Titelbild vor.
// Grundlage: Standbilder aus dem Video + Dateiname/Notiz + Kanal-Angaben. (Ton/Sprache hört Claude nicht.)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { db, save, saveNow, DATA_DIR } from './store.js';
import * as profiles from './profiles.js';
import { fileOf, setImage } from './library.js';
import * as whisper from './whisper.js';
import * as thumbs from './thumbs.js';
import * as fx from './cutfx.js';

const MODEL = 'claude-opus-5-5';
const FRAMES = [0.08, 0.25, 0.42, 0.58, 0.75, 0.92];
const FRAME_DIR = path.join(DATA_DIR, 'ki');
const PRICE = { input: 4 / 1e6, output: 20 / 1e6 }; // US-$ je Token (Claude Opus 5.5)

const cfg = () => db().ai;

export function status() {
  const c = cfg();
  return { configured: !!c.apiKey, auto: c.auto, hints: c.hints, keyHint: c.apiKey ? '…' + c.apiKey.slice(-4) : '',
    spent: c.spent || 0, count: c.count || 0 };
}

export function configure(b) {
  const c = cfg();
  if (typeof b.apiKey === 'string' && b.apiKey.trim() && b.apiKey.trim() !== c.apiKey) {
    c.apiKey = b.apiKey.trim();
    // am alten Schlüssel gescheiterte Videos dürfen automatisch neu
    for (const v of Object.values(db().videos)) if (v.ai?.state === 'error' && !v.ai.titles) delete v.ai;
  }
  if (b.removeKey === true) c.apiKey = '';
  if (typeof b.auto === 'boolean') c.auto = b.auto;
  if (typeof b.hints === 'string') c.hints = b.hints.slice(0, 3000);
  saveNow();
  autoQueue();
}

export const framePath = (v, n) => path.join(FRAME_DIR, `${v.id}-${n}.jpg`);

function ffmpeg(args) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', args, { stdio: 'ignore' });
    const t = setTimeout(() => p.kill('SIGKILL'), 120_000);
    p.on('error', () => { clearTimeout(t); resolve(false); });
    p.on('close', (c) => { clearTimeout(t); resolve(c === 0); });
  });
}

// Standbilder sicherstellen (auch ohne Claude-Vorschlag, z. B. für KI-Titelbilder) → Nummern der vorhandenen Bilder
export async function ensureFrames(v) {
  const have = FRAMES.map((_, i) => i + 1).filter((n) => fs.existsSync(framePath(v, n)));
  if (have.length >= 3) return have;
  return (await extractFrames(v)).map((x) => x.n);
}

async function extractFrames(v) {
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  const out = [];
  for (let i = 0; i < FRAMES.length; i++) {
    const at = v.duration ? (v.duration * FRAMES[i]).toFixed(2) : String(i);
    const file = framePath(v, i + 1);
    // längste Seite max. 1280 px – reicht Claude und hält die Kosten klein
    const ok = await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-ss', at, '-i', fileOf(v),
      '-vf', "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'", '-frames:v', '1', '-q:v', '4', file]);
    if (ok && fs.existsSync(file)) out.push({ n: i + 1, file, at: Number(at) });
  }
  if (!out.length) throw new Error('Keine Standbilder lesbar (ffmpeg).');
  return out;
}

function schema(ids, labels, pro = false) {
  const s = (description) => ({ type: 'string', description });
  if (pro) return proSchema(ids, labels, s);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'game', 'channel', 'channelReason', 'titles', 'description', 'tags', 'tiktok', 'thumbnailFrame', 'thumbnailText', 'thumbs', 'aiThumb', 'viral'],
    properties: {
      summary: s('Ein Satz: was im Video passiert (für den Creator, nicht fürs Publikum).'),
      viral: { type: 'object', additionalProperties: false, required: ['score', 'why', 'tip', 'hook', 'edit', 'packaging', 'nextTime'],
        description: 'Ehrliche Einschätzung des Viral-Potenzials dieses Videos auf der Zielplattform – wie ein erfahrener Creator-Coach, direkt und konkret.',
        properties: { score: { type: 'integer', description: '1 = kaum, 10 = sehr hoch' }, why: s('Ein Satz Begründung (Hook, Emotion, Überraschung, Teilwert …)'),
          tip: s('Der wichtigste Tipp in einem Satz'),
          hook: s('Tipp zum Einstieg/Hook: wie die ersten 2 Sekunden fesseln (konkret, bezogen auf dieses Video)'),
          edit: s('Tipp zu Schnitt/Inhalt: was raus, kürzer, schneller, was betonen'),
          packaging: s('Tipp zu Titel/Titelbild/Text: was klickstärker wäre'),
          nextTime: s('Tipp für den Creator fürs nächste Mal beim Aufnehmen (z. B. Reaktionen laut aussprechen, Facecam, Ziel vorher ansagen)') } },
      game: s('Erkanntes Spiel bzw. Produkt/Thema, leer wenn unklar.'),
      channel: { type: 'string', enum: ids, description: 'Kanal-ID, zu dem das Video am besten passt.' },
      channelReason: s('Kurze Begründung für den Kanal.'),
      titles: { type: 'array', items: { type: 'string' }, description: 'Genau 3 YouTube-Titel, je höchstens 90 Zeichen, unterschiedlich im Stil.' },
      description: s('YouTube-Beschreibung: starke erste Zeile, 2–4 kurze Absätze, ohne Hashtag-Block, ohne erfundene Links.'),
      tags: { type: 'array', items: { type: 'string' }, description: '8–15 YouTube-Tags ohne #, kleingeschrieben.' },
      tiktok: s('TikTok-Text: 1–2 kurze Sätze mit Hook + 3–6 passende Hashtags, höchstens 300 Zeichen.'),
      thumbnailFrame: { type: 'integer', description: 'Nummer des Standbilds (1–6), das sich am besten als Titelbild eignet.' },
      thumbnailText: s('2–4 Wörter als Text fürs Titelbild (groß, knallig).'),
      aiThumb: { type: 'object', additionalProperties: false, required: ['frame', 'photo', 'text', 'scene'],
        description: 'Idee für ein von einer Bild-KI erzeugtes Titelbild (das stärkste, klickstärkste).',
        properties: {
          frame: { type: 'integer', description: 'Standbild-Nummer 1–6 als Szenen-Vorlage' },
          photo: { type: 'string', enum: labels, description: 'Gesichtsausdruck des Creators ("" = Creator nicht ins Bild)' },
          text: s('2–4 Wörter Schlagzeile fürs Bild, exakt so geschrieben, wie sie erscheinen soll'),
          scene: s('Auf Englisch: Bildaufbau für die Bild-KI – was im Vordergrund/Hintergrund passiert, Pose und Emotion der Person, '
            + 'Licht und Farben, wo der Text steht. Konkret, bildhaft, 2–4 Sätze, ohne den Text selbst zu wiederholen.'),
        } },
      thumbs: { type: 'array', description: 'Genau 3 unterschiedliche Titelbild-Ideen (Bild, Foto des Creators, Text, Seite des Fotos).',
        items: { type: 'object', additionalProperties: false, required: ['frame', 'photo', 'text', 'side'], properties: {
          frame: { type: 'integer', description: 'Standbild-Nummer 1–6 als Hintergrund' },
          photo: { type: 'string', enum: labels, description: 'Gesichtsausdruck des Creators, der zur Szene passt ("" = kein Foto)' },
          text: s('2–4 Wörter, neugierig machend, nicht identisch mit dem Titel'),
          side: { type: 'string', enum: ['left', 'right'], description: 'Seite für das Foto; der Text kommt auf die andere Seite – wähle die Seite, auf der im Standbild weniger Wichtiges ist' },
        } } },
    },
  };
}

// LinkedIn: gleiche Felder, andere Bedeutung (titles = Einstiegszeilen, description = Beitrag, tags = Hashtags, tiktok = Kurzfassung)
function proSchema(ids, labels, s) {
  const base = schema(ids, labels, false);
  const P = base.properties;
  P.titles = { type: 'array', items: { type: 'string' }, description: 'Genau 3 mögliche Einstiegszeilen (Hook) für den LinkedIn-Beitrag, je höchstens 90 Zeichen, sachlich und neugierig machend, Ich-Form, ohne Emojis.' };
  P.description = s('Der komplette LinkedIn-Beitrag in der Ich-Form (Michael postet als Person): erste Zeile = stärkster Hook (gleich dem ersten Titel), '
    + 'danach 3–6 kurze Absätze mit konkretem Mehrwert für Geschäftskunden (Problem → Lösung → Ergebnis bzw. Erfahrung/Tipp), professionell und seriös, '
    + 'ohne Übertreibung, ohne Marktschreierei, höchstens 1–2 dezente Emojis oder keine, am Ende eine offene Frage an das Netzwerk. 700–1500 Zeichen. '
    + 'Keine Hashtags im Text, keine erfundenen Zahlen, Kunden oder Links.');
  P.tags = { type: 'array', items: { type: 'string' }, description: '3–5 passende, gebräuchliche LinkedIn-Hashtags ohne #, z. B. 3ddruck, textildruck, werbetechnik, handwerk, mittelstand.' };
  P.tiktok = s('Ein Satz Kurzfassung als Videotitel bei LinkedIn (höchstens 100 Zeichen).');
  P.thumbnailText = s('2–4 sachliche Wörter fürs Titelbild (seriös, kein Clickbait).');
  P.aiThumb.properties.scene = s('Auf Englisch: Bildaufbau für ein seriöses, professionelles Titelbild (clean corporate look, ruhige Mimik, '
    + 'Werkstatt/Produkt im Fokus, natürliches Licht, dezente Farben). Konkret, 2–4 Sätze, ohne den Text selbst zu wiederholen.');
  return base;
}

function proPrompt(v, frames, extra, profile) {
  const orient = v.width && v.height ? (v.height > v.width ? 'Hochformat' : 'Querformat') : 'unbekannt';
  return [
    'Du hilfst Michael, Inhaber von Flexisticker (3D-Druck, Textil- und Tassendruck), ein Video auf seinem persönlichen LinkedIn-Profil zu veröffentlichen.',
    'Er postet als Person in der Ich-Form. Schreibe auf Deutsch, professionell, seriös und glaubwürdig – geschäftlicher Ton, kein Slang, keine Gaming-Sprache,',
    'keine Übertreibungen. Alles muss zu dem passen, was auf den Standbildern zu sehen bzw. im Video gesagt wird. Erfinde keine Fakten, Zahlen, Kunden oder Links.',
    `Profil: ${profile?.aiStyle || ''}`,
    cfg().hints ? '\nAllgemeine Hinweise:\n' + cfg().hints : '',
    '',
    'Video:',
    `- Dateiname: ${v.file}`,
    `- Bisheriger Titel: ${v.title || '–'}`,
    `- Länge: ${v.duration ? Math.round(v.duration) + ' Sekunden' : 'unbekannt'}, ${orient}`,
    v.note ? `- Notiz von Michael: ${v.note}` : '',
    v.transcriptText ? `- Gesprochener Text (automatisch erkannt, kann Fehler enthalten): „${v.transcriptText.slice(0, 12000)}“` : '',
    extra ? `- Hinweis für diesen Vorschlag: ${extra}` : '',
    `- Kanal: nimm "${profile.id}".`,
    '',
    `Es folgen ${frames.length} Standbilder in zeitlicher Reihenfolge (Nummer und Zeitpunkt stehen davor).`,
  ].filter((l) => l !== '').join('\n');
}

function prompt(v, frames, extra) {
  const lines = profiles.list().filter((p) => !profiles.isPro(p)).map((p) =>
    `- ID "${p.id}" = ${p.name}${p.isDefault ? ' (Standard)' : ''}: ${p.aiStyle || 'keine Beschreibung'}. Stichwörter: ${p.keywords || '–'}. Standard-Tags: ${p.tags || '–'}`);
  const orient = v.width && v.height ? (v.height > v.width ? 'Hochformat (Short/TikTok)' : 'Querformat') : 'unbekannt';
  return [
    'Du hilfst einem deutschen Creator, seine Videos für YouTube und TikTok zu veröffentlichen.',
    'Schreibe auf Deutsch, locker und direkt (Du-Form ans Publikum), ohne Übertreibung und ohne Clickbait-Lügen:',
    'alles, was du schreibst, muss zu dem passen, was auf den Standbildern zu sehen ist. Erfinde keine Fakten, Links oder Namen.',
    'Wenn du etwas nicht sicher erkennst (z. B. das Spiel), formuliere allgemein statt zu raten.',
    '',
    'Kanäle:',
    ...lines,
    cfg().hints ? '\nAllgemeine Hinweise des Creators:\n' + cfg().hints : '',
    '',
    'Video:',
    `- Dateiname: ${v.file}`,
    `- Bisheriger Titel: ${v.title || '–'}`,
    `- Länge: ${v.duration ? Math.round(v.duration) + ' Sekunden' : 'unbekannt'}, ${orient}`,
    v.tags ? `- Bisherige Tags: ${v.tags}` : '',
    v.note ? `- Notiz des Creators: ${v.note}` : '',
    v.transcriptText ? `- Gesprochener Text (automatisch erkannt, kann Fehler enthalten): „${v.transcriptText.slice(0, 12000)}“` : '',
    v.channel ? `- Der Creator hat den Kanal "${v.channel}" gewählt – schreibe passend dazu.` : '',
    extra ? `- Hinweis für diesen Vorschlag: ${extra}` : '',
    '',
    `Es folgen ${frames.length} Standbilder in zeitlicher Reihenfolge (Nummer und Zeitpunkt stehen davor).`,
  ].filter((l) => l !== '').join('\n');
}

let client = null, clientKey = '';
function api() {
  const key = cfg().apiKey;
  if (!key) throw new Error('Kein Claude-API-Schlüssel eingetragen (Einstellungen → Claude).');
  if (!client || clientKey !== key) { client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 180_000 }); clientKey = key; }
  return client;
}

function friendly(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Claude-API-Schlüssel ungültig – unter Einstellungen → Claude prüfen.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Der API-Schlüssel darf dieses Modell nicht nutzen.';
  if (e instanceof Anthropic.RateLimitError) return 'Claude ist gerade ausgelastet bzw. Limit erreicht – später erneut versuchen.';
  if (e instanceof Anthropic.BadRequestError) return /credit|balance/i.test(e.message) ? 'Kein Guthaben mehr im Anthropic-Konto (console.anthropic.com → Billing).' : 'Claude lehnt die Anfrage ab: ' + e.message;
  if (e instanceof Anthropic.APIConnectionError) return 'Keine Verbindung zu Claude (Internet/Firewall des Servers?).';
  if (e instanceof Anthropic.APIError) return `Claude-Fehler ${e.status}: ${e.message}`;
  return e.message;
}

// Vorschlag erzeugen und am Video speichern.
export async function suggest(v, extra = '') {
  // Gesprochenes erkennen, wenn Whisper an ist und das Video noch kein Transkript hat (z. B. von Hand geschnitten)
  if (!v.transcriptText && !v.source && db().cut?.whisper?.enabled) {
    try { const segs = await whisper.transcribe(fileOf(v), v.id); whisper.saveTranscript(v, segs); } catch { /* ohne Ton weiter */ }
  }
  const frames = await extractFrames(v);
  const chosen = v.channel ? profiles.get(v.channel) : null;
  const pro = profiles.isPro(chosen);
  // LinkedIn wählt Claude nie selbst – nur wenn das Video von Hand bzw. über „eingang-profi“ dorthin gehört
  const ids = pro ? [chosen.id] : profiles.list().filter((p) => !profiles.isPro(p)).map((p) => p.id);
  const labels = ['', ...new Set(thumbs.photos().map((p) => p.label))];
  const content = [{ type: 'text', text: (pro ? proPrompt(v, frames, extra, chosen) : prompt(v, frames, extra)) + (labels.length > 1
    ? `\n\nFür Titelbilder gibt es freigestellte Fotos des Creators mit diesen Gesichtsausdrücken: ${labels.filter(Boolean).join(', ')}.`
      + (pro ? ' Gute Titelbilder für LinkedIn: seriös, ruhige freundliche Mimik (z. B. „zeigend“, „nachdenklich“, „cool“), Produkt/Werkstatt im Fokus, 2–4 sachliche Wörter.'
        : ' Gute Titelbilder: ein klares Gefühl im Gesicht, das zur Szene passt, 2–4 große Wörter, starker Kontrast, neugierig machend.')
    : '\n\nEs gibt (noch) keine Fotos des Creators – nimm photo "".') }];
  for (const f of frames) {
    content.push({ type: 'text', text: `Standbild ${f.n} (bei ${Math.round(f.at)} s):` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f.file).toString('base64') } });
  }
  let r;
  try {
    r = await api().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // lehnt Claude ab, versucht es Anthropic automatisch mit einem passenden anderen Modell
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: schema(ids, labels, pro) } },
      messages: [{ role: 'user', content }],
    });
  } catch (e) { throw new Error(friendly(e)); }
  if (r.stop_reason === 'refusal') throw new Error('Claude hat diesen Vorschlag abgelehnt (Inhaltsprüfung).');
  if (r.stop_reason === 'max_tokens') throw new Error('Antwort von Claude abgeschnitten – bitte erneut versuchen.');
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out;
  try { out = JSON.parse(text); } catch { throw new Error('Antwort von Claude nicht lesbar.'); }
  const cost = (r.usage?.input_tokens || 0) * PRICE.input + (r.usage?.output_tokens || 0) * PRICE.output;
  const c = cfg();
  c.spent = Math.round(((c.spent || 0) + cost) * 10000) / 10000; c.count = (c.count || 0) + 1;
  const clip = (x, n) => String(x || '').slice(0, n);
  v.ai = {
    state: 'done', at: new Date().toISOString(), model: r.model || MODEL, cost: Math.round(cost * 10000) / 10000,
    frames: frames.map((f) => f.n),
    summary: clip(out.summary, 500), game: clip(out.game, 100),
    channel: ids.includes(out.channel) ? out.channel : '', channelReason: clip(out.channelReason, 300),
    titles: (Array.isArray(out.titles) ? out.titles : []).map((t) => clip(t, 100)).filter(Boolean).slice(0, 5),
    description: clip(out.description, 4500),
    tags: (Array.isArray(out.tags) ? out.tags : []).map((t) => clip(String(t).replace(/^#/, ''), 60)).filter(Boolean).slice(0, 20),
    tiktok: clip(out.tiktok, 2200),
    thumbnailFrame: Number.isInteger(out.thumbnailFrame) && frames.some((f) => f.n === out.thumbnailFrame) ? out.thumbnailFrame : frames[0].n,
    thumbnailText: clip(out.thumbnailText, 60),
    thumbs: (Array.isArray(out.thumbs) ? out.thumbs : []).slice(0, 3).map((t) => ({
      frame: frames.some((f) => f.n === t.frame) ? t.frame : frames[0].n, photo: clip(t.photo, 30),
      text: clip(t.text, 60), side: t.side === 'left' ? 'left' : 'right' })),
    aiThumb: out.aiThumb ? { frame: frames.some((f) => f.n === out.aiThumb.frame) ? out.aiThumb.frame : frames[0].n,
      photo: clip(out.aiThumb.photo, 30), text: clip(out.aiThumb.text, 60), scene: clip(out.aiThumb.scene, 1200) } : null,
    viral: out.viral && Number(out.viral.score) ? { score: Math.max(1, Math.min(10, Math.round(Number(out.viral.score)))),
      why: clip(out.viral.why, 300), tip: clip(out.viral.tip, 300), hook: clip(out.viral.hook, 300), edit: clip(out.viral.edit, 300),
      packaging: clip(out.viral.packaging, 300), nextTime: clip(out.viral.nextTime, 300) } : null,
  };
  if (v.ai.viral) v.viral = { ...v.ai.viral, by: 'Claude', at: v.ai.at };
  // Noch nichts von Hand oder per .json eingetragen → Vorschlag gleich übernehmen (bleibt änderbar).
  if (!v.editedAt && !v.metaAt) {
    const a = v.ai;
    if (a.titles[0]) v.title = a.titles[0];
    v.description = a.description;
    v.tags = a.tags.join(', ');
    v.tiktok = a.tiktok;
    a.applied = true;
  }
  // Titelbild-Varianten (Standbild + Foto + Text); ohne eigenes Titelbild gleich Variante 1 nehmen
  let vars = [];
  try { vars = await thumbs.makeVariants(v, (n) => { const f = framePath(v, n); return fs.existsSync(f) ? f : null; }); } catch (e) { console.error('Varianten', e.message); }
  // KI-Titelbild (fal.ai) – wird bevorzugt Titelbild, wenn noch keins gesetzt ist
  let aiOk = false;
  if (thumbs.autoAiThumb() && v.width > v.height && v.ai.aiThumb) {
    try { await thumbs.generateAi(v, (n) => { const f = framePath(v, n); return fs.existsSync(f) ? f : null; }); aiOk = true; }
    catch (e) { v.ai.aiThumbError = e.message; console.error('KI-Titelbild', e.message); }
  }
  if (!v.image) {
    try {
      const src = aiOk ? thumbs.variantPath(v, 5) : vars.length ? thumbs.variantPath(v, 1) : framePath(v, v.ai.thumbnailFrame);
      setImage(v, fs.readFileSync(src), '.jpg'); v.ai.coverApplied = true;
    } catch { /* egal */ }
  }
  saveNow();
  return v.ai;
}

// Aus Kandidaten-Stellen eines Rohvideos die besten Shorts wählen.
// cands: [{start, end, peak, scenes}] (Sekunden); segs: Whisper-Segmente oder null.
// Hook: der Moment, der in den ersten 1–2 Sekunden fesselt (für Shorts – siehe cutfx.js)
const HOOK_SCHEMA = { type: 'object', additionalProperties: false, required: ['mode', 'at', 'len', 'text'], properties: {
  mode: { type: 'string', enum: ['preview', 'cold', 'none'], description: 'preview = Höhepunkt 1–2,5 s vorweg zeigen, dann zurückspulen und den Clip von vorn; cold = Clip direkt kurz vor dem Höhepunkt beginnen (Anlauf weg); none = Anfang ist schon stark' },
  at: { type: 'number', description: 'Sekunde (ab Videoanfang) des stärksten Moments im Clip (Ausruf, Kill, Fail, Ergebnis)' },
  len: { type: 'number', description: 'Länge der Vorschau in Sekunden (1–2,5)' },
  text: { type: 'string', description: 'Hook-Text fürs erste Bild, höchstens 5 Wörter, Deutsch, neugierig machend (z. B. „Wie konnte das passieren?“); leer wenn unpassend' },
} };
const HOOK_RULES = (pro, profile) => {
  const style = profile?.hookStyle || (pro ? 'cold' : 'auto');
  if (style === 'off') return 'Hook: nicht gewünscht – gib mode "none" und leeren text.';
  return [
    'Hook (die ersten 1–2 Sekunden entscheiden, ob jemand weiterwischt): Bestimme je Clip den stärksten Moment (at).',
    pro ? 'LinkedIn: kein Effekt – nimm "cold" (mit der Kernaussage bzw. dem Ergebnis einsteigen) oder "none"; Hook-Text sachlich (z. B. „So spare ich 30 % Material“).'
      : style === 'auto' ? 'Wähle "preview", wenn der Höhepunkt erst später kommt und die Vorgeschichte zum Verständnis nötig ist; "cold", wenn der Moment ohne Anlauf wirkt; "none", wenn der Clip schon stark beginnt.'
      : style === 'preview' ? 'Der Creator möchte möglichst "preview" (Höhepunkt vorweg, dann zurückspulen).' : 'Der Creator möchte möglichst "cold" (direkt mitten rein).',
    profile?.hookHint ? `Hinweis zum Kanal: ${profile.hookHint}` : '',
  ].filter(Boolean).join('\n');
};

export async function chooseHighlights(v, cands, segs, c, profile, wish = '') {
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  const pro = profiles.isPro(profile);
  const content = [{ type: 'text', text: [
    ...(pro ? [
      'Du schneidest aus einer Rohaufnahme die besten kurzen Clips für LinkedIn – gepostet vom Inhaber eines Druck- und 3D-Druck-Betriebs als Person.',
      `Wähle bis zu ${c.shorts} Stellen, die allein verständlich und professionell sind: eine klare Kernaussage, ein Tipp, ein Ergebnis,`,
      'ein Vorher/Nachher, ein gelöstes Kundenproblem oder ein interessanter Einblick in die Fertigung. Keine Albernheiten, kein Leerlauf.',
      'Der Anfang muss in den ersten 2 Sekunden zeigen, worum es geht; Ende nach einem abgeschlossenen Gedanken. Lieber weniger, wenn nichts taugt.',
      `Kanalbeschreibung: ${profile.aiStyle || ''}`,
    ] : [
      'Du schneidest aus einer Rohaufnahme die besten Kurzvideos (Shorts/TikTok) für einen deutschen Creator.',
      `Wähle bis zu ${c.shorts} Stellen, die allein funktionieren: klarer Moment (Sieg, Fail, Überraschung, Lacher, Erklärung mit Pointe),`,
      'starker Anfang in den ersten 2 Sekunden, Ende nach der Pointe. Lieber weniger, wenn nichts taugt (dann leere Liste).',
    ]),
    `Länge je Short ${c.shortMin}–${c.shortMax} Sekunden. Start/Ende dürfen bis zu 15 Sekunden um den Kandidaten verschoben werden.`,
    profile?.clipHints ? `Worauf der Creator bei diesem Kanal Wert legt: ${profile.clipHints}` : '',
    'Nimm ruhig viele Stellen, wenn sie taugen – jede, die Zuschauer bindet (Hook, Emotion, Pointe), ist ein eigener Clip wert.',
    'Schätze für jeden Clip das Viral-Potenzial ehrlich ein (1 = kaum, 10 = sehr hoch): starker Hook in den ersten 2 Sekunden, Emotion,'
      + ' Überraschung, Wiederschau- und Teilwert, Verständlichkeit ohne Kontext. Keine Gefälligkeitswerte.',
    wish ? `WICHTIG – Wunsch des Creators für diesen Schnitt: „${wish}“. Richte die Auswahl danach aus (auch wenn dadurch weniger Shorts entstehen).` : '',
    HOOK_RULES(pro, profile),
    `Video: „${v.file}“, Länge ${whisper.fmtTime(v.duration)}. ${v.note ? 'Notiz: ' + v.note : ''}`,
    segs?.length ? 'Gesprochenes ist je Kandidat angegeben (automatisch erkannt, kann Fehler enthalten).' : 'Kein gesprochener Text verfügbar.',
    '',
    'Kandidaten (aus Lautstärke und Bildwechseln vorsortiert); zu jedem folgt ein Standbild aus der Mitte:',
  ].join('\n') }];
  for (let i = 0; i < cands.length; i++) {
    const k = cands[i];
    const mid = (k.start + k.end) / 2;
    const file = path.join(FRAME_DIR, `${v.id}-k${i + 1}.jpg`);
    const ok = await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-ss', mid.toFixed(2), '-i', fileOf(v),
      '-vf', "scale='if(gt(iw,ih),min(640,iw),-2)':'if(gt(iw,ih),-2,min(640,ih))'", '-frames:v', '1', '-q:v', '5', file]);
    const said = segs ? whisper.textOf(segs, k.start - 5, k.end + 5).slice(0, 600) : '';
    content.push({ type: 'text', text: `Kandidat ${i + 1}: ${whisper.fmtTime(k.start)}–${whisper.fmtTime(k.end)} (Sekunde ${k.start}–${k.end}), `
      + `lauteste Stelle ${k.peak} LUFS, ${k.scenes} Bildwechsel${said ? `, gesagt: „${said}“` : ''}` });
    if (ok && fs.existsSync(file)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(file).toString('base64') } });
      fs.rmSync(file, { force: true });
    }
  }
  const schemaH = {
    type: 'object', additionalProperties: false, required: ['shorts'],
    properties: { shorts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['candidate', 'start', 'end', 'title', 'reason', 'mood', 'music', 'viral', 'viralWhy', 'viralTip', 'hook'],
      properties: {
        candidate: { type: 'integer', description: 'Nummer des Kandidaten' },
        start: { type: 'number', description: 'Start in Sekunden ab Videoanfang' },
        end: { type: 'number', description: 'Ende in Sekunden ab Videoanfang' },
        title: { type: 'string', description: 'Kurzer, packender Titel für den Short (höchstens 70 Zeichen)' },
        reason: { type: 'string', description: 'Ein Satz: warum diese Stelle' },
        mood: { type: 'string', enum: ['episch', 'lustig', 'spannend', 'chillig', 'energisch', 'fröhlich', 'traurig'], description: 'Stimmung der Stelle (für Hintergrundmusik)' },
        music: { type: 'string', description: 'English, one short phrase: fitting instrumental background music (genre, tempo, instruments), e.g. "fast hype trap beat with heavy 808s"' },
        viral: { type: 'integer', description: 'Viral-Potenzial 1–10 (ehrlich)' },
        viralWhy: { type: 'string', description: 'Ein Satz: warum diese Einschätzung' },
        viralTip: { type: 'string', description: 'Ein konkreter Tipp, wie der Clip mehr Potenzial bekommt (z. B. Hook-Text, früher einsteigen)' },
        hook: HOOK_SCHEMA,
      } } } },
  };
  let r;
  try {
    r = await api().beta.messages.create({
      model: MODEL, max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: schemaH } },
      messages: [{ role: 'user', content }],
    });
  } catch (e) { throw new Error(friendly(e)); }
  if (r.stop_reason === 'refusal') throw new Error('abgelehnt');
  const out = JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  const cost = (r.usage?.input_tokens || 0) * PRICE.input + (r.usage?.output_tokens || 0) * PRICE.output;
  const a = cfg(); a.spent = Math.round(((a.spent || 0) + cost) * 10000) / 10000; a.count = (a.count || 0) + 1; save();
  const dur = v.duration;
  const picked = [];
  for (const s of (out.shorts || []).slice(0, c.shorts)) {
    const k = cands[s.candidate - 1];
    if (!k) continue;
    let start = Math.max(0, Math.max(k.start - 15, Math.min(Number(s.start), k.end)));
    let end = Math.min(dur, Math.min(k.end + 15, Math.max(Number(s.end), start + c.shortMin)));
    if (end - start > c.shortMax) end = start + c.shortMax;
    if (end - start < Math.min(c.shortMin, 10)) continue;
    if (picked.some((p) => start < p.end && end > p.start)) continue;
    picked.push({ start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10, title: String(s.title || '').slice(0, 100), reason: String(s.reason || '').slice(0, 300),
      mood: String(s.mood || ''), music: String(s.music || '').slice(0, 200),
      viral: Math.max(1, Math.min(10, Math.round(Number(s.viral) || 0))) || undefined, viralWhy: String(s.viralWhy || '').slice(0, 300), viralTip: String(s.viralTip || '').slice(0, 300),
      hook: s.hook && typeof s.hook === 'object' ? { mode: s.hook.mode, at: Number(s.hook.at), len: Number(s.hook.len), text: String(s.hook.text || '').slice(0, 60) } : null });
  }
  return picked;
}

// Kurzfassung: aus Bausteinen (je ~15 s) die besten in Summe ca. `target` Sekunden wählen – zeitliche Reihenfolge bleibt.
export async function chooseSummary(v, parts, segs, target, profile, wish = '') {
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  const pro = profiles.isPro(profile);
  const content = [{ type: 'text', text: [
    pro ? 'Du stellst aus einer Rohaufnahme eine professionelle Kurzfassung für LinkedIn zusammen (Inhaber eines Druck- und 3D-Druck-Betriebs, als Person).'
      : 'Du stellst aus einer Rohaufnahme eine Kurzfassung (Best-of / Zusammenfassung) für YouTube zusammen.',
    `Ziellänge insgesamt ca. ${Math.round(target)} Sekunden (±15 %). Wähle passende Stellen aus den Bausteinen; sie werden in zeitlicher Reihenfolge`,
    'hintereinander geschnitten. Die Kurzfassung soll für sich verständlich sein: klarer Einstieg, die wichtigsten Momente bzw. Aussagen, ein Abschluss.',
    'Start/Ende eines Bausteins darfst du um bis zu 8 Sekunden verschieben (z. B. damit ein Satz vollständig ist).',
    wish ? `WICHTIG – Wunsch des Creators: „${wish}“. Richte die Auswahl danach aus.` : '',
    `Video: „${v.file}“, Länge ${whisper.fmtTime(v.duration)}. ${v.note ? 'Notiz: ' + v.note : ''}`,
    segs?.length ? 'Gesprochenes steht je Baustein dabei (automatisch erkannt).' : 'Kein gesprochener Text verfügbar.',
    '', 'Bausteine (zu jedem ein Standbild aus der Mitte):',
  ].filter(Boolean).join('\n') }];
  for (let i = 0; i < parts.length; i++) {
    const k = parts[i];
    const file = path.join(FRAME_DIR, `${v.id}-z${i + 1}.jpg`);
    const ok = await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-ss', ((k.start + k.end) / 2).toFixed(2), '-i', fileOf(v),
      '-vf', "scale='if(gt(iw,ih),min(480,iw),-2)':'if(gt(iw,ih),-2,min(480,ih))'", '-frames:v', '1', '-q:v', '6', file]);
    const said = segs ? whisper.textOf(segs, k.start, k.end).slice(0, 400) : '';
    content.push({ type: 'text', text: `Baustein ${i + 1}: Sekunde ${k.start}–${k.end}, lauteste Stelle ${k.peak} LUFS, ${k.scenes} Bildwechsel${said ? `, gesagt: „${said}“` : ''}` });
    if (ok && fs.existsSync(file)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(file).toString('base64') } });
      fs.rmSync(file, { force: true });
    }
  }
  const schemaS = { type: 'object', additionalProperties: false, required: ['parts'],
    properties: { parts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['part', 'start', 'end'], properties: {
      part: { type: 'integer', description: 'Nummer des Bausteins' },
      start: { type: 'number', description: 'Start in Sekunden ab Videoanfang' },
      end: { type: 'number', description: 'Ende in Sekunden ab Videoanfang' } } } } } };
  let r;
  try {
    r = await api().beta.messages.create({ model: MODEL, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: schemaS } }, messages: [{ role: 'user', content }] });
  } catch (e) { throw new Error(friendly(e)); }
  if (r.stop_reason === 'refusal') throw new Error('abgelehnt');
  const out = JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  const cost = (r.usage?.input_tokens || 0) * PRICE.input + (r.usage?.output_tokens || 0) * PRICE.output;
  const a = cfg(); a.spent = Math.round(((a.spent || 0) + cost) * 10000) / 10000; a.count = (a.count || 0) + 1; save();
  const picked = [];
  for (const x of out.parts || []) {
    const k = parts[x.part - 1];
    if (!k) continue;
    const start = Math.max(0, k.start - 8, Math.min(Number(x.start), k.end - 3));
    const end = Math.min(v.duration, k.end + 8, Math.max(Number(x.end), start + 3));
    if (picked.some((p) => start < p.end && end > p.start)) continue;
    picked.push({ start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 });
  }
  // nicht über 130 % der Ziellänge
  picked.sort((p, q) => p.start - q.start);
  let total = 0;
  return picked.filter((p) => { total += p.end - p.start; return total <= target * 1.3 || p === picked[0]; });
}

// ---- Warteschlange (eins nach dem anderen) ----
const queue = [];
let running = false;

export function enqueue(v, extra = '') {
  if (!cfg().apiKey) throw new Error('Kein Claude-API-Schlüssel eingetragen (Einstellungen → Claude).');
  if (['queued', 'running'].includes(v.ai?.state)) return;
  v.ai = { ...(v.ai || {}), state: 'queued', error: '' };
  queue.push({ id: v.id, extra });
  save();
  next();
}

async function next() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  const v = db().videos[job.id];
  try {
    if (v && !v.missing) {
      v.ai = { ...v.ai, state: 'running' }; save();
      await suggest(v, job.extra);
    }
  } catch (e) {
    if (v) { v.ai = { ...v.ai, state: 'error', error: e.message }; saveNow(); }
  } finally { running = false; next(); }
}

// Neue geschnittene Videos automatisch vorschlagen lassen (nur einmal je Video).
export function autoQueue() {
  const c = cfg();
  if (!c.apiKey || !c.auto) return;
  for (const v of Object.values(db().videos)) {
    if (v.folder === 'geschnitten' && !v.missing && v.duration != null && !v.ai) enqueue(v);
  }
}

// 💡 Coach: Claude schaut auf die letzten Videos eines Kanals und gibt persönliche Tipps + Ideen (nur Text, wenige Cent).
export async function coach(profileId) {
  const prof = profiles.get(profileId) || profiles.fallback();
  const vids = Object.values(db().videos).filter((v) => !v.missing && v.folder !== 'papierkorb' && profiles.effective(v)?.id === prof.id
    && ['geschnitten', 'hochgeladen'].includes(v.folder))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 25);
  if (vids.length < 2) throw new Error('Zu wenige Videos in diesem Kanal für eine Einschätzung (mindestens 2).');
  const lines = vids.map((v, i) => [
    `${i + 1}. „${v.title || v.file}“ (${v.height > v.width ? 'Hochformat/Short' : 'Querformat'}, ${v.duration ? Math.round(v.duration) + ' s' : '?'}`
      + `${v.yt?.state === 'done' ? ', auf YouTube' : ''}${v.tt?.state === 'done' ? ', auf TikTok' : ''})`,
    v.ai?.summary ? `   Inhalt: ${v.ai.summary}` : '',
    v.viral?.score ? `   Viral-Einschätzung ${v.viral.score}/10: ${v.viral.why || ''}` : '',
    v.transcriptText ? `   Gesprochen (Ausschnitt): „${v.transcriptText.slice(0, 300)}“` : '',
  ].filter(Boolean).join('\n')).join('\n');
  const schemaC = { type: 'object', additionalProperties: false, required: ['summary', 'strengths', 'tips', 'ideas'], properties: {
    summary: { type: 'string', description: 'Zwei Sätze: wo der Kanal gerade steht' },
    strengths: { type: 'array', items: { type: 'string' }, description: '2–3 Dinge, die schon gut funktionieren (konkret)' },
    tips: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'text'], properties: {
      title: { type: 'string', description: 'Kurze Überschrift' }, text: { type: 'string', description: '2–3 Sätze, konkret und umsetzbar, mit Beispiel aus seinen Videos' } } },
      description: '5 persönliche Tipps, nach Wirkung sortiert (Hook, Rhythmus, Themen, Aufnahme, Titel/Titelbild, Regelmäßigkeit, Community)' },
    ideas: { type: 'array', items: { type: 'string' }, description: '3–5 konkrete Ideen für nächste Videos/Shorts, die zu seinem Stil passen' },
  } };
  let r;
  try {
    r = await api().beta.messages.create({ model: MODEL, max_tokens: 8000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: schemaC } },
      messages: [{ role: 'user', content: [
        `Du bist ein erfahrener, ehrlicher Coach für Kurzvideos und YouTube. Der Creator Michael (Deutsch, Du-Form) will mit dem Kanal „${prof.name}“ mehr Reichweite.`,
        `Kanal: ${prof.aiStyle || ''}`, prof.clipHints ? `Worauf er Wert legt: ${prof.clipHints}` : '',
        'Schau dir seine letzten Videos an und gib ihm persönliche, konkrete Tipps – keine Allgemeinplätze. Sei ehrlich, aber motivierend.',
        'Zahlen zu Aufrufen liegen nicht vor; stütze dich auf Inhalte, Titel und die Viral-Einschätzungen.', '', 'Letzte Videos:', lines,
      ].filter(Boolean).join('\n') }] });
  } catch (e) { throw new Error(friendly(e)); }
  if (r.stop_reason === 'refusal') throw new Error('abgelehnt');
  const out = JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  const cost = (r.usage?.input_tokens || 0) * PRICE.input + (r.usage?.output_tokens || 0) * PRICE.output;
  const a = cfg(); a.spent = Math.round(((a.spent || 0) + cost) * 10000) / 10000; a.count = (a.count || 0) + 1;
  db().coach = { ...(db().coach || {}), [prof.id]: { at: new Date().toISOString(), videos: vids.length, cost: Math.round(cost * 10000) / 10000, ...out } };
  saveNow();
  return db().coach[prof.id];
}

export function init() {
  for (const v of Object.values(db().videos)) {
    if (['queued', 'running'].includes(v.ai?.state)) v.ai = { ...v.ai, state: v.ai.titles ? 'done' : 'error', error: v.ai.titles ? '' : 'Durch Neustart unterbrochen.' };
  }
}

// Überarbeitung eines Shorts nach Wunsch: Claude sieht den bisherigen Schnitt, das Gesprochene ringsum und Standbilder
// und legt Start/Ende, Hook, Tempo und Musik neu fest. raw = Rohvideo, out = bisheriger Short.
export async function reviseShort(raw, out, wish, segs, profile, { minLen = 15, maxLen = 60 } = {}) {
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  const pro = profiles.isPro(profile);
  const src = out.source;
  const from = Math.max(0, src.start - 60), to = Math.min(raw.duration || src.end + 60, src.end + 60);
  const said = (segs || []).filter((x) => x.e > from && x.s < to).map((x) => `[${x.s.toFixed(1)}–${x.e.toFixed(1)}] ${x.t}`).join('\n').slice(0, 9000);
  const hook = out.edit?.hook || src.hook;
  const content = [{ type: 'text', text: [
    pro ? 'Du überarbeitest einen LinkedIn-Clip (Inhaber eines Druck- und 3D-Druck-Betriebs, als Person, professionell).'
      : 'Du überarbeitest einen Short (TikTok/YouTube Shorts) für einen deutschen Creator. Ziel: mehr Zuschauer halten, mehr Wiederschauen.',
    `WUNSCH DES CREATORS: „${wish}“ – setze das konsequent um.`,
    `Bisheriger Clip: Sekunde ${src.start.toFixed(1)}–${src.end.toFixed(1)} der Rohaufnahme „${raw.file}“ (Länge ${(src.end - src.start).toFixed(0)} s), Titel „${out.title || ''}“.`,
    hook ? `Bisheriger Hook: ${hook.mode}${hook.at != null ? ' bei Sekunde ' + hook.at : ''}${hook.text ? `, Text „${hook.text}“` : ''}.` : 'Bisher kein Hook.',
    `Bisheriges Tempo: ${out.edit?.tempo || src.tempo || 'normal'}. Musik: ${out.music ? 'ja' : 'nein'}.`,
    `Du darfst Start und Ende frei im Bereich Sekunde ${from.toFixed(0)}–${to.toFixed(0)} wählen; Länge ${minLen}–${maxLen} Sekunden.`,
    'Tempo: aus = nichts herausschneiden, ruhig = nur lange Pausen, normal = Pausen + „ähm“, schnell = Jump Cuts + kurze Zooms.',
    HOOK_RULES(pro, profile),
    profile?.clipHints ? `Worauf der Creator bei diesem Kanal Wert legt: ${profile.clipHints}` : '',
    said ? 'Gesprochenes in diesem Bereich (Sekunden ab Videoanfang, automatisch erkannt):\n' + said : 'Kein gesprochener Text verfügbar.',
    '', 'Standbilder (Sekunde steht jeweils davor):',
  ].filter(Boolean).join('\n') }];
  const times = [...new Set([src.start + 1, hook?.at, (src.start + src.end) / 2, src.end - 1, from + 5, to - 5]
    .filter((t) => Number.isFinite(t) && t >= 0).map((t) => Math.round(t)))].slice(0, 6);
  for (const t of times) {
    const file = path.join(FRAME_DIR, `${raw.id}-r${t}.jpg`);
    const ok = await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', fileOf(raw),
      '-vf', "scale='if(gt(iw,ih),min(640,iw),-2)':'if(gt(iw,ih),-2,min(640,ih))'", '-frames:v', '1', '-q:v', '5', file]);
    content.push({ type: 'text', text: `Sekunde ${t}:` });
    if (ok && fs.existsSync(file)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(file).toString('base64') } });
      fs.rmSync(file, { force: true });
    }
  }
  const schema = { type: 'object', additionalProperties: false,
    required: ['start', 'end', 'title', 'hook', 'tempo', 'music', 'changes', 'viral', 'viralWhy', 'viralTip'], properties: {
      start: { type: 'number', description: 'neuer Start (Sekunde ab Videoanfang)' },
      end: { type: 'number', description: 'neues Ende (Sekunde ab Videoanfang)' },
      title: { type: 'string', description: 'Titel (höchstens 70 Zeichen)' },
      hook: HOOK_SCHEMA,
      tempo: { type: 'string', enum: ['aus', 'ruhig', 'normal', 'schnell'] },
      music: { type: 'boolean', description: 'Hintergrundmusik ja/nein' },
      changes: { type: 'string', description: 'Ein bis zwei Sätze auf Deutsch (Du-Form an den Creator): was du geändert hast und warum' },
      viral: { type: 'integer', description: 'Viral-Potenzial 1–10 der neuen Fassung (ehrlich)' },
      viralWhy: { type: 'string' },
      viralTip: { type: 'string' },
    } };
  let r;
  try {
    r = await api().beta.messages.create({
      model: MODEL, max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    });
  } catch (e) { throw new Error(friendly(e)); }
  if (r.stop_reason === 'refusal') throw new Error('abgelehnt');
  const o = JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  const cost = (r.usage?.input_tokens || 0) * PRICE.input + (r.usage?.output_tokens || 0) * PRICE.output;
  const a = cfg(); a.spent = Math.round(((a.spent || 0) + cost) * 10000) / 10000; a.count = (a.count || 0) + 1; save();
  let start = Math.max(from, Math.min(to - minLen, Number(o.start)));
  if (!Number.isFinite(start)) start = src.start;
  let end = Math.min(to, Math.max(start + minLen, Number(o.end)));
  if (!Number.isFinite(end)) end = src.end;
  if (end - start > maxLen) end = start + maxLen;
  return { start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10, title: String(o.title || out.title || '').slice(0, 100),
    hook: o.hook ? { mode: o.hook.mode, at: Number(o.hook.at), len: Number(o.hook.len), text: String(o.hook.text || '').slice(0, 60) } : null,
    tempo: fx.TEMPO[o.tempo] !== undefined ? o.tempo : 'normal', music: !!o.music, changes: String(o.changes || '').slice(0, 500),
    viral: Math.max(1, Math.min(10, Math.round(Number(o.viral) || 0))) || undefined, viralWhy: String(o.viralWhy || '').slice(0, 300), viralTip: String(o.viralTip || '').slice(0, 300) };
}
