import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Nachbau der Google-/YouTube- und TikTok-Schnittstellen für lokale Tests.
import http from 'node:http';
const log = [];
let tokenCalls = 0, ytFailOnce = true, devN = 0, falLast = null;
const YT_NAMES = { 'dev1': 'MichaModus', 'dev2': '3D by Micha' };
const yt = { size: 0, got: 0 }, tt = { size: 0, got: 0, chunks: 0 };
// Hänger nachstellen: MOCK_STALL_AT=<Byte> → das Stück, das diesen Byte enthält, wird einmal angenommen, aber nie beantwortet
let stallAt = process.env.MOCK_STALL_AT ? Number(process.env.MOCK_STALL_AT) : -1;
const stallOnce = (s, e) => { if (stallAt >= s && stallAt <= e) { stallAt = -1; return true; } return false; };
const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const jsonOut = (res, s, j, h = {}) => { res.writeHead(s, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(j)); };
const json = jsonOut;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const b = await body(req);
  const p = u.pathname;
  log.push({ m: req.method, p, range: req.headers['content-range'], len: b.length });
  if (p === '/_log') return json(res, 200, { log, yt, tt });
  if (p === '/logo.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(require('fs').readFileSync(process.env.TEST_LOGO)); }
  // Anmeldefenster: sofort „erlaubt“ und zurück zur Zentrale
  if (p === '/o/oauth2/v2/auth' || p === '/v2/auth/authorize/') {
    const who = u.searchParams.get('client_id') ? 'web' + (++devN) : 'TT' + (++devN);
    res.writeHead(302, { Location: u.searchParams.get('redirect_uri') + '?code=' + who + '&state=' + u.searchParams.get('state') }); return res.end();
  }
  if (p === '/device/code') return json(res, 200, { device_code: 'dev' + (++devN), user_code: 'ABCD-EFGH', verification_url: 'https://www.google.com/device', interval: 1, expires_in: 600 });
  if (p === '/token') {
    const f = new URLSearchParams(b.toString());
    if (f.get('grant_type').includes('device_code')) {
      if (++tokenCalls % 2) return json(res, 428, { error: 'authorization_pending' });
      const d = f.get('device_code');
      return json(res, 200, { access_token: 'at-' + d, refresh_token: 'rt-' + d, expires_in: 3600 });
    }
    if (f.get('grant_type') === 'authorization_code') return json(res, 200, { access_token: 'at-' + f.get('code'), refresh_token: 'rt-' + f.get('code'), expires_in: 3600 });
    return json(res, 200, { access_token: 'at-' + f.get('refresh_token').slice(3), expires_in: 3600 });
  }
  // Twitch (Device Code Flow, Helix)
  if (p === '/oauth2/device') return json(res, 200, { device_code: 'twdev', user_code: 'TWCODE', verification_uri: 'https://www.twitch.tv/activate?device-code=TWCODE', interval: 1, expires_in: 600 });
  if (p === '/oauth2/token') {
    const f = new URLSearchParams(b.toString());
    if (f.get('grant_type').includes('device_code')) { if (++tokenCalls % 2) return json(res, 400, { status: 400, message: 'authorization_pending' }); return json(res, 200, { access_token: 'tw-at', refresh_token: 'tw-rt', expires_in: 14000 }); }
    return json(res, 200, { access_token: 'tw-at', refresh_token: 'tw-rt', expires_in: 14000 });
  }
  if (p.startsWith('/helix/')) {
    log.push({ helix: p + u.search, m: req.method, body: b.length ? JSON.parse(b.toString()) : null });
    if (p === '/helix/users') return json(res, 200, { data: [{ id: '4711', login: 'michamodus', display_name: 'MichaModus' }] });
    if (p === '/helix/streams') return json(res, 200, { data: process.env.MOCK_LIVE ? [{ id: 'live1', started_at: new Date(Date.now() - 60000).toISOString(), title: 'Live-Test', game_name: 'Fortnite' }] : [] });
    if (p === '/helix/eventsub/subscriptions') return json(res, 202, { data: [{ id: 'sub' + Math.random() }] });
    if (p === '/helix/videos') return json(res, 200, { data: [{ id: '555', stream_id: 's555', created_at: process.env.MOCK_VOD_START || '2026-10-18T18:00:00Z', title: 'Fortnite Abend', duration: '3m0s', view_count: 42 }] });
    if (p === '/helix/clips') return json(res, 200, { data: [{ id: 'c1', title: 'Was war DAS', view_count: 120, duration: 20, vod_offset: 95, video_id: '555', created_at: '2026-10-18T18:10:00Z', url: 'https://clips.twitch.tv/c1' }] });
    if (p === '/helix/streams/markers') return json(res, 200, { data: [{ videos: [{ video_id: '555', markers: [{ id: 'm1', created_at: '', description: 'krass', position_seconds: 150 }] }] }] });
    return json(res, 404, { message: 'helix ' + p });
  }
  if (p === '/youtube/v3/videos' && req.method === 'GET') {
    const ids = (u.searchParams.get('id') || '').split(',');
    return json(res, 200, { items: ids.map((id, i) => ({ id, statistics: { viewCount: String(1000 * (i + 1)), likeCount: '10', commentCount: '2' } })) });
  }
  if (p === '/v2/reports') return json(res, 200, { columnHeaders: [{ name: 'video' }, { name: 'views' }, { name: 'averageViewDuration' }, { name: 'averageViewPercentage' }],
    rows: (u.searchParams.get('filters') || '').replace('video==', '').split(',').map((id) => [id, 100, 20, 77.5]) });
  if (p === '/v2/video/list/') return json(res, 200, { data: { videos: [{ id: 'tt1', title: '', video_description: process.env.MOCK_TT_DESC || 'Clutch', create_time: Math.floor(Date.now() / 1000), duration: 25, view_count: 5000, like_count: 300, comment_count: 12, share_count: 40 }], has_more: false }, error: { code: 'ok' } });
  if (p === '/youtube/v3/channels') {
    const d = String(req.headers.authorization).replace('Bearer at-', '');
    return json(res, 200, { items: [{ id: 'UC-' + d, snippet: { title: YT_NAMES[d] || d, thumbnails: { high: { url: 'http://127.0.0.1:9300/logo.png' } } } }] });
  }
  if (p === '/upload/youtube/v3/videos') {
    yt.meta = JSON.parse(b.toString()); yt.auth = req.headers.authorization; yt.size = Number(req.headers['x-upload-content-length']); yt.got = 0;
    res.writeHead(200, { Location: 'http://127.0.0.1:9300/yt-session' }); return res.end();
  }
  if (p === '/yt-session') {
    const cr = req.headers['content-range'];
    if (cr.startsWith('bytes */')) { res.writeHead(308, yt.got ? { Range: `bytes=0-${yt.got - 1}` } : {}); return res.end(); }
    const [, s, e] = /bytes (\d+)-(\d+)/.exec(cr).map(Number);
    if (s > 0 && ytFailOnce) { ytFailOnce = false; return json(res, 503, { error: { message: 'kurz weg' } }); }
    if (s !== yt.got) return json(res, 400, { error: { message: 'falscher Offset ' + s } });
    if (stallOnce(s, e)) { log.push({ stall: 'yt', s }); return; }
    yt.got = e + 1;
    if (yt.got >= yt.size) return json(res, 200, { id: 'vid123', status: { privacyStatus: 'private' } });
    res.writeHead(308, { Range: `bytes=0-${e}` }); return res.end();
  }
  if (p === '/upload/youtube/v3/thumbnails/set') { yt.thumb = { len: b.length, type: req.headers['content-type'] }; return json(res, 200, {}); }
  if (p === '/v2/oauth/token/') {
    const f = new URLSearchParams(b.toString());
    const who = f.get('code') || f.get('refresh_token').slice(3);
    return json(res, 200, { access_token: 'tt-' + who, refresh_token: 'rt-' + who, expires_in: 86400, refresh_expires_in: 31536000, open_id: 'o-' + who });
  }
  if (p === '/v2/user/info/') {
    const who = String(req.headers.authorization).replace('Bearer tt-', '');
    return json(res, 200, { data: { user: { display_name: who, open_id: 'o-' + who } }, error: { code: 'ok' } });
  }
  if (p === '/v2/post/publish/creator_info/query/') {
    return json(res, 200, { data: { creator_avatar_url: '', creator_username: 'michamodus', creator_nickname: 'MichaModus',
      privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'], comment_disabled: false, duet_disabled: true, stitch_disabled: false,
      max_video_post_duration_sec: 600 }, error: { code: 'ok' } });
  }
  if (p === '/v2/post/publish/video/init/') {
    const j = JSON.parse(b.toString()); tt.direct = j.post_info; tt.init = j.source_info; tt.size = j.source_info.video_size; tt.got = 0; tt.chunks = 0;
    return json(res, 200, { data: { publish_id: 'pubD', upload_url: 'http://127.0.0.1:9300/tt-up' }, error: { code: 'ok' } });
  }
  if (p === '/v2/post/publish/inbox/video/init/') {
    const j = JSON.parse(b.toString()); tt.init = j.source_info; tt.auth = req.headers.authorization; tt.size = j.source_info.video_size; tt.got = 0; tt.chunks = 0;
    return json(res, 200, { data: { publish_id: 'pub1', upload_url: 'http://127.0.0.1:9300/tt-up' }, error: { code: 'ok' } });
  }
  if (p === '/tt-up') {
    const [, s, e] = /bytes (\d+)-(\d+)/.exec(req.headers['content-range']).map(Number);
    if (s !== tt.got || b.length !== e - s + 1) return json(res, 400, {});
    if (stallOnce(s, e)) { log.push({ stall: 'tt', s }); return; }
    tt.got = e + 1; tt.chunks++;
    res.writeHead(tt.got >= tt.size ? 201 : 206); return res.end();
  }
  if (p === '/v2/post/publish/status/fetch/') return json(res, 200, { data: { status: tt.got >= tt.size ? 'SEND_TO_USER_INBOX' : 'PROCESSING_UPLOAD' }, error: { code: 'ok' } });
  // fal.ai: Freistellen (liefert Test-Person mit Transparenz) und KI-Aufwertung (liefert das Eingangsbild zurück)
  if (p === '/v1/account/billing') {
    if (req.headers.authorization !== 'Key fal-test') return json(res, 403, { error: { type: 'authorization_error', message: 'no billing permission' } });
    return json(res, 200, { username: 'test', credits: { current_balance: Number(process.env.MOCK_FAL_BALANCE || 1.5), currency: 'USD' } });
  }
  if (p === '/sonilo/v1.1/text-to-sound-effects') {
    if (req.headers.authorization !== 'Key fal-test') return json(res, 401, { detail: 'Unauthorized' });
    const j = JSON.parse(b.toString());
    log.push({ sfx: { prompt: j.prompt, duration: j.duration, format: j.audio_format } });
    const a = { url: 'http://127.0.0.1:9300/falaudio/sfx.m4a', content_type: 'audio/mp4' };
    return json(res, 200, { audio: a, audios: [a] });
  }
  if (p === '/falaudio/sfx.m4a') { res.writeHead(200, { 'Content-Type': 'audio/mp4' }); return res.end(require('fs').readFileSync(process.env.TEST_SFX || process.env.TEST_MUSIC)); }
  if (p === '/fal-ai/nano-banana') {
    if (req.headers.authorization !== 'Key fal-test') return json(res, 401, { detail: 'Unauthorized' });
    log.push({ sticker: { prompt: JSON.parse(b.toString()).prompt.slice(0, 200) } });
    falLast = require('fs').readFileSync(process.env.TEST_PERSON);
    return json(res, 200, { images: [{ url: 'http://127.0.0.1:9300/falimg/last' }], description: '' });
  }
  if (p === '/fal-ai/birefnet' || p.startsWith('/fal-ai/flux') || p === '/fal-ai/nano-banana/edit') {
    if (req.headers.authorization !== 'Key fal-test') return json(res, 401, { detail: 'Unauthorized' });
    const j = JSON.parse(b.toString());
    const imgs = j.image_urls || [j.image_url];
    log.push({ fal: { model: p, prompt: (j.prompt || '').slice(0, 400), imgs: imgs.length, aspect: j.aspect_ratio } });
    falLast = Buffer.from(imgs[imgs.length - 1].split(',')[1], 'base64');
    if (p === '/fal-ai/birefnet') return json(res, 200, { image: { url: 'http://127.0.0.1:9300/falimg/cut.png' } });
    return json(res, 200, { images: [{ url: 'http://127.0.0.1:9300/falimg/last' }] });
  }
  // fal.ai: KI-Musik (Sonilo) → Testton aus TEST_MUSIC
  if (p.startsWith('/sonilo/')) {
    if (req.headers.authorization !== 'Key fal-test') return json(res, 401, { detail: 'Unauthorized' });
    const j = JSON.parse(b.toString());
    log.push({ music: { model: p, prompt: j.prompt, duration: j.duration } });
    const a = { url: 'http://127.0.0.1:9300/falaudio/musik.m4a', content_type: 'audio/mp4' };
    return json(res, 200, { audio: a, audios: [a] });
  }
  if (p === '/falaudio/musik.m4a') { res.writeHead(200, { 'Content-Type': 'audio/mp4' }); return res.end(require('fs').readFileSync(process.env.TEST_MUSIC)); }
  if (p === '/falimg/cut.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(require('fs').readFileSync(process.env.TEST_PERSON)); }
  if (p === '/falimg/last') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(falLast); }
  if (p.startsWith('/whisper/')) { res.writeHead(200, { 'Content-Length': 2048 }); return res.end(Buffer.alloc(2048)); }
  if (p === '/v1/messages') {
    const j = JSON.parse(b.toString());
    // stream: true → dieselbe Antwort als Server-Sent Events (wie die echte API)
    const json = !j.stream ? jsonOut : (res2, st, m) => {
      if (st !== 200) return jsonOut(res2, st, m);
      log.push({ stream: true, effort: j.output_config?.effort, maxTokens: j.max_tokens });
      res2.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ev = (type, data) => res2.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { ...m, content: [], stop_reason: null, usage: { input_tokens: m.usage.input_tokens, output_tokens: 1 } } });
      m.content.forEach((c, i) => {
        ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
        ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: c.text } });
        ev('content_block_stop', { index: i });
      });
      ev('message_delta', { delta: { stop_reason: m.stop_reason, stop_sequence: null }, usage: { output_tokens: m.usage.output_tokens } });
      ev('message_stop', {});
      res2.end();
    };
    if (j.output_config?.format?.schema?.properties?.items) {
      const ids = j.output_config.format.schema.properties.items.items.properties.id.enum;
      const txt = JSON.stringify(j.messages[0].content);
      log.push({ topics: ids.length, images: j.messages[0].content.filter((c) => c.type === 'image').length });
      const out = { items: ids.map((id) => { const m = new RegExp('\\[' + id + '\\][^\\[]*').exec(txt)?.[0] || '';
        return { id, game: /minecraft/i.test(m) ? 'Minecraft' : /fortnite/i.test(m) ? 'Fortnite' : /druck/i.test(m) ? '3D-Druck' : '' }; }) };
      return json(res, 200, { id: 'msg_t', type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 2000, output_tokens: 200 } });
    }
    if (j.output_config?.format?.schema?.properties?.tagline) {
      const t = j.messages[0].content[0].text;
      const ms = [...t.matchAll(/^Moment (\d+): .*Sekunde ([\d.]+)–([\d.]+)/gm)].map((m) => ({ n: +m[1], a: +m[2], b: +m[3] }));
      log.push({ trailer: { moments: ms.length, target: /Ziel-Länge: (\d+)/.exec(t)?.[1], wish: /WUNSCH DES CREATORS: „([^“]*)“/.exec(t)?.[1] || '' } });
      const out = { title: 'MichaModus – Best of', tagline: 'Rage, Lacher und Clutches', outro: 'Jetzt abonnieren!',
        moments: ms.map((m, i) => ({ moment: m.n, fromSentence: 0, toSentence: 0, start: m.a + 1, end: Math.min(m.b, m.a + 7), text: i === 0 ? 'Was war DAS?!' : '' })) };
      return json(res, 200, { id: 'msg_tr', type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 8000, output_tokens: 400 } });
    }
    if (j.output_config?.format?.schema?.properties?.moments) {
      const t = j.messages[0].content[0].text;
      const sents = [...t.matchAll(/^S(\d+) \[([\d.]+)–([\d.]+)\](?: \(([^)]*)\))?/gm)].map((m) => ({ id: +m[1], s: +m[2], e: +m[3], tag: m[4] || '' }));
      const tagged = sents.filter((x) => x.tag);
      log.push({ scout: { sents: sents.length, tagged: tagged.length, tags: tagged.slice(0, 5).map((x) => x.tag), twitch: /Zuschauer-Clip|Chat:/.test(t), examples: /ECHTE ZAHLEN/.test(t), effort: j.output_config.effort } });
      const pick = (tagged.length ? tagged : sents).slice(0, 3).map((x) => ({ fromSentence: Math.max(1, x.id - 1), toSentence: x.id + 1, why: 'Ausraster mit Lachen' }));
      return json(res, 200, { id: 'msg_m', type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ moments: pick }) }], usage: { input_tokens: 30000, output_tokens: 300 } });
    }
    if (j.output_config?.format?.schema?.properties?.fixWish) {
      log.push({ qc: { imgs: j.messages[0].content.filter((c) => c.type === 'image').length, effort: j.output_config.effort, text: j.messages[0].content[0].text.slice(0, 300) } });
      const out = process.env.MOCK_QC_BAD ? { ok: false, score: 5, issues: ['Hook-Text verdeckt das Spiel-HUD'], fixWish: 'Hook-Text kürzer, Ausschnitt weiter nach links' } : { ok: true, score: 8, issues: [], fixWish: '' };
      return json(res, 200, { id: 'msg_q', type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 2000, output_tokens: 100 } });
    }
    if (j.output_config?.format?.schema?.properties?.ideas) {
      log.push({ coach: j.messages[0].content.slice(0, 300) });
      const out = { summary: 'Viele starke Reaktionen, aber oft langsamer Einstieg.', strengths: ['Echte Reaktionen', 'Klare Highlights'],
        tips: [{ title: 'Mit der Reaktion starten', text: 'Beginne Shorts mit deinem Ausruf statt mit der Vorgeschichte.' },
          { title: 'Ziel ansagen', text: 'Sag am Anfang, was du vorhast – dann bleiben Zuschauer bis zur Auflösung.' }],
        ideas: ['Top 5 Rage-Momente der Woche', 'Erster Eindruck: neues WoW in 60 Sekunden'] };
      return json(res, 200, { id: 'msg_c', type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 3000, output_tokens: 600 } });
    }
    if (j.output_config?.format?.schema?.properties?.parts) {
      const texts = j.messages[0].content.filter((c) => c.type === 'text').map((c) => c.text);
      const parts = texts.filter((t) => t.startsWith('Baustein')).map((t, i) => { const m = /Sekunde ([\d.]+)–([\d.]+)/.exec(t); const st = /Sätze S(\d+)–S(\d+)/.exec(t);
        return { part: i + 1, fromSentence: st ? +st[1] : 0, toSentence: st ? +st[2] : 0, start: +m[1], end: +m[2] }; });
      log.push({ summary: { parts: parts.length, wish: /Wunsch des Creators: „([^“]*)“/.exec(texts[0])?.[1] || '' } });
      return json(res, 200, { id: 'msg_s', type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ parts: parts.slice(0, 4) }) }], usage: { input_tokens: 9000, output_tokens: 300 } });
    }
    if (j.output_config?.format?.schema?.properties?.segments) {
      const t0 = j.messages[0].content[0].text;
      const dur = Number(/Länge [\d:]+ \((\d+) s\)/.exec(t0)?.[1] || 120);
      const wish = /WUNSCH DES CREATORS: „([^“]*)“/.exec(t0)?.[1] || '';
      log.push({ reviseLong: { wish, imgs: j.messages[0].content.filter((c) => c.type === 'image').length, said: /Gesprochenes \(Sekunden/.test(t0), peaks: /Lauteste Stellen/.test(t0), dur } });
      const out = { segments: [{ start: 20, end: 60 }, { start: 80, end: 115 }, { start: 58, end: 70 }], teaser: { use: true, at: 100, len: 5, text: 'Das Finale eskaliert' },
        tempo: 'normal', music: /mit musik/i.test(wish), title: 'Langfassung – kompakt', changes: 'Intro raus, zwei starke Abschnitte, Teaser vorne – neue Länge ca. 1:20.' };
      return json(res, 200, { id: 'msg_rl', type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 20000, output_tokens: 400 } });
    }
    if (j.output_config?.format?.schema?.properties?.changes) {
      const t0 = j.messages[0].content[0].text;
      const m = /Bisheriger Clip: Sekunde ([\d.]+)–([\d.]+)/.exec(t0);
      const wish = /WUNSCH DES CREATORS: „([^“]*)“/.exec(t0)?.[1] || '';
      log.push({ revise: { wish, imgs: j.messages[0].content.filter((c) => c.type === 'image').length, said: /Gesprochenes in diesem Bereich/.test(t0) } });
      const a = Number(m[1]), b2 = Number(m[2]);
      const out = { start: a + 2, end: b2 - 6, title: 'Neue Fassung 🔥', hook: { mode: 'preview', at: b2 - 12, len: 2.5, text: 'Achtung, gleich knallt es' },
        tempo: 'schnell', music: !/ohne musik/i.test(wish), changes: 'Ich steige jetzt mit dem Knall ein und habe den Leerlauf am Ende gekürzt.',
        viral: 8, viralWhy: 'Stärkerer Einstieg.', viralTip: 'Titel als Frage formulieren.',
        layout: { mode: 'cam', camX: 70, camY: 4, camW: 28, camH: 28, focus: 35 },
        fx: [{ at: a + 6, kind: 'cam', emoji: '', sound: '', soundIdea: '', text: '', pos: 'mitte', sticker: '' }] };
      log.push({ reviseExtra: { layoutRules: /BILDAUFBAU/.test(t0), prevLayout: /Bisheriger Bildaufbau/.test(t0), tone: /\((laut|LACHEN|schnell)/.test(t0) } });
      return json(res, 200, { id: 'msg_r', type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 6000, output_tokens: 300 } });
    }
    if (j.output_config?.format?.schema?.properties?.shorts) {
      const wish = /Wunsch des Creators für diesen Schnitt: „([^“]*)“/.exec(j.messages[0].content[0].text)?.[1];
      if (wish) log.push({ hlWish: wish });
      const texts = j.messages[0].content.filter((c) => c.type === 'text').map((c) => c.text);
      log.push({ highlights: { imgs: j.messages[0].content.filter((c) => c.type === 'image').length, cands: texts.filter((t) => t.startsWith('Kandidat')), layoutRules: /BILDAUFBAU/.test(texts[0]) } });
      const sec = texts.filter((t) => t.startsWith('Kandidat')).map((t) => /Sekunde (\d+)–(\d+)/.exec(t)).map((m) => [Number(m[1]), Number(m[2])]);
      const clipHints = /Worauf der Creator bei diesem Kanal Wert legt: ([^\n]*)/.exec(texts[0])?.[1] || '';
      if (clipHints) log.push({ clipHints: clipHints.slice(0, 60) });
      const sentOf = (t) => [...t.matchAll(/^S(\d+) \[([\d.]+)–([\d.]+)\]/gm)].map((m) => ({ id: Number(m[1]), s: Number(m[2]), e: Number(m[3]) }));
      const cs = texts.filter((t) => t.startsWith('Kandidat')).map(sentOf);
      log.push({ sentenceRules: /SAUBERE SCHNITTE/.test(texts[0]), sentLines: cs.map((x) => x.length) });
      const pick = sec.slice(0, 2).map(([a, b2], i) => ({ candidate: i + 1, start: a + 1, end: b2 - 2,
        ...(i === 0 && cs[0]?.length > 2 ? { fromSentence: cs[0].find((x) => x.s >= a)?.id || cs[0][0].id, toSentence: [...cs[0]].reverse().find((x) => x.e <= b2)?.id || cs[0][cs[0].length - 1].id } : { fromSentence: 0, toSentence: 0 }), title: i ? 'Der Sieg 🏆' : 'Drei auf einmal?!', reason: 'lauter Moment mit Reaktion',
        mood: i ? 'episch' : 'lustig', music: i ? 'epic orchestral hybrid with big drums' : 'quirky playful pizzicato',
        viral: i ? 6 : 9, viralWhy: i ? 'Solider Sieg-Moment, aber bekannter Ablauf.' : 'Lauter Ausraster mit Pointe – hoher Teilwert.', viralTip: 'Mit dem Ausruf direkt einsteigen.',
        hook: { mode: i ? 'cold' : 'preview', at: a + 1 + Math.round((b2 - a - 3) * 0.7), len: 2, text: i ? 'Das gibt es nicht!' : 'Wie konnte das passieren?' },
        layout: i ? { mode: 'blur', camX: 0, camY: 0, camW: 0, camH: 0, focus: 50 } : { mode: 'cam', camX: 70, camY: 4, camW: 28, camH: 28, focus: 40 },
        fx: i ? [
          { at: a + 5, kind: 'punch', emoji: '', sound: '', soundIdea: '', text: '', pos: 'mitte', sticker: '' },
          { at: a + 9, kind: 'flash', emoji: '', sound: 'boom', soundIdea: '', text: '', pos: 'mitte', sticker: '' },
          { at: a + 12, kind: 'emoji', emoji: '😂', sound: '', soundIdea: '', text: '', pos: 'links-oben', sticker: '' },
        ] : [
          { at: a + 4, kind: 'emoji', emoji: '😱', sound: '', soundIdea: '', text: '', pos: 'rechts-oben', sticker: '' },
          { at: a + 6, kind: 'cam', emoji: '', sound: '', soundIdea: '', text: '', pos: 'mitte', sticker: '' },
          { at: a + 8, kind: 'freeze', emoji: '', sound: '', soundIdea: '', text: 'Warte …', pos: 'mitte', sticker: '' },
          { at: a + 13, kind: 'replay', emoji: '', sound: '', soundIdea: '', text: 'Nochmal!', pos: 'mitte', sticker: '' },
          { at: a + 17, kind: 'shake', emoji: '', sound: 'hit', soundIdea: '', text: '', pos: 'mitte', sticker: '' },
          { at: a + 20, kind: 'sticker', emoji: '', sound: '', soundIdea: '', text: '', pos: 'rechts-unten', sticker: 'the person screaming in panic' },
          { at: a + 24, kind: 'sound', emoji: '', sound: '', soundIdea: 'retro laser zap', text: '', pos: 'mitte', sticker: '' },
        ] }));
      log.push({ fxRules: /Effekt-Regisseur/.test(texts[0]), emojis: /Emojis \(nur diese\)/.test(texts[0]) });
      log.push({ hookRules: /Hook \(die ersten/.test(texts[0]) });
      return json(res, 200, { id: 'msg_h', type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ shorts: pick }) }], usage: { input_tokens: 9000, output_tokens: 400 } });
    }
    const imgs = j.messages[0].content.filter((c) => c.type === 'image').length;
    log.push({ claude: { model: j.model, imgs, fallbacks: j.fallbacks, beta: req.headers['anthropic-beta'], key: req.headers['x-api-key'],
      effort: j.output_config?.effort, schema: Object.keys(j.output_config?.format?.schema?.properties || {}), channels: j.output_config?.format?.schema?.properties?.channel?.enum } });
    if (req.headers['x-api-key'] !== 'sk-ant-test') return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    const text = j.messages[0].content[0].text;
    const filament = /Dateiname: .*filament/i.test(text);
    const out = filament
      ? { summary: 'Testdruck mit PETG auf dem A1.', game: 'Bambu Lab A1', channel: '3dbymicha', channelReason: 'Es geht um 3D-Druck mit PETG.',
          titles: ['PETG auf dem Bambu A1 – so klappt der erste Druck', 'Neues Filament im Test: PETG', 'PETG vs. PLA – mein Ergebnis'],
          description: 'Heute teste ich neues PETG-Filament auf dem Bambu Lab A1.\n\nWas taugt es?', tags: ['3d-druck', 'petg', 'bambu lab', 'filament'],
          tiktok: 'PETG-Test auf dem A1 – Ergebnis? 👀 #3ddruck #bambulab #petg', thumbnailFrame: 4, thumbnailText: 'PETG TEST',
          thumbs: [{ frame: 4, photo: 'zeigend', text: 'PETG im Test', side: 'right' }, { frame: 2, photo: 'schockiert', text: 'Das hält?!', side: 'left' }, { frame: 5, photo: '', text: 'Ergebnis', side: 'right' }] }
      : { summary: 'Clutch-Szene im Shooter.', game: 'Fortnite', channel: 'michamodus', channelReason: 'Gameplay-Highlight.',
          titles: ['1v3 Clutch in letzter Sekunde 😱', 'Die krasseste Runde der Woche', 'Fortnite: Clutch mit 1 HP'],
          description: 'Diese Runde war wild.\n\nSchreib in die Kommentare, wie du gespielt hättest!', tags: ['fortnite', 'clutch', 'gaming', 'deutsch'],
          tiktok: '1 HP, 3 Gegner, 0 Plan 😅 #fortnite #clutch #gaming', thumbnailFrame: 2, thumbnailText: '1 HP CLUTCH',
          viral: { score: 7, why: 'Knappe Clutch-Situation mit starker Reaktion.', tip: 'Titel mit „1 HP“ beginnen.',
            hook: 'Direkt mit dem letzten Schuss einsteigen.', edit: 'Die 10 s Laufweg am Anfang raus.', packaging: 'Titelbild: Gesicht + „1 HP“ groß.', nextTime: 'Sag laut, wie viel Leben du noch hast.' },
          aiThumb: { frame: 2, photo: 'schockiert', text: '1 HP Clutch', scene: 'The shocked streamer leans in from the right, the game fight explodes behind him in the left half, text top left.' },
          thumbs: [{ frame: 2, photo: 'schockiert', text: '1 HP?!', side: 'right' }, { frame: 4, photo: 'jubelnd', text: 'Clutch des Jahres', side: 'left' }, { frame: 5, photo: '', text: 'Wie?!', side: 'right' }] };
    return json(res, 200, { id: 'msg_1', type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 7000, output_tokens: 900 } });
  }
  json(res, 404, { error: 'mock 404 ' + p });
});
// Twitch EventSub-WebSocket (nur Server → Client): Willkommen, stream.online, Chat-Ausbruch
const crypto = require('crypto');
const frame = (str) => { const d = Buffer.from(str); const h = d.length < 126 ? Buffer.from([0x81, d.length]) : Buffer.from([0x81, 126, d.length >> 8, d.length & 255]); return Buffer.concat([h, d]); };
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  log.push({ ws: req.url });
  const send = (type, payload, sub) => sock.write(frame(JSON.stringify({ metadata: { message_type: type, ...(sub ? { subscription_type: sub } : {}) }, payload })));
  send('session_welcome', { session: { id: 'sess1', keepalive_timeout_seconds: 10 } });
  let n = 0;
  const iv = setInterval(() => {
    n++;
    if (n === 2) send('notification', { event: { id: 'live1', started_at: new Date(Date.now() - 60000).toISOString() } }, 'stream.online');
    else if (n > 2 && n < 30) send('notification', { event: { message: { text: n % 3 ? 'KEKW KEKW' : 'was war das', fragments: [{ type: 'emote', text: 'KEKW' }] }, chatter_user_login: 'zuschauer' + n } }, 'channel.chat.message');
    else send('session_keepalive', {});
  }, 150);
  sock.on('close', () => clearInterval(iv)); sock.on('error', () => clearInterval(iv));
});
server.listen(9300, () => console.log('mock 9300'));
