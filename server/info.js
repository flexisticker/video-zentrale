// Öffentliche Info-Seiten der Video-Zentrale unter /info (für die App-Prüfung bei TikTok/Google: von außen erreichbare Website
// mit Beschreibung, Nutzungsbedingungen und Datenschutzhinweisen). Nur diese Seiten sind ohne Anmeldung erreichbar; in NPM wird
// nur der Pfad /info/ für außen freigegeben, alles andere bleibt im Heimnetz. Kein JavaScript, eigenes Stylesheet (CSP style-src 'self').
// Kontakt/Impressum kommen aus den Einstellungen (Einstellungen → Öffentliche Info-Seite).
import fs from 'node:fs';
import path from 'node:path';
import { db, saveNow } from './store.js';

const P = '/info';
const ICON = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'icons', 'icon-192.png');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DEFAULTS = { company: 'Flexisticker', contact: 'flexisticker.de', imprintUrl: 'https://freigabe.flexisticker.de/impressum', privacyUrl: '' };
export const cfg = () => ({ ...DEFAULTS, ...(db().publicInfo || {}) });
const httpsUrl = (u) => /^https:\/\/[^\s"'<>]+$/.test(String(u || '').trim()) ? String(u).trim() : '';
export function configure(b) {
  const c = (db().publicInfo ||= {});
  if (typeof b.company === 'string') c.company = b.company.trim().slice(0, 120);
  if (typeof b.contact === 'string') c.contact = b.contact.trim().slice(0, 1000);
  for (const k of ['imprintUrl', 'privacyUrl']) if (typeof b[k] === 'string') c[k] = b[k].trim() === '' ? '' : (httpsUrl(b[k]) || c[k] || '');
  saveNow();
  return cfg();
}

function nav(esc, current) {
  const c = cfg();
  const items = [[P, 'Über die App / About'], [P + '/nutzungsbedingungen', 'Nutzungsbedingungen / Terms of Service'], [P + '/datenschutz', 'Datenschutz / Privacy Policy']];
  return `<p class="docs">${items.map(([href, label]) => href === current ? `<b>${esc(label)}</b>` : `<a href="${href}">${esc(label)}</a>`).join('')}${c.imprintUrl ? `<a href="${esc(c.imprintUrl)}">Impressum</a>` : ''}</p>`;
}
function contact(esc) {
  const c = cfg();
  const lines = [c.company, ...String(c.contact || '').split(/\r?\n/)].map((x) => x.trim()).filter(Boolean).map(esc).join('<br>');
  return (lines || '') + (c.imprintUrl ? `<br><a href="${esc(c.imprintUrl)}">Impressum / Imprint</a>` : '');
}

export function aboutPage(esc) {
  const name = esc(cfg().company || 'Flexisticker');
  return `<h1>Micha’s Video-Zentrale</h1>
${nav(esc, P)}
<div class="card">
<p><b>Micha’s Video-Zentrale</b> ist das eigene Video-Werkzeug von ${name}. Damit bereitet der Inhaber seine <b>eigenen Videos</b>
(Gaming und 3D-Druck) auf und veröffentlicht sie auf seinen <b>eigenen Kanälen</b> – YouTube und TikTok (MichaModus, 3dbymicha).</p>
<p>Die Anwendung läuft auf einem eigenen Server im Betrieb. Sie ist nicht öffentlich zugänglich, es gibt keine Registrierung und keine fremden Nutzer.</p>
</div>
<h2>Was die App macht</h2>
<div class="card">
<ul>
<li>Eigene Aufnahmen schneiden (Highlights, Kurzfassung, Shorts) und mit Untertiteln, Titelbild, Titel und Beschreibung versehen.</li>
<li>Jedes Video wird vom Inhaber geprüft und ausdrücklich freigegeben – erst dann wird es hochgeladen.</li>
<li><b>YouTube:</b> Upload als privates Video auf den eigenen Kanal; öffentlich stellt der Inhaber es selbst in YouTube Studio.</li>
<li><b>TikTok:</b> Das fertige Video wird <b>direkt aus der App auf dem eigenen TikTok-Profil veröffentlicht</b>. Vorher wählt der Inhaber im
Veröffentlichungsdialog der App selbst Sichtbarkeit, Kommentare/Duett/Stitch und ggf. die Kennzeichnung von Werbe- bzw. Markeninhalten und bestätigt
die TikTok-Richtlinien – erst dann wird gepostet. Alternativ kann ein Video als Entwurf in den TikTok-Posteingang geschickt und in der TikTok-App fertiggestellt werden.</li>
</ul>
</div>
<h2>TikTok-Anbindung</h2>
<div class="card">
<ul>
<li><b>Login Kit:</b> Der Inhaber meldet sich einmal mit seinem TikTok-Konto an und stimmt dem Zugriff zu. Die Verbindung kann jederzeit in der App oder in den TikTok-Einstellungen getrennt werden.</li>
<li><b>user.info.basic:</b> Anzeige von Profilname und Profilbild, damit klar ist, auf welches Konto hochgeladen wird.</li>
<li><b>video.publish:</b> Direktes Veröffentlichen eines vom Inhaber ausgewählten Videos auf seinem eigenen Profil (Content Posting API, Direct Post) –
nur nach ausdrücklicher Bestätigung im Veröffentlichungsdialog. Die Profil-Einstellungen von TikTok (z. B. gesperrte Kommentare, maximale Videolänge) werden vorher abgefragt und beachtet.</li>
<li><b>video.upload:</b> Optional: ein ausgewähltes Video als Entwurf in den TikTok-Posteingang schicken, um es in der TikTok-App zu bearbeiten.</li>
<li>Es werden keine Inhalte anderer Nutzer gelesen, keine Daten verkauft oder an Dritte weitergegeben und keine Werbung geschaltet.</li>
</ul>
</div>
<h2>English summary</h2>
<div class="card">
<p><b>Micha’s Video-Zentrale</b> is the private video tool of ${name}. The owner uses it to edit his <b>own</b> gaming and 3D-printing videos and to publish them
to his <b>own</b> YouTube and TikTok accounts (MichaModus, 3dbymicha). The application runs on the company’s own server; it is not offered to the public and has no other users.</p>
<p>TikTok integration: <b>Login Kit</b> (the owner signs in with his TikTok account and grants access; access can be revoked at any time),
<b>user.info.basic</b> (display name and avatar to show which account is connected), <b>video.publish</b> (Direct Post: the app publishes a video the owner selected
directly to his own TikTok profile, only after he chooses the privacy level and interaction settings, discloses branded or promotional content where applicable and confirms
TikTok’s policies in the app’s posting dialog; creator info such as disabled interactions and maximum video length is queried first and respected)
and <b>video.upload</b> (optional: send a selected video to his TikTok inbox as a draft to finish it in the TikTok app).
No content of other users is accessed, no data is sold or shared, no ads are shown.</p>
</div>
<h2>Kontakt / Contact</h2>
<div class="card"><p>${contact(esc)}</p></div>`;
}

export function termsPage(esc) {
  const name = esc(cfg().company || 'Flexisticker');
  return `<h1>Nutzungsbedingungen / Terms of Service</h1>
${nav(esc, P + '/nutzungsbedingungen')}
<div class="card">
<p><b>1. Anbieter und Zweck.</b> Micha’s Video-Zentrale („die App“) wird von ${name} betrieben. Sie dient ausschließlich dazu, eigene Videos des Inhabers zu bearbeiten
und auf seinen eigenen Kanälen bei YouTube und TikTok zu veröffentlichen.</p>
<p><b>2. Nutzerkreis.</b> Die App wird nicht öffentlich angeboten. Nutzer ist allein der Inhaber; es gibt keine Registrierung und keine Konten für Dritte.</p>
<p><b>3. Verbundene Plattformen.</b> Für die Nutzung von YouTube und TikTok gelten zusätzlich deren Nutzungsbedingungen und Richtlinien
(u. a. TikTok Terms of Service, TikTok Community Guidelines, YouTube-Nutzungsbedingungen). Hochgeladen wird nur, was der Inhaber ausdrücklich freigibt.</p>
<p><b>4. Inhalte und Rechte.</b> Der Inhaber ist für die hochgeladenen Inhalte verantwortlich und stellt sicher, dass er die nötigen Rechte daran (z. B. an Musik) besitzt
und Werbe- bzw. Markeninhalte nach den Regeln der Plattform kennzeichnet.</p>
<p><b>5. Verbindung trennen.</b> Die Verbindung zu TikTok bzw. YouTube kann jederzeit in der App oder in den Kontoeinstellungen der jeweiligen Plattform widerrufen werden.</p>
<p><b>6. Haftung und Verfügbarkeit.</b> Die App wird ohne Gewähr für ständige Verfügbarkeit betrieben. Es gilt deutsches Recht.</p>
</div>
<h2>English</h2>
<div class="card">
<p><b>1. Operator and purpose.</b> Micha’s Video-Zentrale (“the app”) is operated by ${name}. It is used exclusively to edit the owner’s own videos and publish them
to his own YouTube and TikTok accounts.</p>
<p><b>2. Users.</b> The app is not offered to the public. The owner is its only user; there is no sign-up and there are no third-party accounts.</p>
<p><b>3. Connected platforms.</b> Use of YouTube and TikTok is additionally subject to their terms and policies (including the TikTok Terms of Service and Community Guidelines
and the YouTube Terms of Service). Only content the owner explicitly approves is uploaded.</p>
<p><b>4. Content.</b> The owner is responsible for uploaded content, holds the necessary rights (e.g. for music) and discloses branded or promotional content as required by the platform.</p>
<p><b>5. Disconnecting.</b> Access to TikTok or YouTube can be revoked at any time in the app or in the platform’s account settings.</p>
<p><b>6. Liability.</b> The app is provided without guarantee of continuous availability. German law applies.</p>
</div>
<div class="card"><p>${contact(esc)}</p></div>`;
}

export function privacyPage(esc) {
  const name = esc(cfg().company || 'Flexisticker');
  return `<h1>Datenschutzhinweise zur App / Privacy Policy</h1>
${nav(esc, P + '/datenschutz')}
<div class="card">
<p><b>Verantwortlicher:</b><br>${contact(esc)}</p>
<p>Diese Hinweise gelten für Micha’s Video-Zentrale.${cfg().privacyUrl ? ` Allgemeine Informationen zum Datenschutz bei ${name} finden Sie in der <a href="${esc(cfg().privacyUrl)}">Datenschutzerklärung</a>.` : ''}</p>
</div>
<h2>Welche Daten verarbeitet werden</h2>
<div class="card">
<ul>
<li><b>Eigene Videos des Inhabers</b> samt Titel, Beschreibung, Titelbild und automatisch erstelltem Transkript – gespeichert auf dem eigenen Server des Betriebs.</li>
<li><b>Von TikTok:</b> Profilname, Profilbild und eine anonyme Konto-Kennung (Scope user.info.basic) sowie die Zugriffs- und Aktualisierungs-Token der Verbindung.
Die Token werden nur auf dem eigenen Server gespeichert und ausschließlich genutzt, um vom Inhaber freigegebene Videos auf sein eigenes Konto hochzuladen
(video.upload, video.publish) und den Upload-Status abzufragen.</li>
<li><b>Von YouTube (Google):</b> Kanalname und die Zugriffs-Token der Verbindung, ausschließlich zum Hochladen eigener Videos.</li>
<li>Es werden keine Daten anderer TikTok- oder YouTube-Nutzer abgerufen, keine Daten verkauft, keine Profile zu Werbezwecken gebildet und keine Cookies zu Tracking-Zwecken gesetzt.</li>
</ul>
</div>
<h2>Weitergabe</h2>
<div class="card">
<p>Daten der Plattformen (TikTok, YouTube) werden nicht an Dritte weitergegeben. Für die Bearbeitung der <b>eigenen</b> Videos nutzt die App folgende Dienste als Auftragsverarbeiter:
Anthropic sowie fal.ai/OpenRouter mit Google Gemini (KI-Vorschläge für Schnitt, Titel und Texte anhand von Standbildern und Transkript) und fal.ai (Erzeugung von Titelbildern und Musik). Teile der Auswertung laufen auf eigenen Rechnern (Ollama).
Die Übertragung an diese Dienste umfasst keine Daten von TikTok- oder YouTube-Konten.</p>
</div>
<h2>Speicherdauer und Widerruf</h2>
<div class="card">
<p>Zugriffs-Token werden gespeichert, solange die Verbindung besteht, und beim Trennen der Verbindung gelöscht. Der Zugriff kann jederzeit in der App oder in den Einstellungen
des TikTok- bzw. Google-Kontos widerrufen werden (TikTok: Einstellungen und Datenschutz → Sicherheit → Apps und Dienste). Es bestehen die Rechte auf Auskunft, Berichtigung,
Löschung, Einschränkung, Datenübertragbarkeit und Beschwerde bei einer Aufsichtsbehörde (Art. 15–21, 77 DSGVO).</p>
</div>
<h2>English</h2>
<div class="card">
<p><b>Controller:</b> ${name} (contact details above).</p>
<p><b>Data processed:</b> the owner’s own videos with titles, descriptions, thumbnails and transcripts (stored on the company’s own server);
from TikTok: display name, avatar, an anonymous account identifier (user.info.basic) and the OAuth access/refresh tokens; from YouTube: channel name and OAuth tokens.
Tokens are stored only on the company’s own server and used solely to upload videos the owner approved to his own accounts (video.upload, video.publish) and to check the upload status.</p>
<p><b>No sharing:</b> TikTok and YouTube data are not shared with or sold to third parties, not used for advertising and not combined with other data. No data of other users is accessed.
For editing the owner’s own videos the app uses Anthropic and fal.ai/OpenRouter with Google Gemini (AI suggestions based on frames and transcript) and fal.ai (thumbnails, music) as processors, plus self-hosted models (Ollama); no TikTok or YouTube account data is sent to them.</p>
<p><b>Retention and revocation:</b> tokens are kept while the connection exists and deleted when it is disconnected. Access can be revoked at any time in the app or in the TikTok/Google account settings.
You have the rights of access, rectification, erasure, restriction, portability and to lodge a complaint with a supervisory authority (GDPR Art. 15–21, 77).</p>
</div>`;
}


const CSS = `:root{--red:#9b1d20;--ink:#1d2129;--mute:#5b6270;--line:#e3e6eb;--bg:#f4f5f7}
*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
header{background:#fff;border-bottom:3px solid var(--red)}header .wrap{display:flex;align-items:center;gap:12px;padding:14px 16px}
header img{width:36px;height:36px;border-radius:8px}header b{font-size:18px}
.wrap{max-width:860px;margin:0 auto;padding:0 16px}main{padding:18px 16px 40px}h1{font-size:26px;margin:8px 0}h2{font-size:19px;margin:26px 0 10px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:6px 20px;margin:12px 0}ul{padding-left:20px}
.docs a,.docs b{display:inline-block;margin:4px 16px 4px 0}a{color:var(--red);font-weight:600}
footer{border-top:1px solid var(--line);padding:16px 0;color:var(--mute);font-size:14px}
@media (prefers-color-scheme: dark){:root{--ink:#e8eaee;--mute:#a3a9b5;--line:#2c313a;--bg:#14171c}header,.card{background:#1c2027}a{color:#f47c70}}`;

function page(title, body) {
  const c = cfg();
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="icon" href="${P}/icon.png"><link rel="stylesheet" href="${P}/style.css"></head>
<body><header><div class="wrap"><img src="${P}/icon.png" alt=""><b>Micha’s Video-Zentrale</b></div></header><main class="wrap">${body}</main>
<footer><div class="wrap">© ${new Date().getFullYear()} ${esc(c.company)}${c.imprintUrl ? ` · <a href="${esc(c.imprintUrl)}">Impressum</a>` : ''} · <a href="${P}/datenschutz">Datenschutz</a> · <a href="${P}/nutzungsbedingungen">Nutzungsbedingungen</a></div></footer></body></html>`;
}

// → true, wenn die Anfrage hier beantwortet wurde
export function handle(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (p !== P && !p.startsWith(P + '/')) return false;
  const html = (code, body) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }); res.end(req.method === 'HEAD' ? '' : body); };
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true; }
  if (p === P) html(200, page('Micha’s Video-Zentrale', aboutPage(esc)));
  else if (p === P + '/nutzungsbedingungen') html(200, page('Nutzungsbedingungen – Micha’s Video-Zentrale', termsPage(esc)));
  else if (p === P + '/datenschutz') html(200, page('Datenschutz – Micha’s Video-Zentrale', privacyPage(esc)));
  else if (p === P + '/terms' || p === P + '/privacy') { res.writeHead(301, { Location: p.endsWith('terms') ? P + '/nutzungsbedingungen' : P + '/datenschutz' }); res.end(); }
  else if (p === P + '/style.css') { res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }); res.end(CSS); }
  else if (p === P + '/icon.png') { try { const b = fs.readFileSync(ICON); res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }); res.end(b); } catch { res.writeHead(404); res.end(); } }
  else html(404, page('Nicht gefunden', `<h1>Seite nicht gefunden</h1>${nav(esc, '')}`));
  return true;
}
