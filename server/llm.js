// Lokale KI (Ollama) statt Claude – spart Kosten. Zwei Orte:
//   Server = Ollama-Container auf dem Unraid-Server (läuft immer, nur Prozessor → langsam, meist reines Textmodell)
//   PC     = Ollama über den Rechenhelfer auf der RTX 3070 (nur wenn die Grafikkarte freigegeben ist, Modell mit Bildverständnis)
// Je Aufgabe einstellbar: lokal (nur Ollama) | auto (Ollama, bei Fehler Claude) | claude (Claude, bei Fehler Ollama) | nurclaude.
// Aufträge kommen im Anthropic-Format (content-Blöcke + JSON-Schema) und werden für Ollama umgebaut (/api/chat mit format = Schema).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, save, DATA_DIR } from './store.js';
import * as helper from './helper.js';

export const TASKS = {
  texte: 'Titel, Beschreibung, Tags, Titelbild-Plan',
  pruefung: 'Render-Prüfung fertiger Clips',
  themen: 'Spiel/Thema erkennen (Ordnung)',
  coach: 'Coach',
  scout: 'Späher (ganze Abschrift durchsuchen)',
  schnitt: 'Clips auswählen (Schnitt, Kurzfassung)',
  ueberarbeiten: 'Überarbeiten / Viral-Tipps umsetzen',
  trailer: 'Trailer-Dramaturgie',
};
export const MODES = ['smart', 'cloud', 'lokal', 'auto', 'claude', 'nurclaude'];
export const MODE_NAMES = { smart: '🤖 Automatisch (Preis & Qualität)', cloud: 'Günstige Cloud-KI, sonst lokal', lokal: 'Nur lokal', auto: 'Lokal, sonst Claude', claude: 'Claude, sonst lokal', nurclaude: 'Nur Claude' };
// Vorlagen. Standard (Wunsch des Kunden): das Teure lokal (lange Abschriften, viele Bilder), das Günstige bei Claude.
// Ist Claude gesperrt (kein Guthaben), laufen auch die Claude-Aufgaben lokal (ai.ask).
export const PRESETS = {
  smart: { name: '🤖 KI entscheidet nach Preis & Qualität (empfohlen)', modes: { texte: 'smart', pruefung: 'smart', themen: 'smart', coach: 'smart', scout: 'smart', schnitt: 'smart', ueberarbeiten: 'smart', trailer: 'smart' } },
  sparen: { name: 'Teures lokal, Günstiges Claude', modes: { texte: 'claude', pruefung: 'claude', themen: 'claude', coach: 'claude', scout: 'auto', schnitt: 'auto', ueberarbeiten: 'auto', trailer: 'auto' } },
  lokal: { name: 'Alles lokal (kostenlos)', modes: { texte: 'auto', pruefung: 'auto', themen: 'auto', coach: 'auto', scout: 'auto', schnitt: 'auto', ueberarbeiten: 'auto', trailer: 'auto' } },
  claude: { name: 'Alles Claude (beste Qualität)', modes: { texte: 'claude', pruefung: 'claude', themen: 'claude', coach: 'claude', scout: 'claude', schnitt: 'claude', ueberarbeiten: 'claude', trailer: 'claude' } },
};
const DEFAULT_MODES = PRESETS.smart.modes;
const OLD_DEFAULTS = { texte: 'auto', pruefung: 'auto', themen: 'auto', coach: 'auto', scout: 'auto', schnitt: 'claude', ueberarbeiten: 'claude', trailer: 'claude' };

const TMP = path.join(DATA_DIR, 'tmp');
export function cfg() {
  const d = db();
  if (!d.llm) d.llm = {};
  const c = d.llm;
  c.url ??= ''; c.model ??= 'qwen2.5:7b-instruct'; c.ctx ??= 16384;
  c.pc ??= { enabled: false, model: 'qwen2.5vl:7b' };
  c.tasks ??= {};
  c.stats ??= {};
  // 1.31.0 hatte „Kleines lokal“ als Vorgabe – noch unverändert gespeichert → auf die neue Vorgabe umstellen
  if (!c.presetV2) { if (Object.entries(OLD_DEFAULTS).every(([k, v]) => !c.tasks[k] || c.tasks[k] === v)) c.tasks = {}; c.presetV2 = true; }
  // 1.34.0: Standard ist jetzt „KI entscheidet“
  // (Wunsch des Kunden: „die KI soll entscheiden, was wo am besten ist“ → einmalig alle Aufgaben auf Automatisch, danach frei änderbar)
  if (!c.presetV3) { c.tasks = {}; c.presetV3 = true; }
  return c;
}
export const modeOf = (task) => { const m = cfg().tasks[task] || DEFAULT_MODES[task] || 'claude'; return MODES.includes(m) ? m : 'claude'; };

export function status() {
  const c = cfg();
  return { url: c.url, model: c.model, ctx: c.ctx, pc: { ...c.pc, ready: pcReady(), helperCan: helper.can('llm'), helperStatus: helper.status().status || '', helperVersion: helper.status().version || '' },
    tasks: Object.fromEntries(Object.keys(TASKS).map((k) => [k, modeOf(k)])), names: TASKS, presets: Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, p.name])), modeNames: MODE_NAMES, busy: { ...busy }, stats: c.stats, lastError: c.lastError || '', lastAt: c.lastAt || '' };
}
export function configure(b = {}) {
  const c = cfg();
  if (typeof b.url === 'string') {
    const u = b.url.trim().replace(/\/+$/, '');
    if (u && !/^https?:\/\/[\w.-]+(:\d+)?$/.test(u)) throw Object.assign(new Error('Ollama-Adresse z. B. http://192.168.1.10:11434'), { status: 400 });
    c.url = u;
  }
  if (typeof b.model === 'string' && /^[\w.:/-]{2,80}$/.test(b.model.trim())) c.model = b.model.trim();
  if (b.ctx != null && !isNaN(b.ctx)) c.ctx = Math.max(4096, Math.min(131072, Math.round(Number(b.ctx))));
  if (b.pc && typeof b.pc === 'object') {
    if (typeof b.pc.enabled === 'boolean') c.pc.enabled = b.pc.enabled;
    if (typeof b.pc.model === 'string' && /^[\w.:/-]{2,80}$/.test(b.pc.model.trim())) c.pc.model = b.pc.model.trim();
  }
  if (PRESETS[b.preset]) c.tasks = { ...PRESETS[b.preset].modes };
  if (b.tasks && typeof b.tasks === 'object') for (const [k, v] of Object.entries(b.tasks)) if (TASKS[k] && MODES.includes(v)) c.tasks[k] = v;
  if (b.resetStats === true) c.stats = {};
  save();
  return status();
}

const pcReady = () => !!cfg().pc.enabled && helper.canNow('llm');
export const serverReady = () => !!cfg().url;
// Ist für diese Aufgabe überhaupt eine lokale KI erreichbar (ohne Netz-Test)?
export const ready = () => pcReady() || serverReady();
// Wie viele Rechner können gerade gleichzeitig rechnen (Server + PC)?
export const engines = () => (pcReady() ? 1 : 0) + (serverReady() ? 1 : 0);
// Laufende Aufträge je Rechner – neue Aufträge gehen an den freieren (bei Gleichstand an den PC: schneller, sieht Bilder)
const busy = { pc: 0, server: 0 };
function pickTarget(hasImages) {
  const pc = pcReady(), srv = serverReady();
  if (pc && !srv) return 'pc';
  if (srv && !pc) return 'server';
  if (!pc && !srv) return null;
  // der freiere Rechner bekommt den Auftrag; bei Gleichstand der PC (schneller, sieht Bilder – wichtig bei Aufgaben mit Bildern)
  void hasImages;
  return busy.pc <= busy.server ? 'pc' : 'server';
}
// Modelle, die Bilder verstehen (Name genügt als Hinweis; beim Server fragt test() Ollama selbst)
const visionByName = (m) => /vl|vision|llava|gemma3|minicpm-v|moondream|qwen3-vl|mistral-small3\.[12]|llama4/i.test(m || '');
let serverVision = { model: '', vision: null, at: 0 };

async function ollama(url, p, body, timeoutMs) {
  let r;
  try {
    r = await fetch(url + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) { throw new Error(e.name === 'TimeoutError' ? 'Ollama antwortet nicht (Zeitüberschreitung)' : `Ollama nicht erreichbar (${url})`); }
  const text = await r.text();
  if (!r.ok) {
    if (r.status === 404 && /not found/i.test(text)) throw new Error(`Modell „${body?.model}“ fehlt in Ollama – bitte dort laden (ollama pull ${body?.model}).`);
    throw new Error(`Ollama ${r.status}: ${text.slice(0, 200)}`);
  }
  try { return JSON.parse(text); } catch { throw new Error('Ollama-Antwort unlesbar.'); }
}

async function serverHasVision() {
  const c = cfg();
  if (serverVision.model === c.model && Date.now() - serverVision.at < 3600_000) return serverVision.vision;
  let v = visionByName(c.model);
  try { const j = await ollama(c.url, '/api/show', { model: c.model }, 15_000); if (Array.isArray(j.capabilities)) v = j.capabilities.includes('vision'); } catch { /* Name entscheidet */ }
  serverVision = { model: c.model, vision: v, at: Date.now() };
  return v;
}

// Sieht die gerade zuständige lokale KI Bilder?
export async function visionAvailable() { return pcReady() ? visionByName(cfg().pc.model) : serverReady() ? serverHasVision() : false; }

// Verbindung prüfen: Modelle auf dem Server, gewähltes Modell vorhanden?, Bildverständnis, PC-Stand
export async function test() {
  const c = cfg();
  const out = { server: null, pc: { enabled: !!c.pc.enabled, ready: pcReady(), helperCan: helper.can('llm'), helperStatus: helper.status().status || '', helperVersion: helper.status().version || '', model: c.pc.model, vision: visionByName(c.pc.model) } };
  if (c.url) {
    try {
      const j = await ollama(c.url, '/api/tags', null, 8000);
      const models = (j.models || []).map((m) => m.name);
      const has = models.some((m) => m === c.model || m === c.model + ':latest');
      serverVision.at = 0;
      out.server = { ok: true, models, has, vision: has ? await serverHasVision() : null };
    } catch (e) { out.server = { ok: false, error: e.message }; }
  }
  return out;
}

// ---------- Anthropic-Inhalt → Ollama ----------
const est = (s) => Math.ceil(String(s).length / 3.2);   // grob Tokens (Deutsch)
// Zu lang für das Kontextfenster? Lange Textblöcke (Abschriften) anteilig kürzen – Anfang und Ende bleiben
function fit(texts, budget) {
  let total = texts.reduce((a, t) => a + est(t), 0);
  if (total <= budget) return { texts, cut: false };
  const long = texts.map((t, i) => [i, est(t)]).filter(([, n]) => n > 600);
  const longSum = long.reduce((a, [, n]) => a + n, 0);
  const over = total - budget;
  const out = [...texts];
  for (const [i, n] of long) {
    const keepTok = Math.max(250, n - Math.ceil(over * n / longSum));
    const keep = Math.floor(keepTok * 3.2);
    const t = out[i];
    const lines = t.split('\n');
    if (lines.length > 40) {
      // Abschrift: Zeilen mit Signalen (in Klammern: laut, LACHEN …) behalten, übrige gleichmäßig über die ganze Aufnahme ausdünnen
      const marked = lines.map((l, k) => [k, /\((?:[^)]*)(laut|LACH|SCHREI|Ausruf|Chat|Clip|Marker|Spieltext|schnell)/i.test(l)]);
      let budget = keep - marked.filter(([, m]) => m).reduce((x, [k]) => x + lines[k].length + 1, 0);
      const rest = marked.filter(([, m]) => !m).map(([k]) => k);
      const restLen = rest.reduce((x, k) => x + lines[k].length + 1, 0) || 1;
      const ratio = Math.max(0, Math.min(1, budget / restLen));
      const keepSet = new Set(marked.filter(([, m]) => m).map(([k]) => k));
      let acc = 0;
      for (const k of rest) { acc += ratio; if (acc >= 1) { keepSet.add(k); acc -= 1; } }
      out[i] = lines.filter((_, k) => keepSet.has(k)).join('\n') + `\n[gekürzt: ${keepSet.size} von ${lines.length} Zeilen, gleichmäßig verteilt]`;
      if (out[i].length > keep * 1.3) out[i] = out[i].slice(0, keep);
    } else out[i] = t.slice(0, Math.floor(keep * 0.7)) + '\n[… gekürzt …]\n' + t.slice(t.length - Math.floor(keep * 0.3));
  }
  return { texts: out, cut: true };
}

// Pflichtfelder vorhanden? (kleine Modelle lassen gern Felder weg)
function complete(schema, o) {
  if (!schema || schema.type !== 'object') return true;
  if (!o || typeof o !== 'object') return false;
  return (schema.required || []).every((k) => k in o);
}

function record(task, where, k) {
  const c = cfg();
  const s = (c.stats[task] ||= {});
  const x = (s[where] ||= { count: 0, cost: 0, tokens: 0, secs: 0, saved: 0, failed: 0 });
  for (const [key, val] of Object.entries(k)) x[key] = Math.round(((x[key] || 0) + val) * 10000) / 10000;
  save();
}
export const recordClaude = (task, cost, tokens) => record(task, 'claude', { count: 1, cost, tokens });
export const recordCloud = (task, id, k) => record(task, 'cloud:' + id, k);

// → { out, engine, model, vision, cut } – wirft bei Fehler (Aufrufer entscheidet über Claude als Rückfall)
export async function chat(task, content, schema, price, { onTarget } = {}) {
  const target = pickTarget(content.some((b) => b.type === 'image'));
  if (!target) throw new Error('Keine lokale KI eingerichtet (Einstellungen → Lokale KI).');
  busy[target]++;
  const tell = (t) => { try { onTarget?.(t === 'pc' ? `Ollama auf dem PC (${cfg().pc.model})` : `Ollama auf dem Server (${cfg().model})`); } catch { /* egal */ } };
  tell(target);
  try { return await chatOn(target, task, content, schema, price); }
  catch (e) {
    // PC hat den Auftrag nicht abgeholt (rechnet gerade Sprache/Analyse) oder ist weg → Server übernimmt
    if (target === 'pc' && serverReady() && /abgeholt|nicht rechtzeitig|verschwunden|Rechenhelfer/i.test(e.message)) {
      busy.server++; tell('server');
      try { return await chatOn('server', task, content, schema, price); } finally { busy.server--; }
    }
    throw e;
  } finally { busy[target]--; }
}
async function chatOn(target, task, content, schema, price) {
  const c = cfg();
  const usePc = target === 'pc';
  const model = usePc ? c.pc.model : c.model;
  const vision = usePc ? visionByName(model) : await serverHasVision();
  const ctx = usePc ? Math.min(c.ctx, 16384) : c.ctx;   // 8 GB Grafikspeicher: Kontext begrenzen
  const textBlocks = content.filter((b) => b.type === 'text').map((b) => b.text);
  let images = vision ? content.filter((b) => b.type === 'image' && b.source?.data).map((b) => b.source.data) : [];
  if (images.length > 6) images = images.slice(0, 6);   // lokal höchstens 6 Bilder (Kontext/Tempo)
  const note = !vision && content.some((b) => b.type === 'image') ? '\n(Hinweis: Bilder stehen dir nicht zur Verfügung – entscheide nach Text und Signalen; Bild-Angaben wie Facecam-Lage schätze nicht, gib dort 0 bzw. Standardwerte.)' : '';
  const reserve = 3000 + images.length * 900;
  const { texts, cut } = fit(textBlocks, ctx - reserve);
  const prompt = texts.join('\n') + note + '\n\nAntworte ausschließlich mit einem JSON-Objekt genau nach dem vorgegebenen Schema, auf Deutsch.';
  const body = { model, stream: false, format: schema, keep_alive: usePc ? '2m' : '10m',
    options: { temperature: 0.3, num_ctx: ctx }, messages: [{ role: 'user', content: prompt, ...(images.length ? { images } : {}) }] };
  const t0 = Date.now();
  const run = async (b) => {
    if (usePc) {
      fs.mkdirSync(TMP, { recursive: true });
      const f = path.join(TMP, `llm-${crypto.randomBytes(6).toString('hex')}.json`);
      fs.writeFileSync(f, JSON.stringify(b));
      try {
        const r = await helper.submit('llm', { files: { request: f }, params: { model }, label: task, timeoutMs: 45 * 60_000, pickupMs: 90_000 });
        return r.json || {};
      } finally { fs.rmSync(f, { force: true }); }
    }
    return ollama(c.url, '/api/chat', b, 45 * 60_000);
  };
  let j, out;
  try {
    j = await run(body);
    try { out = JSON.parse(j.message?.content || ''); } catch { out = null; }
    if (!complete(schema, out)) {   // zweiter Versuch, nüchterner
      j = await run({ ...body, options: { ...body.options, temperature: 0 } });
      try { out = JSON.parse(j.message?.content || ''); } catch { out = null; }
    }
    if (!complete(schema, out)) throw new Error('Antwort der lokalen KI unvollständig.');
  } catch (e) {
    c.lastError = `${TASKS[task] || task}: ${e.message}`; c.lastAt = new Date().toISOString();
    record(task, usePc ? 'pc' : 'server', { failed: 1 });
    throw e;
  }
  const tin = j.prompt_eval_count || 0, tout = j.eval_count || 0;
  record(task, usePc ? 'pc' : 'server', { count: 1, tokens: tin + tout, secs: (Date.now() - t0) / 1000, saved: price ? tin * price.input + tout * price.output : 0 });
  c.lastError = ''; c.lastAt = new Date().toISOString(); save();
  return { out, engine: usePc ? 'Ollama auf dem PC' : 'Ollama auf dem Server', model, vision, cut };
}
