// Nachbau von Ollama für Tests (/api/version, /api/tags, /api/show, /api/pull, /api/chat mit format = JSON-Schema).
// Aufruf: node test/mock-ollama.js [port] [modell …]   (Standard 9310, qwen2.5:7b-instruct)
// /api/chat füllt das Schema mit passenden Beispielwerten (Zahlen aus Kandidaten/Sätzen im Text, sonst Platzhalter).
import http from 'node:http';

const port = Number(process.argv[2] || 9310);
const models = process.argv.slice(3).length ? process.argv.slice(3) : ['qwen2.5:7b-instruct'];
const log = [];

function fill(schema, ctx, key = '') {
  if (!schema) return null;
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'object': {
      const o = {};
      for (const [k, v] of Object.entries(schema.properties || {})) o[k] = fill(v, ctx, k);
      return o;
    }
    case 'array': return [fill(schema.items, ctx, key), ...(key === 'shorts' && ctx.cands > 1 ? [fill(schema.items, { ...ctx, second: true }, key)] : [])];
    case 'integer': case 'number': {
      if (key === 'candidate') return ctx.second ? 2 : 1;
      if (key === 'start') return ctx.second ? ctx.c2?.[0] ?? 10 : ctx.c1?.[0] ?? 0;
      if (key === 'end') return ctx.second ? ctx.c2?.[1] ?? 40 : ctx.c1?.[1] ?? 30;
      if (/viral|score/i.test(key)) return 7;
      if (/sentence/i.test(key)) return 0;
      if (key === 'len') return 2;
      if (key === 'at') return (ctx.c1?.[0] ?? 0) + 5;
      if (/frame/i.test(key)) return 1;
      return 5;
    }
    case 'boolean': return true;
    default: return /title|titel/i.test(key) ? 'Lokaler Titel 🔥' : /text|summary|why|tip|reason|changes/i.test(key) ? 'Lokal erzeugt.' : 'lokal';
  }
}

http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const j = body ? JSON.parse(body) : {};
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/api/version') return send(200, { version: '0.40.11-mock' });
  if (req.url === '/api/tags') return send(200, { models: models.map((name) => ({ name })) });
  if (req.url === '/api/show') return models.includes(j.model) ? send(200, { capabilities: /vl|vision/.test(j.model) ? ['completion', 'vision'] : ['completion'] }) : send(404, { error: `model '${j.model}' not found` });
  if (req.url === '/api/pull') { if (!models.includes(j.model)) models.push(j.model); return send(200, { status: 'success' }); }
  if (req.url === '/api/log') return send(200, log);
  if (req.url === '/api/chat') {
    if (!models.includes(j.model)) return send(404, { error: `model '${j.model}' not found` });
    const text = j.messages?.[0]?.content || '';
    const secs = [...text.matchAll(/Sekunde (\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    log.push({ model: j.model, chars: text.length, images: j.messages?.[0]?.images?.length || 0, ctx: j.options?.num_ctx, gekuerzt: /gekürzt/.test(text), sNums: (() => { const n = [...text.matchAll(/^S(\d+) /gm)].map((m) => +m[1]); return n.length ? [n.length, n.slice(0, 3), n.slice(-3)] : null; })(), lachen: /LACHEN/.test(text), keys: Object.keys(j.format?.properties || {}) });
    const out = fill(j.format, { c1: secs[0], c2: secs[1], cands: secs.length });
    await new Promise((r) => setTimeout(r, 300));
    return send(200, { model: j.model, message: { role: 'assistant', content: JSON.stringify(out) }, done: true, prompt_eval_count: Math.ceil(text.length / 3.5), eval_count: 400 });
  }
  send(404, { error: 'unbekannt' });
}).listen(port, '127.0.0.1', () => console.log('mock-ollama', port, models.join(',')));
