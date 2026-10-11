# Video-Zentrale – Projektgedächtnis

Keine Passwörter, Tokens oder API-Schlüssel hier eintragen. Kommunikation mit dem Kunden auf **Deutsch, Du-Form**
(gleicher Kunde wie Flex-Studio / `flexisticker/tassenanimierer`, Unraid-Server `PowerServer` 192.168.1.10).

## Zweck

Gaming-Videos (und andere) vom Kunden: OBS nimmt lokal auf `F:\OBS - VIDEO Aufnahmen` auf, der OBS-Sortierer
(`tools/`, Windows-Aufgabe alle 5 Min.) schiebt fertige Aufnahmen nach `\\PowerServer\videos\eingang`.
Claude schneidet (ffmpeg, HyperFrames, B-Roll, Epidemic-Sound-Musik vom Kunden) und legt Ergebnis + gleichnamiges
`.jpg` (Titelbild) + `.json` (title, description, tags[], category, tiktok) nach `geschnitten`.
In der Zentrale prüft der Kunde, ändert Texte/Titelbild und gibt frei: YouTube = Upload **privat** (öffentlich stellt er
selbst in YouTube Studio), TikTok = **Entwurf** im Posteingang (Kunde postet in der App). Danach automatisch nach `hochgeladen`.

## Betrieb

- Image `ghcr.io/flexisticker/video-zentrale:latest` (GitHub Action bei Push auf `main`), Unraid Host-Port 8094 → 8090,
  `/videos` → `/mnt/user/videos`, `/data` → `/mnt/user/appdata/video-zentrale`.
- Versionierung: `package.json` erhöhen (Funktion = Nebenversion, Fehler = Korrektur), danach Push auf `main`.
- Ende jeder Aufgabe: Docker-Update in Unraid erwähnen („Check for Updates“ → „apply update“).

## Technik

- Node 22 ohne npm-Pakete (`server/`), Oberfläche ohne Framework (`public/app.js`), Speicher `/data/zentrale.json`.
- YouTube: OAuth Device Flow (Client-Typ „Fernseher und Geräte mit begrenzter Eingabe“, Scope `youtube`), Resumable Upload
  in Stücken, danach `thumbnails/set`. Nicht geprüfte API-Projekte laden nur privat hoch; Consent-Screen muss „In Produktion“
  sein, sonst Refresh-Token nach 7 Tagen weg.
- TikTok: Login Kit (Redirect URI muss https sein; Rückweg `/oauth/tiktok` ohne Sitzung, abgesichert über `state`,
  alternativ Adresse einfügen), Content Posting API Inbox-Upload (`video.upload`), Status bis `SEND_TO_USER_INBOX`.
- Test: `test/mock.js` (Google/TikTok-Nachbau, Port 9300) + `test/ui.cjs` (Playwright). Test-Chromium kann kein H.264 → WebM nehmen.

## Stand

- 1.0.0 (11.10.2026): erste Version. **Nicht getestet:** echtes YouTube/TikTok, Docker auf Unraid, Sortierer auf Windows.
- 1.1.0 (11.10.2026): **Kanäle** (`server/profiles.js`, `db().profiles`): MichaModus (Gaming, Standard) und 3dbymicha (gewerblich),
  je eigene YouTube-/TikTok-Verbindung (Tokens im Kanal, App-Zugangsdaten global) und Vorgaben (Kategorie, Tags, Footer).
  Vorschlag `suggest(v)`: `v.channel` (manuell/.json `channel`) › Stichwörter als ganze Wörter (Titel/Datei ×2) › Standard.
  Upload merkt `profileId` beim Freigeben. Migration aus 1.0: alte Verbindung + Vorgaben → Standardkanal.
  Docker-Label `net.unraid.docker.webui`. Paket auf ghcr.io ist **öffentlich** (Kunde hat umgestellt), Repo ebenfalls öffentlich.
- 1.2.0 (11.10.2026): **Claude-Vorschläge** (`server/ai.js`, `@anthropic-ai/sdk`, erste npm-Abhängigkeit → Dockerfile `npm ci`):
  6 Standbilder (ffmpeg, längste Seite 1280, `/data/ki/<id>-<n>.jpg`) + Dateiname/Notiz/Kanalbeschreibungen (`profile.aiStyle`)
  → `claude-opus-5-5`, effort medium, Structured Outputs (JSON-Schema mit Kanal-enum), `fallbacks: 'default'`
  (Beta `server-side-fallback-2026-07-01`). Ergebnis `v.ai`; ohne `editedAt`/`metaAt` automatisch übernommen, ohne Titelbild
  wird das empfohlene Standbild gesetzt. Kanalvorschlag: manuell/.json › Claude › Stichwörter › Standard. Auto für neue Videos
  in `geschnitten` (Einstellung), Kosten in `db().ai.spent`. Test: `ANTHROPIC_BASE_URL` auf `test/mock.js`, `test/ui-ai.cjs`.
  **Nicht getestet:** echte Claude-Antworten (kein API-Schlüssel in der Sandbox).
- 1.2.1: Einstellungsseite baute sich während der YouTube-Anmeldung alle 4 s neu auf (Schleifen vervielfachten sich, Eingaben gingen
  verloren). Jetzt `watchSettings()`: alle 3 s Stand holen, nur bei geändertem Verbindungsstand (`connSig`) neu aufbauen.
- 1.3.0 (11.10.2026): **Automatischer Schnitt** (`server/autocut.js`): neue Videos in `eingang` → ebur128 (Achtung: `-loglevel verbose`,
  sonst keine Werte!) + Szenen auf Keyframes → Whisper (`server/whisper.js`, whisper.cpp v1.9.5 im Docker-Build, Modell zur Laufzeit von
  huggingface → `/data/whisper`, Transkript `/data/transkripte/<id>.json` + `v.transcriptText`) → Kandidaten (Fenster Lautheit+Szenen) →
  `ai.chooseHighlights()` → Langfassung (concat-Demuxer, `-c:v copy`, loudnorm) + Shorts (crop 9:16, x264) → `geschnitten`, Original →
  neuer Ordner `rohvideos`. Sicherungen: ohne Ton/über 50 % „ruhig“ nichts kürzen. `db().cut` Einstellungen.
  **Ein-Klick-Verbindung:** über https (oder localhost) Popup-OAuth: Google Webanwendung `/oauth/google`, TikTok `/oauth/tiktok`, danach
  `oauth-fertig.html` (postMessage + schließt). Über http-IP bleibt Google Device Flow. Kunde braucht `videos.flexisticker.de` über NPM.
  **Nicht getestet:** echtes Whisper-Modell (huggingface aus der Sandbox gesperrt, Test mit `test/fake-whisper.sh`), echtes Google/TikTok.
- 1.4.0 (11.10.2026): **GPU** (`server/gpu.js`: NVENC-Test beim Start, `encodeWithFallback` → libx264; Kunde hat GTX 1050 Ti, 4 GB –
  für Bild-/Video-KI zu klein, nur Kodieren), **Untertitel** (`server/captions.js`, ASS mit Wort-Hervorhebung, Schrift `fonts/Anton`
  OFL; Whisper jetzt `-ml 1 -sow` = Wörter, `loadWords`/`sentences`), **Facecam-Layout** (`db().cut.facecam` Anteile 0–1, vstack
  1080×704 + 1080×1216), **Titelbilder** (`server/thumbs.js`: Fotos `/data/fotos` + `db().photos` mit Ausdruck-Label/Kanal,
  fal.ai BiRefNet-Freistellen, `compose()` per ffmpeg drawtext/overlay, `makeVariants()` nach Claude-Plan `v.ai.thumbs`,
  `boost()` FLUX Kontext → Variante 4). fal-Schemas/Preise am 11.10. per fal-Connector geprüft (birefnet: image_url → image.url,
  data-URI geht; kontext: prompt+image_url → images[].url, 0,04 $/Bild). Kunde hat 25 € fal-Guthaben.
  **Nicht getestet:** echte GPU (NVENC) auf Unraid, echtes Whisper, KI-Aufwertung mit echtem Bild.
- Ideen: KI-B-Roll per fal.ai (Video-Modelle), Viralitäts-Bewertung, Hook-Einblendung, Zeitplan.
- Entscheidung Kunde: Auslieferungen immer direkt auf `main` pushen.
- Ideen: Zeitplan (publishAt), Shorts automatisch aus langen Videos, Titelbild-Vorlagen, Untertitel (whisper).
