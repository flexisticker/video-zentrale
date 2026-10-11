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
const json = (res, s, j, h = {}) => { res.writeHead(s, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(j)); };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const b = await body(req);
  const p = u.pathname;
  log.push({ m: req.method, p, range: req.headers['content-range'], len: b.length });
  if (p === '/_log') return json(res, 200, { log, yt, tt });
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
  if (p === '/youtube/v3/channels') {
    const d = String(req.headers.authorization).replace('Bearer at-', '');
    return json(res, 200, { items: [{ id: 'UC-' + d, snippet: { title: YT_NAMES[d] || d } }] });
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
      const parts = texts.filter((t) => t.startsWith('Baustein')).map((t, i) => { const m = /Sekunde (\d+)–(\d+)/.exec(t); return { part: i + 1, start: +m[1], end: +m[2] }; });
      log.push({ summary: { parts: parts.length, wish: /Wunsch des Creators: „([^“]*)“/.exec(texts[0])?.[1] || '' } });
      return json(res, 200, { id: 'msg_s', type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ parts: parts.slice(0, 4) }) }], usage: { input_tokens: 9000, output_tokens: 300 } });
    }
    if (j.output_config?.format?.schema?.properties?.shorts) {
      const wish = /Wunsch des Creators für diesen Schnitt: „([^“]*)“/.exec(j.messages[0].content[0].text)?.[1];
      if (wish) log.push({ hlWish: wish });
      const texts = j.messages[0].content.filter((c) => c.type === 'text').map((c) => c.text);
      log.push({ highlights: { imgs: j.messages[0].content.filter((c) => c.type === 'image').length, cands: texts.filter((t) => t.startsWith('Kandidat')) } });
      const sec = texts.filter((t) => t.startsWith('Kandidat')).map((t) => /Sekunde (\d+)–(\d+)/.exec(t)).map((m) => [Number(m[1]), Number(m[2])]);
      const clipHints = /Worauf der Creator bei diesem Kanal Wert legt: ([^\n]*)/.exec(texts[0])?.[1] || '';
      if (clipHints) log.push({ clipHints: clipHints.slice(0, 60) });
      const pick = sec.slice(0, 2).map(([a, b2], i) => ({ candidate: i + 1, start: a + 1, end: b2 - 2, title: i ? 'Der Sieg 🏆' : 'Drei auf einmal?!', reason: 'lauter Moment mit Reaktion',
        mood: i ? 'episch' : 'lustig', music: i ? 'epic orchestral hybrid with big drums' : 'quirky playful pizzicato',
        viral: i ? 6 : 9, viralWhy: i ? 'Solider Sieg-Moment, aber bekannter Ablauf.' : 'Lauter Ausraster mit Pointe – hoher Teilwert.', viralTip: 'Mit dem Ausruf direkt einsteigen.' }));
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
}).listen(9300, () => console.log('mock 9300'));
