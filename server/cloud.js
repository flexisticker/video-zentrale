// Günstige Cloud-KIs über die OpenAI-kompatible Schnittstelle (Chat Completions):
//   fal  = fal.ai „OpenRouter“ (nutzt den vorhandenen fal-Schlüssel und das fal-Guthaben) – Standard: Gemini Flash
//   google = Gemini direkt (Schlüssel aus aistudio.google.com)
//   deepseek = DeepSeek direkt (nur Text)
//   custom = eigene Adresse (z. B. OmniRoute oder OpenRouter direkt)
// Aufträge kommen im Anthropic-Format (content-Blöcke + JSON-Schema) und werden umgebaut. Kosten: aus der Antwort (fal/OpenRouter melden
// usage.cost), sonst Tokens × eingetragener Preis. Monatsbudget je Anbieter, Sperre bei Schlüssel-/Guthaben-Fehlern.
import { db, save } from './store.js';

export const PROVIDERS = {
  fal: { name: 'fal.ai (dein fal-Guthaben)', url: 'https://fal.run/openrouter/router/openai/v1', model: 'google/gemini-3.8-flash', priceIn: 0.75, priceOut: 3.75, vision: true, tier: 2,
    hint: 'Nutzt deinen fal-Schlüssel (Einstellungen → Titelbilder). Modellnamen wie bei OpenRouter, z. B. google/gemini-3.8-flash, deepseek/deepseek-chat.' },
  google: { name: 'Google Gemini direkt', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-latest', priceIn: 0.75, priceOut: 3.75, vision: true, tier: 2,
    hint: 'Schlüssel von aistudio.google.com (mit Abrechnung – der kostenlose Zugang darf deine Daten zum Training nutzen).' },
  deepseek: { name: 'DeepSeek direkt', url: 'https://api.deepseek.com', model: 'deepseek-chat', priceIn: 0.3, priceOut: 1.2, vision: false, tier: 2, jsonObject: true,
    hint: 'Nur Text (sieht keine Standbilder). Server in China.' },
  custom: { name: 'Eigene Adresse (OpenAI-kompatibel)', url: '', model: '', priceIn: 0, priceOut: 0, vision: false, tier: 2,
    hint: 'Z. B. OmniRoute (http://192.168.1.10:20128/v1) oder OpenRouter (https://openrouter.ai/api/v1).' },
};
export const TIERS = { 1: 'einfach', 2: 'gut', 3: 'sehr gut' };
const BLOCK_MS = 6 * 3600_000;

export function cfg() {
  const d = db();
  const c = (d.cloud ||= {});
  c.providers ||= {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const x = (c.providers[id] ||= {});
    x.enabled ??= id === 'fal';
    x.model ||= p.model; x.url ??= p.url; x.key ??= '';
    x.priceIn ??= p.priceIn; x.priceOut ??= p.priceOut; x.vision ??= p.vision; x.tier ??= p.tier;
  }
  c.blocked ||= {};
  c.spend ||= {};
  c.budgets ||= {};          // { claude: 20, fal: 10 } $ je Monat, 0/leer = ohne Grenze
  c.strategy ||= 'sparen';   // sparen = günstigste passende KI; qualitaet = beste Stufe, darin die günstigste
  return c;
}
const month = () => new Date().toISOString().slice(0, 7);
export const spentThisMonth = (id) => cfg().spend[month()]?.[id] || 0;
export function addSpend(id, cost) {
  if (!(cost > 0)) return;
  const s = (cfg().spend[month()] ||= {});
  s[id] = Math.round(((s[id] || 0) + cost) * 10000) / 10000;
  save();
}
export const overBudget = (id) => { const b = Number(cfg().budgets[id]) || 0; return b > 0 && spentThisMonth(id) >= b; };

const keyOf = (id) => (id === 'fal' ? db().fal?.key || '' : cfg().providers[id]?.key || '');
const urlOf = (id) => (process.env[`CLOUD_${id.toUpperCase()}_URL`] || cfg().providers[id]?.url || PROVIDERS[id]?.url || '').replace(/\/+$/, '');   // Umgebungsvariable nur für Tests
export function blocked(id) {
  const b = cfg().blocked[id];
  if (!b?.at) return null;
  return (b.until ? Date.now() < Date.parse(b.until) : Date.now() - Date.parse(b.at) < BLOCK_MS) ? b : null;
}
export function unblock(id) { delete cfg().blocked[id]; save(); }
// Einsatzbereit? (an, Schlüssel/Adresse da, nicht gesperrt, Budget nicht erreicht)
export function ready(id) {
  const p = cfg().providers[id];
  if (!p?.enabled || !p.model || !urlOf(id)) return false;
  if (id !== 'custom' && !keyOf(id)) return false;
  return !blocked(id) && !overBudget(id);
}
export const label = (id) => `${PROVIDERS[id]?.name.replace(/ \(.*\)$/, '') || id} (${cfg().providers[id]?.model || ''})`;
// Alle eingerichteten Anbieter mit Eigenschaften (für die Verteilung in ai.js)
export function engines() {
  return Object.keys(PROVIDERS).filter(ready).map((id) => {
    const p = cfg().providers[id];
    return { id, kind: 'cloud', label: label(id), tier: Number(p.tier) || 2, vision: !!p.vision, priceIn: Number(p.priceIn) || 0, priceOut: Number(p.priceOut) || 0 };
  });
}

export function status() {
  const c = cfg();
  return {
    strategy: c.strategy, budgets: c.budgets, tiers: TIERS, month: month(), spend: c.spend[month()] || {},
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => {
      const x = c.providers[id];
      return [id, { name: p.name, hint: p.hint, enabled: !!x.enabled, model: x.model, url: id === 'custom' ? x.url : '', hasKey: !!keyOf(id), keyHint: keyOf(id) ? '…' + keyOf(id).slice(-4) : '',
        priceIn: x.priceIn, priceOut: x.priceOut, vision: !!x.vision, tier: x.tier, ready: ready(id), blocked: blocked(id), spent: spentThisMonth(id), lastError: x.lastError || '' }];
    })),
  };
}
export function configure(b = {}) {
  const c = cfg();
  if (['sparen', 'qualitaet'].includes(b.strategy)) c.strategy = b.strategy;
  if (b.budgets && typeof b.budgets === 'object') for (const [k, v] of Object.entries(b.budgets)) {
    if (['claude', ...Object.keys(PROVIDERS)].includes(k)) c.budgets[k] = Math.max(0, Math.min(10000, Number(v) || 0));
  }
  if (b.providers && typeof b.providers === 'object') for (const [id, v] of Object.entries(b.providers)) {
    const x = c.providers[id];
    if (!x || !v || typeof v !== 'object') continue;
    if (typeof v.enabled === 'boolean') x.enabled = v.enabled;
    if (typeof v.model === 'string' && /^[\w.:/@-]{2,120}$/.test(v.model.trim())) x.model = v.model.trim();
    if (id !== 'fal' && typeof v.key === 'string' && v.key.trim() && !/^…/.test(v.key.trim())) { x.key = v.key.trim(); delete c.blocked[id]; }
    if (id !== 'fal' && v.key === '') x.key = '';
    if (id === 'custom' && typeof v.url === 'string') {
      const u = v.url.trim().replace(/\/+$/, '');
      if (u && !/^https?:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(u)) throw Object.assign(new Error('Adresse z. B. http://192.168.1.10:20128/v1'), { status: 400 });
      x.url = u;
    }
    for (const k of ['priceIn', 'priceOut']) if (v[k] != null && !isNaN(v[k])) x[k] = Math.max(0, Math.min(1000, Number(v[k])));
    if (typeof v.vision === 'boolean') x.vision = v.vision;
    if ([1, 2, 3].includes(Number(v.tier))) x.tier = Number(v.tier);
    if (v.unblock) delete c.blocked[id];
  }
  save();
  return status();
}

// ---------- Anfrage ----------
class CloudError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
function block(id, reason, ms = BLOCK_MS) {
  cfg().blocked[id] = { at: new Date().toISOString(), reason, until: new Date(Date.now() + ms).toISOString() };
  save();
}
const strip = (t) => String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
function complete(schema, o) {
  if (!schema || schema.type !== 'object') return true;
  if (!o || typeof o !== 'object') return false;
  return (schema.required || []).every((k) => k in o);
}

async function post(id, body, timeoutMs) {
  const headers = { 'Content-Type': 'application/json' };
  const key = keyOf(id);
  if (key) headers.Authorization = id === 'fal' ? `Key ${key}` : `Bearer ${key}`;
  let r;
  try {
    r = await fetch(urlOf(id) + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) { throw new CloudError(e.name === 'TimeoutError' ? 'antwortet nicht (Zeitüberschreitung)' : 'nicht erreichbar', 0); }
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 300);
    try { const j = JSON.parse(text); msg = j.error?.message || j.detail || j.message || msg; if (typeof msg !== 'string') msg = JSON.stringify(msg).slice(0, 300); } catch { /* roh */ }
    throw new CloudError(`${r.status}: ${msg}`, r.status);
  }
  try { return JSON.parse(text); } catch { throw new CloudError('Antwort unlesbar', 0); }
}

// → { out, engine, model, vision, cost, tokens } – wirft bei Fehler (ai.js nimmt dann die nächste KI)
export async function chat(id, task, content, schema, { maxTokens = 16000, timeoutMs = 15 * 60_000 } = {}) {
  const p = cfg().providers[id];
  const def = PROVIDERS[id];
  const vision = !!p.vision;
  const parts = [];
  for (const b of content) {
    if (b.type === 'text') parts.push({ type: 'text', text: b.text });
    else if (b.type === 'image' && vision && b.source?.data) parts.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type || 'image/jpeg'};base64,${b.source.data}` } });
  }
  const noImg = !vision && content.some((b) => b.type === 'image');
  if (noImg) parts.push({ type: 'text', text: '(Hinweis: Bilder stehen dir nicht zur Verfügung – entscheide nach Text und Signalen; Bild-Angaben wie Facecam-Lage schätze nicht, gib dort 0 bzw. Standardwerte.)' });
  const jsonHint = { type: 'text', text: '\nAntworte ausschließlich mit einem JSON-Objekt genau nach diesem JSON-Schema (alle Pflichtfelder), auf Deutsch:\n' + JSON.stringify(schema) };
  const base = { model: p.model, max_tokens: maxTokens, temperature: 0.4 };
  const withSchema = { ...base, messages: [{ role: 'user', content: parts }], response_format: { type: 'json_schema', json_schema: { name: 'antwort', schema, strict: true } } };
  const withObject = { ...base, messages: [{ role: 'user', content: [...parts, jsonHint] }], response_format: { type: 'json_object' } };
  const t0 = Date.now();
  let j, out, used = def?.jsonObject ? withObject : withSchema;
  try {
    try { j = await post(id, used, timeoutMs); }
    catch (e) {
      // Schema-Ausgabe nicht unterstützt → JSON-Modus mit Schema im Text
      if (e.status === 400 && used === withSchema && /response_format|json_schema|schema|strict/i.test(e.message)) { used = withObject; j = await post(id, used, timeoutMs); }
      else throw e;
    }
    const read = (x) => { try { return JSON.parse(strip(x.choices?.[0]?.message?.content)); } catch { return null; } };
    out = read(j);
    let cost = usageCost(id, j);
    if (!complete(schema, out)) {
      j = await post(id, { ...withObject, temperature: 0 }, timeoutMs);
      out = read(j); cost += usageCost(id, j);
      if (!complete(schema, out)) throw new CloudError('Antwort unvollständig (Pflichtfelder fehlen)', 0);
    }
    if (j.choices?.[0]?.finish_reason === 'length') throw new CloudError('Antwort abgeschnitten (zu lang)', 0);
    addSpend(id, cost);
    p.lastError = ''; save();
    return { out, engine: label(id), model: p.model, vision, cost, tokens: (j.usage?.prompt_tokens || 0) + (j.usage?.completion_tokens || 0), secs: (Date.now() - t0) / 1000 };
  } catch (e) {
    const s = e.status || 0, m = String(e.message || '');
    if (s === 401 || s === 403) block(id, 'Schlüssel ungültig oder ohne Rechte – ' + m.slice(0, 120));
    else if (s === 402 || /credit|balance|insufficient|quota|exhausted|billing|payment/i.test(m)) block(id, 'kein Guthaben bzw. Limit erreicht – ' + m.slice(0, 120));
    else if (s === 429) block(id, 'zu viele Anfragen – kurze Pause', 10 * 60_000);
    p.lastError = `${task}: ${m}`.slice(0, 300); save();
    throw new Error(`${label(id)}: ${m}`);
  }
}
function usageCost(id, j) {
  const u = j?.usage || {};
  if (typeof u.cost === 'number' && u.cost >= 0) return u.cost;   // fal/OpenRouter melden echte Kosten
  const p = cfg().providers[id];
  return ((u.prompt_tokens || 0) * (Number(p.priceIn) || 0) + (u.completion_tokens || 0) * (Number(p.priceOut) || 0)) / 1e6;
}

// Verbindung prüfen: kleine Anfrage mit Schema
export async function test(id) {
  if (!cfg().providers[id]) throw new Error('Unbekannter Anbieter.');
  const was = cfg().providers[id].enabled;
  if (!keyOf(id) && id !== 'custom') return { ok: false, error: id === 'fal' ? 'Kein fal-Schlüssel eingetragen (Einstellungen → Titelbilder).' : 'Kein Schlüssel eingetragen.' };
  try {
    cfg().providers[id].enabled = true;
    const r = await chat(id, 'test', [{ type: 'text', text: 'Antworte mit ok=true und einem kurzen deutschen Gruß.' }],
      { type: 'object', additionalProperties: false, required: ['ok', 'gruss'], properties: { ok: { type: 'boolean' }, gruss: { type: 'string' } } }, { maxTokens: 200, timeoutMs: 60_000 });
    return { ok: true, answer: r.out.gruss, cost: r.cost, secs: r.secs };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { cfg().providers[id].enabled = was; save(); }
}
