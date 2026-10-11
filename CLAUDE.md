# Micha’s Video-Zentrale – Projektgedächtnis

Name in der Oberfläche seit 1.6.0: **Micha’s Video-Zentrale** (`APP_NAME` in `server/version.js` und `public/app.js`).
Repo/Image-Name bleibt `video-zentrale`.

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
- Versionierung: `package.json` erhöhen (Funktion = Nebenversion, Fehler = Korrektur) **und oben in `server/changelog.js` eintragen**,
  danach Push auf `main`. Build-Nummer/Commit/Datum kommen per build-args aus der Action (`BUILD_NUMBER`, `GIT_COMMIT`, `BUILD_DATE`).
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
- 1.4.1: Freigestellte Fotos erschienen in den Einstellungen weiter mit Hintergrund – Browser-Zwischenspeicher (gleiche Bild-URL).
  Jetzt `photo.rev` in der URL, Schachbrett hinter Fotos, Status „✓ freigestellt“, Knopf zeigt „wird freigestellt …“.
  fal-Anfrageverlauf (Connector `search_request_history`) zeigte: Freistellen beim Kunden lief erfolgreich (200).
- 1.5.0 (11.10.2026): **Whisper auf der GPU** (zweiter whisper.cpp-Build mit CUDA im Dockerfile, Stufe `nvidia/cuda:12.4.1-devel`,
  Architekturen 61;75;86, CUDA-Bibliotheken nach `/usr/local/lib/whisper-cuda`; `whisper.js` versucht GPU zuerst, Fehler → Prozessor,
  `cut.whisper.gpu`), **Nachtbetrieb** (`cut.window {enabled, from, to}`, `autocut.inWindow()`, manueller Schnitt = Vorrang),
  **KI-Titelbild** (Claude-Schema `aiThumb {frame, photo, text, scene}`, `thumbs.generateAi()` → `fal-ai/nano-banana/edit`
  mit Foto + Standbild, 16:9, 0,04 $ → Variante 5, `fal.autoThumb`, `fal.genModel`). Workflow schafft vor dem Build Platz.
  **Nicht getestet:** CUDA-Whisper auf der echten GTX 1050 Ti, Nano Banana mit echten Fotos des Kunden.
- 1.6.0 (11.10.2026): **Hintergrundmusik** (`server/music.js`, `db().music`): Ordner `/videos/musik` (+ `<kanal-id>/`, Stimmungsordner
  `MOODS`), sonst KI-Musik `sonilo/v1.1/text-to-music` (fal, Eingabe prompt/duration/num_samples → `audio.url` m4a, 0,0025 $/s, mind. 10 s;
  Schema am 11.10. per Connector geprüft) → `musik/ki/` + `.txt`-Nachweis. Claude liefert je Short `mood` + `music` (englisch).
  `mixGraph()`: Musik loudnorm auf −28 LUFS (leise −32/laut −24), `sidechaincompress` mit der Stimme, amix, alimiter; Langfassung mit
  `-stream_loop -1` und `-c:v copy`. Fehler beim Mischen → Clip ohne Musik + Warnung. Profil: `musicStyle`, `musicMood`.
  **Versionierung** (`server/version.js`, `server/changelog.js`, `/api/version`, `/api/version/check`): Chip oben rechts, „Was ist neu“
  einmal je Browser (`localStorage vz-version`), Update-Prüfung über anonymen ghcr-Token → Manifest → Config-Labels.
  **Name** „Micha’s Video-Zentrale“. Getestet (Mock-fal + Playwright): KI-Musik je Short, eigene Titel nach Stimmung/Kanal, Langfassung
  mit Schleife, Ducking ca. −18 dB, Was ist neu, Einstellungen. **Nicht getestet:** echte Sonilo-Musik, echte Epidemic-Dateien,
  Label-Abruf auf ghcr.io (Blob-Download in der Sandbox gesperrt, Token + Manifest gingen).
- Netzwerk Kunde: `videos.flexisticker.de` braucht wie `studio` einen lokalen UniFi-DNS-Eintrag → 192.168.1.111 (NPM), sonst kommt
  die Anfrage über die öffentliche IP (Hairpin-NAT) und die Access List „Nur Heimnetz“ antwortet 403.
- 1.7.0 (11.10.2026): **Sicherung** (`server/backup.js`, `db().backup`): ZIP ohne Fremdpaket (deflateRaw + `zlib.crc32`),
  Inhalt `info.json`, `zentrale.json` (ohne `sessions`), `fotos/`, `transkripte/`. Täglich zur Uhrzeit (holt verpasste nach),
  `/data/sicherung`, `keep` Stück. Wiederherstellen: `store.replace()` (Sitzungen bleiben), vorher `create('vor-wiederherstellung')`.
  Routen `/api/backup[/config|/download|/restore]`. Getestet (Playwright): sichern, herunterladen (unzip ok), ändern, aus Liste und Datei
  wiederherstellen, angemeldet geblieben.
- 1.8.0 (11.10.2026): **Fehler EXDEV** beim Kunden: Schnitt rendert in `/data/tmp`, `renameSync` nach `/videos` scheitert über
  Laufwerksgrenzen → `lib.moveFile()` (rename, sonst Kopie als `.<name>.part` + rename + Quelle löschen), auch in `moveVideo`.
  Bei Schnittfehler werden `/data/tmp/<id>-*` gelöscht. **Regel: zwischen /data und /videos nie `renameSync`, immer `moveFile`.**
  **KI-Titelbilder nachträglich** (`thumbs.generateAiOptions`, 1–3 Stück → Varianten 5–7, Bildaufbau-Stile `STYLES`, Hochformat 9:16
  bei Shorts, `ai.ensureFrames()` ohne Claude), Bereich unter dem Titelbild im Detail; `youtube.setThumbnail()` +
  `POST /api/videos/:id/youtube-thumb` für schon hochgeladene Videos.
- 1.9.0 (11.10.2026): **LinkedIn** als Profiltyp `type: 'linkedin'` (`linkedinProfile()` in store.js, Migration `migLinkedin`,
  `profiles.isPro()`, nie in Stichwort-/Claude-Kanalwahl, nicht Standardkanal), Ordner `eingang-profi` (`lib.INBOXES`, setzt Kanal beim Einlesen,
  `channelFrom: 'ordner'`), Schnitt-Ausgaben erben manuellen Kanal. Profi-Schnitt: `renderShort(…, pro)` 4:5/1:1/16:9 (`cut.linkedin`),
  `buildCalmAss()` (Schrift `fonts/Lato-Bold.ttf`, OFL), Musik aus (`profile.music === false`), `chooseHighlights(…, profile, wish)` mit
  Geschäftskriterien. Claude: `proPrompt`/`proSchema` (Ich-Form, Beitrag 700–1500 Zeichen, 3–5 Hashtags in `tags`). UI: `linkedinBox()`, `applyMode()`,
  `/file?download=1`, `POST /api/videos/:id/linkedin` (`v.li`). **Schnitt-Plan** `v.cutPlan` (`planOf`/`setPlan`, `/cut {plan}`, `/cutplan`):
  long, shorts, summary (Sek.), wish → Kurzfassung `renderSummary` (trim/concat, Audio-Fades) aus `ai.chooseSummary()` (15-s-Bausteine).
  **Papierkorb** (`papierkorb`, `v.trash {from, at}`, `/trash`, `/restore`, `DELETE /api/videos/:id`, `/api/trash/empty`, `purge()` löscht
  auch Standbilder/Varianten/Transkript, `settings.trashDays` 30). Getestet (Mock + Playwright): eingang-profi → 2 Clips 1080×1350 ohne Musik,
  Untertitel-Bild, Plan mit Wunsch → 1 Short + Kurzfassung, Papierkorb komplett, LinkedIn-Kasten (Kopieren, gepostet → Archiv).
  **Nicht getestet:** echte Claude-Texte für LinkedIn, Kurzfassung mit echtem langem Gameplay.
- 1.9.1: TikTok „The chunk size is invalid“ bei 5–10-MB-Videos (chunk_size 10 MB > Videogröße). Jetzt bis 64 MB ein Stück
  (`chunk_size = video_size`), darüber 10-MiB-Stücke, Anzahl abgerundet, Rest im letzten Stück (Media Transfer Guide). Mit Mock geprüft (7 MB, 70 MB).
- 1.9.2: Studio-Link `studio.youtube.com/video/<id>/edit` zeigt „Ein Fehler ist aufgetreten“, wenn im Browser ein anderer Brand-Kanal aktiv ist.
  Jetzt zusätzlich `studio.youtube.com/channel/<UC…>/videos/upload` (`v.yt.channelId`) + Hinweis „Konto wechseln“. Nicht live geprüft, ob Studio
  über die Kanal-Adresse selbst umschaltet.
- 1.9.3: Titelbild-Status am Upload (`v.yt.thumbAt`, `thumbNone`, `vertical`). Beim Kunden: Short-Titelbild erschien in Studio nicht,
  Telefonnummer ist bestätigt → vermutlich ignoriert YouTube API-Titelbilder bei Shorts (nicht belegt). Offen: bei bestätigtem Verhalten
  Shorts ohne Titelbild-Versuch + Hinweis App.
- 1.10.0: Kunde fand Ducking zu heftig. `music.duckLevel` (`DUCK` leicht/mittel/stark, Standard leicht ≈ −6 dB; stark = alt ≈ −17 dB),
  `music.lufs` Regler −42…−18 (Standard −30 statt −28), Titel einmal per ebur128 gemessen (`measure()`, `track.lufs`) → `volume=` statt
  laufendem loudnorm (kein Pumpen). Gemessen mit Testton.
- Einrichtung beim Kunden (11.10.2026): Zentrale läuft über `https://videos.flexisticker.de` (NPM, Access List „Nur Heimnetz“,
  lokaler UniFi-DNS-Eintrag → 192.168.1.111). Browser zeigte trotzdem 403: Chrome/Edge „Sicheres DNS“ fragte Google/Cloudflare
  (öffentliche IP) → ausschalten bzw. „aktueller Dienstanbieter“, `net-internals/#dns` leeren. Prüfung: `curl -I` am PC.
  Google: Projekt „Video Zentrale“, Google Auth Platform (Branding braucht Datenschutz-/AGB-Link → `www.flexisticker.de/…`),
  Client Typ Webanwendung, Redirect `https://videos.flexisticker.de/oauth/google`. TikTok: Entwicklerkonto per E-Mail, Domain
  `flexisticker.de` per DNS-TXT bei Alfahosting bestätigt, **Sandbox** (Key beginnt mit `sb`, eigenes Secret!), Produkte über
  „Add products“ (Login Kit mit Redirect URI unter Web, Content Posting API), Target Users michamodus + 3dbymicha.
  **Beide Plattformen verbunden.** App-Icon `docs/app-icon-1024.png`. Prüfung (Demo-Video aus Sandbox) noch nicht eingereicht.
- **Offen – Planungstool (angeboten, wartet auf „leg los“):** Reiter „Planung“ mit Wochen-/Monatskalender, Drag & Drop,
  Sendeplätze je Kanal **stellt der Kunde selbst ein** (keine festen Startzeiten), „Einplanen“ auf nächsten freien Platz, Shorts
  eines Langvideos über Tage verteilen, Übersicht Heute/Woche, Lückenwarnung. YouTube `publishAt` erst nach YouTube-Audit
  (bis dahin Erinnerung „jetzt öffentlich stellen“), TikTok zur geplanten Zeit als Entwurf (Direct Post erst nach TikTok-Prüfung).
- Ideen: KI-B-Roll per fal.ai (Video-Modelle), Viralitäts-Bewertung, Hook-Einblendung, Zeitplan.
- Entscheidung Kunde: Auslieferungen immer direkt auf `main` pushen.
- Ideen: Zeitplan (publishAt), Shorts automatisch aus langen Videos, Titelbild-Vorlagen, Untertitel (whisper).
