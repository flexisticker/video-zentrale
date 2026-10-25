// Nachbau einer OpenAI-kompatiblen Cloud-KI (fal OpenRouter / Gemini / DeepSeek) für Tests.
// Aufruf: node test/mock-cloud.js [port]   (Standard 9320) – POST …/chat/completions füllt das JSON-Schema mit Beispielwerten.
// MOCK_CLOUD_FAIL=402 → Fehler mit diesem Status; MOCK_CLOUD_NOSCHEMA=1 → 400 bei response_format json_schema (wie DeepSeek)
import http from 'node:http';

const port = Number(process.argv[2] || 9320);
const log = [];
function fill(schema, key = '') {
  if (!schema) return null;
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'object': return Object.fromEntries(Object.entries(schema.properties || {}).map(([k, v]) => [k, fill(v, k)]));
    case 'array': return [fill(schema.items, key)];
    case 'integer': case 'number': return /score|viral/i.test(key) ? 8 : /sentence/i.test(key) ? 0 : key === 'start' ? 1 : key === 'end' ? 20 : 3;
    case 'boolean': return true;
    default: return /title|titel/i.test(key) ? 'Cloud-Titel ☁️' : 'Cloud erzeugt.';
  }
}
http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url.endsWith('/_log')) return send(200, log);
  if (!req.url.endsWith('/chat/completions')) return send(404, { error: { message: 'unbekannt' } });
  const j = JSON.parse(body || '{}');
  const parts = j.messages?.[0]?.content || [];
  log.push({ url: req.url, auth: (req.headers.authorization || '').split(' ')[0], model: j.model, format: j.response_format?.type, images: parts.filter((p) => p.type === 'image_url').length, chars: JSON.stringify(parts).length });
  if (process.env.MOCK_CLOUD_FAIL) return send(Number(process.env.MOCK_CLOUD_FAIL), { error: { message: 'Insufficient credits (Mock)' } });
  if (process.env.MOCK_CLOUD_NOSCHEMA && j.response_format?.type === 'json_schema') return send(400, { error: { message: 'response_format json_schema is not supported' } });
  let schema = j.response_format?.json_schema?.schema;
  if (!schema) { const t = parts.map((p) => p.text || '').join('\n'); const m = /JSON-Schema \(alle Pflichtfelder\), auf Deutsch:\n(\{.*\})\s*$/s.exec(t); schema = m ? JSON.parse(m[1]) : { type: 'object', properties: {} }; }
  await new Promise((r) => setTimeout(r, Number(process.env.MOCK_CLOUD_DELAY || 300)));
  send(200, { id: 'x', model: j.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '```json\n' + JSON.stringify(fill(schema)) + '\n```' } }],
    usage: { prompt_tokens: 1000, completion_tokens: 200, ...(process.env.MOCK_CLOUD_COST ? { cost: Number(process.env.MOCK_CLOUD_COST) } : {}) } });
}).listen(port, '127.0.0.1', () => console.log('mock-cloud', port));
