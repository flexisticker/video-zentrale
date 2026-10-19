// Statistik-Zentrale: echte Zahlen je hochgeladenem Video (YouTube, TikTok, Twitch) – und daraus lernen.
//  - YouTube: Aufrufe/Likes/Kommentare (normales Recht); optional Analytics: durchschnittlich angesehener Anteil (Recht yt-analytics.readonly)
//  - TikTok: Aufrufe/Likes/Kommentare/Shares (Display API, Recht video.list – nur wenn in der TikTok-App freigegeben)
//  - Twitch: Zuschauer-Clips und VOD-Aufrufe je Stream (twitch.js)
// Bewertung relativ zum eigenen Kanal (Aufrufe ÷ Median der letzten Videos) – nicht gegen fremde Richtwerte.
// examples(profile) liefert Claude die eigenen Top-/Flop-Clips als Beispiele für den nächsten Schnitt.
import { db, save, saveNow } from './store.js';
import * as profiles from './profiles.js';
import * as youtube from './youtube.js';
import * as tiktok from './tiktok.js';
import * as twitch from './twitch.js';
import * as ai from './ai.js';

const cfg = () => {
  const d = db();
  if (!d.stats) d.stats = {};
  d.stats.enabled ??= true; d.stats.days ??= 120; d.stats.errors ??= {}; d.stats.lastRun ??= '';
  return d.stats;
};

export function configure(b) {
  const c = cfg();
  if (typeof b.enabled === 'boolean') c.enabled = b.enabled;
  if (typeof b.ytAnalytics === 'boolean') db().youtube.analytics = b.ytAnalytics;
  if (typeof b.ttList === 'boolean') db().tiktok.statsList = b.ttList;
  saveNow();
}

const uploadedAt = (v, k) => Date.parse(v[k]?.at || v[k]?.history?.at?.(-1)?.at || '') || 0;
const ytIds = (v) => [...new Set([v.yt?.id, ...(v.yt?.history || []).map((h) => h.id)].filter(Boolean))];

function push(v, k, data) {
  const prev = v.perf?.[k] || {};
  const hist = [...(prev.history || []), { at: new Date().toISOString(), views: data.views }].slice(-40);
  v.perf = { ...(v.perf || {}), [k]: { ...prev, ...data, at: new Date().toISOString(), history: hist } };
}

let running = null;
export function refreshAll(force = false) {
  if (!running) running = doRefresh(force).finally(() => { running = null; });
  return running;
}

async function doRefresh(force) {
  const c = cfg();
  if (!c.enabled && !force) return;
  const since = Date.now() - c.days * 86400_000;
  const vids = Object.values(db().videos).filter((v) => !v.missing);
  c.errors = {};
  // YouTube je Kanal
  for (const p of profiles.list ? profiles.list() : db().profiles) {
    if (!p.youtube?.refreshToken) continue;
    const mine = vids.filter((v) => v.yt?.id && v.yt.profileId === p.id && (uploadedAt(v, 'yt') >= since || force));
    if (!mine.length) continue;
    try {
      const ids = [...new Set(mine.flatMap(ytIds))];
      const st = await youtube.videoStats(p, ids);
      let ana = {};
      if (db().youtube.analytics) {
        const first = new Date(Math.min(...mine.map((v) => uploadedAt(v, 'yt') || Date.now())) - 86400_000).toISOString().slice(0, 10);
        try { ana = await youtube.videoAnalytics(p, ids, first); } catch (e) { c.errors['yt-analytics-' + p.id] = e.message; }
      }
      for (const v of mine) {
        const x = st[v.yt.id];
        if (x) push(v, 'yt', { ...x, ...(ana[v.yt.id] || {}), id: v.yt.id });
      }
    } catch (e) { c.errors['yt-' + p.id] = e.message; }
  }
  // TikTok je Kanal (nur mit freigegebenem Recht video.list): Zuordnung über Zeit + Länge + Text
  if (db().tiktok.statsList) {
    for (const p of db().profiles) {
      if (!p.tiktok?.refreshToken) continue;
      const mine = vids.filter((v) => v.tt?.state === 'done' && v.tt.profileId === p.id);
      if (!mine.length) continue;
      try {
        const list = await tiktok.listVideos(p);
        const used = new Set();
        for (const v of mine) {
          let best = null, bestScore = 0;
          const up = uploadedAt(v, 'tt');
          for (const x of list) {
            if (used.has(x.id)) continue;
            if (v.perf?.tt?.id && v.perf.tt.id !== x.id) continue;
            const t = (x.create_time || 0) * 1000;
            if (!v.perf?.tt?.id && (t < up - 3600_000 || t > up + 30 * 86400_000)) continue;
            let sc = v.perf?.tt?.id === x.id ? 10 : 1;
            if (v.duration && Math.abs((x.duration || 0) - v.duration) <= 2) sc += 2;
            const text = `${x.title || ''} ${x.video_description || ''}`.toLowerCase();
            const words = String(v.tiktok || v.title || '').toLowerCase().split(/\s+/).filter((w) => w.length > 4);
            sc += Math.min(3, words.filter((w) => text.includes(w)).length * 0.5);
            if (sc > bestScore) { best = x; bestScore = sc; }
          }
          if (best && bestScore >= 2.5) {
            used.add(best.id);
            push(v, 'tt', { id: best.id, views: best.view_count || 0, likes: best.like_count || 0, comments: best.comment_count || 0, shares: best.share_count || 0, url: best.share_url || '' });
          }
        }
      } catch (e) { c.errors['tt-' + p.id] = e.message; }
    }
  }
  // Twitch: VODs + Clip-Aufrufe aktualisieren
  if (twitch.status().connected) { try { await twitch.syncVideos(); } catch (e) { c.errors.twitch = e.message; } }
  c.lastRun = new Date().toISOString();
  saveNow();
}

// Erfolg relativ zum Kanal: Aufrufe ÷ Median der Aufrufe der letzten Videos desselben Kanals/derselben Plattform
function scored(profileId) {
  const vids = Object.values(db().videos).filter((v) => !v.missing && (v.perf?.yt || v.perf?.tt) && (profiles.effective(v)?.id === profileId));
  const med = (k) => { const a = vids.map((v) => v.perf?.[k]?.views).filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return a.length ? Math.max(1, a[Math.floor(a.length / 2)]) : 0; };
  const m = { yt: med('yt'), tt: med('tt') };
  return vids.map((v) => {
    const r = ['yt', 'tt'].filter((k) => m[k] && Number.isFinite(v.perf?.[k]?.views)).map((k) => v.perf[k].views / m[k]);
    const rel = r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
    return { v, rel, views: (v.perf?.yt?.views || 0) + (v.perf?.tt?.views || 0), pct: v.perf?.yt?.avgPercent || null };
  }).filter((x) => x.rel != null);
}

const desc = (x) => {
  const v = x.v, e = v.edit || {};
  const bits = [`„${String(v.title || v.file).slice(0, 70)}“`, `${Math.round(v.duration || 0)} s`, `${x.rel.toFixed(1)}× dein Durchschnitt`];
  if (x.pct) bits.push(`${Math.round(x.pct)} % angesehen`);
  if (e.hook?.mode && e.hook.mode !== 'none') bits.push(`Hook ${e.hook.mode}${e.hook.text ? ` „${e.hook.text}“` : ''}`);
  if (e.layout?.mode) bits.push(`Bild ${e.layout.mode}`);
  if (e.fxHow) bits.push(e.fxHow.replace(/^Effekte: /, 'Effekte '));
  if (v.transcriptText) bits.push(`Inhalt: ${v.transcriptText.slice(0, 140)}`);
  return '- ' + bits.join(' · ');
};

// Text für Claude: was beim Publikum dieses Kanals wirklich lief (ab 6 Videos mit Zahlen)
export function examples(profile) {
  if (!profile?.id) return '';
  const list = scored(profile.id).filter((x) => x.v.source?.kind === 'short' || (x.v.duration || 0) <= 180);
  if (list.length < 6) return '';
  list.sort((a, b) => b.rel - a.rel);
  const top = list.slice(0, 5), flop = list.slice(-4).reverse();
  return ['ECHTE ZAHLEN dieses Kanals (lerne daraus, kopiere nicht stumpf):', 'Lief am besten:', ...top.map(desc), 'Lief am schwächsten:', ...flop.map(desc)].join('\n');
}

export function overview() {
  const c = cfg();
  const channels = db().profiles.map((p) => {
    const list = scored(p.id).sort((a, b) => b.rel - a.rel);
    const row = (x) => ({ id: x.v.id, title: x.v.title || x.v.file, file: x.v.file, rel: Math.round(x.rel * 100) / 100, views: x.views, pct: x.pct,
      yt: x.v.perf?.yt || null, tt: x.v.perf?.tt || null, viral: x.v.viral?.score || null, duration: x.v.duration || 0, kind: x.v.source?.kind || '' });
    // Wie gut trifft Claudes Viral-Einschätzung die echten Zahlen? (Rangkorrelation)
    const pairs = list.filter((x) => x.v.viral?.score);
    let corr = null;
    if (pairs.length >= 8) {
      const rank = (arr) => { const s = arr.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(arr.length); s.forEach(([, i], k) => { r[i] = k; }); return r; };
      const a = rank(pairs.map((x) => x.v.viral.score)), b = rank(pairs.map((x) => x.rel));
      const n = pairs.length; const d2 = a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);
      corr = Math.round((1 - 6 * d2 / (n * (n * n - 1))) * 100) / 100;
    }
    return { id: p.id, name: p.name, color: p.color, count: list.length, top: list.slice(0, 10).map(row), flop: list.slice(-10).reverse().map(row), corr };
  });
  const tw = twitch.status();
  return { enabled: c.enabled, lastRun: c.lastRun, running: !!running, errors: c.errors, ytAnalytics: !!db().youtube.analytics, ttList: !!db().tiktok.statsList,
    channels, twitch: tw.connected ? { user: tw.user, streams: tw.streams } : null };
}

export function init() {
  ai.setExamples(examples);
  setTimeout(() => refreshAll().catch((e) => console.error('Statistik:', e.message)), 60_000).unref?.();
  setInterval(() => refreshAll().catch((e) => console.error('Statistik:', e.message)), 6 * 3600_000).unref?.();
}
