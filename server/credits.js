// Guthaben der KI-Dienste im Blick behalten und rechtzeitig warnen.
// fal.ai: echtes Guthaben über GET https://api.fal.ai/v1/account/billing?expand=credits (braucht einen Schlüssel mit
//   Berechtigung billing:usage:read – Vorlagen BILLING/READONLY/FULL; laut fal-Doku, Antwortfeld defensiv gelesen).
// Claude (Anthropic): keine Guthaben-Abfrage mit normalem Schlüssel → geschätzt: „aufgeladen“ minus seitdem verbraucht
//   (die Zentrale zählt die Kosten ihrer Aufrufe mit). Zusätzlich: Fehlermeldungen „kein Guthaben“ lösen sofort eine Warnung aus.
import { db, saveNow } from './store.js';

const API = process.env.FAL_API_BASE || 'https://api.fal.ai';
export const PROVIDERS = { fal: 'fal.ai (Bilder, Musik, Sounds)', claude: 'Claude (Anthropic)' };
export const BILLING_URL = { fal: 'https://fal.ai/dashboard/billing', claude: 'https://console.anthropic.com/settings/billing' };
const cfg = () => (db().credits ||= { fal: {}, claude: {}, alerts: {}, live: {} });

// Bisher verbraucht (von der Zentrale mitgezählt, US-$)
export function spent(p) {
  const d = db();
  if (p === 'claude') return d.ai?.spent || 0;
  // fal: Musik + Sounds genau; Bilder grob (KI-Bild ca. 0,04 $, Freistellen ca. 0,01 $)
  return (d.music?.spent || 0) + (d.sfx?.spent || 0) + (d.fal?.generated || 0) * 0.04 + (d.fal?.count || 0) * 0.01;
}

// Fehler eines Dienstes melden (z. B. „Guthaben aufgebraucht“) → Warnung oben in der Zentrale
export function flag(p, msg) {
  const c = cfg();
  c.alerts[p] = { at: new Date().toISOString(), msg: String(msg || 'Guthaben aufgebraucht').slice(0, 300) };
  saveNow();
}
export function clear(p) { const c = cfg(); delete c.alerts[p]; saveNow(); }

// fal-Antwort prüfen: Guthaben leer / Konto gesperrt → Warnung + verständlicher Fehler, sonst null
export function falError(status, body) {
  if (!(status >= 400)) return null;
  const t = JSON.stringify(body || {});
  if (status === 402 || /exhausted balance|insufficient|balance|credit|locked/i.test(t)) {
    flag('fal', 'fal.ai: Guthaben aufgebraucht bzw. Konto gesperrt.');
    return 'fal.ai: kein Guthaben mehr – unter fal.ai/dashboard/billing aufladen.';
  }
  if (status === 401 || status === 403) return 'fal.ai-Schlüssel ungültig.';
  return null;
}

// Aufladung eintragen: Betrag in $ (ab jetzt wird der Verbrauch abgezogen), Warnschwelle in $
export function configure(b) {
  const c = cfg();
  if (typeof b.falReadKey === 'string' && b.falReadKey.trim()) c.falReadKey = b.falReadKey.trim();
  if (b.removeFalReadKey === true) delete c.falReadKey;
  for (const p of Object.keys(PROVIDERS)) {
    const x = b[p];
    if (!x) continue;
    const s = (c[p] ||= {});
    if (x.topup != null && x.topup !== '' && !isNaN(x.topup)) {
      s.topup = Math.max(0, Number(x.topup)); s.at = new Date().toISOString(); s.spentAt = spent(p);
      delete c.alerts[p];
    }
    if (x.topup === null) { delete s.topup; delete s.at; delete s.spentAt; }
    if (x.warnBelow != null && !isNaN(x.warnBelow)) s.warnBelow = Math.max(0, Number(x.warnBelow));
  }
  saveNow();
  return status();
}

// echtes fal-Guthaben abfragen (wenn der Schlüssel darf)
export async function checkFal() {
  const c = cfg();
  const key = c.falReadKey || db().fal?.key;   // eigener Nur-Lese-Schlüssel (optional) oder der normale
  if (!key) { c.live.fal = null; return null; }
  try {
    const r = await fetch(`${API}/v1/account/billing?expand=credits`, { headers: { Authorization: 'Key ' + key }, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      c.live.fal = { at: new Date().toISOString(), error: r.status === 401 || r.status === 403
        ? 'Schlüssel darf das Guthaben nicht abfragen – bei fal.ai einen zusätzlichen Schlüssel mit „Read only“ anlegen und hier eintragen (geschätzt wird trotzdem).'
        : (j.error?.message || 'Abfrage fehlgeschlagen (' + r.status + ')') };
    } else {
      // Feldnamen defensiv: credits.{current_balance|balance|amount|...}
      const cr = j.credits || j;
      const num = [cr.current_balance, cr.balance, cr.available, cr.amount, cr.remaining].map(Number).find((x) => Number.isFinite(x));
      c.live.fal = Number.isFinite(num) ? { at: new Date().toISOString(), balance: Math.round(num * 100) / 100, currency: cr.currency || 'USD' }
        : { at: new Date().toISOString(), error: 'Antwort ohne Guthaben-Angabe.' };
      if (Number.isFinite(num) && num > (c.fal?.warnBelow ?? 3)) delete c.alerts.fal;
    }
  } catch (e) { c.live.fal = { at: new Date().toISOString(), error: 'nicht erreichbar: ' + e.message }; }
  saveNow();
  return c.live.fal;
}

// Stand je Dienst + Warnungen
export function status() {
  const c = cfg();
  const out = {};
  const warnings = [];
  for (const [p, name] of Object.entries(PROVIDERS)) {
    const s = c[p] || {};
    const warnBelow = s.warnBelow ?? (p === 'fal' ? 3 : 2);
    const used = spent(p);
    const est = Number.isFinite(s.topup) ? Math.round((s.topup - (used - (s.spentAt || 0))) * 100) / 100 : null;
    const live = p === 'fal' ? c.live?.fal || null : null;
    const remaining = Number.isFinite(live?.balance) ? live.balance : est;
    const alert = c.alerts?.[p] || null;
    const low = remaining !== null && remaining <= warnBelow;
    out[p] = { name, topup: s.topup ?? null, at: s.at || '', warnBelow, used: Math.round(used * 100) / 100, estimate: est, live, remaining, low, alert, url: BILLING_URL[p],
      configured: p === 'fal' ? !!db().fal?.key : !!db().ai?.apiKey };
    if (alert) warnings.push({ provider: p, level: 'bad', text: `${name}: ${alert.msg}`, url: BILLING_URL[p] });
    else if (low && out[p].configured) warnings.push({ provider: p, level: 'warn', text: `${name}: Guthaben fast aufgebraucht – noch ${live?.balance != null ? '' : 'ca. '}${remaining.toFixed(2).replace('.', ',')} $`, url: BILLING_URL[p] });
  }
  return { ...out, warnings, falReadKey: !!c.falReadKey };
}

export function init() {
  cfg();
  const tick = () => { if (db().fal?.key) checkFal().catch(() => {}); };
  setTimeout(tick, 30_000);
  setInterval(tick, 6 * 3600_000).unref();
}
