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
- 1.10.1: TikTok-Inbox-Upload funktioniert in der Sandbox (Kunde: Benachrichtigung „Dein Video von Zentrale ist bereit“ im Posteingang,
  nicht unter Entwürfe). Statuszeile `ttStatusLine()` mit `v.tt.tikStatus/tikReason/checkedAt`, `POST /api/videos/:id/tiktok-status`,
  Zeitüberschreitung → `state: 'unconfirmed'` statt „done“.
- 1.11.0: Kunde will TikTok-Prüfung („die App richtig machen“, nimmt das Demo-Video selbst auf). **Direct Post** (`tiktok.directPost`,
  Scope `video.publish` nur wenn an, `creatorInfo()` = `/v2/post/publish/creator_info/query/`, `upload(…, direct)` → `/v2/post/publish/video/init/`
  mit post_info title/privacy_level/disable_*/brand_*), Dialog `tiktokPostDialog()` nach Content Sharing Guidelines (Kontoinfo, Vorschau, keine
  Vorauswahl, gesperrte Interaktionen aus creator_info, Offenlegung mit „Werbeinhalt“/„Bezahlte Partnerschaft“, Markeninhalt nicht SELF_ONLY,
  Musik-/Markeninhalt-Zustimmung mit Links, max. Dauer). Serverprüfung im Upload-Route. Store übernimmt `tiktok.directPost` (Fehler gefunden!).
  **Zum Posten** (`renderPosting`, `toPost()`, `v.tt.posted` via `/tiktok-posted`). Getestet mit Mock + Playwright (Pixel 7).
  Offen: Demo-Video aufnehmen (Sandbox, Direct Post + Upload zeigen), Prüfung einreichen. Richtlinien-Details teils aus Sekundärquellen.
- 1.12.0: Profil `clipHints` (MichaModus: Funny Moments, Rage, Fails …; 3dbymicha: Satisfying, Vorher/Nachher) und `shorts` je Kanal
  (6 bzw. 4, max. 10, `planOf` nimmt Kanalwert vor global). Kandidaten bis 30. **Viral-Potenzial**: chooseHighlights liefert `viral/viralWhy/viralTip`
  je Clip (→ `v.viral`, by 'Schnitt'), suggest-Schema `viral {score, why, tip}` (→ `v.viral`, by 'Claude', überschreibt). UI `viralChip()`, `renderViral()`.
- 1.13.0: Viral-Schema mit `hook/edit/packaging/nextTime`; **Coach** `ai.coach(profileId)` (letzte 25 Videos des Kanals: Titel, Summary,
  Viral, Transkript-Ausschnitt → summary/strengths/tips[5]/ideas, `db().coach[kanal]`), Routen `GET/POST /api/coach`, Reiter „💡 Coach“.
  Keine Aufrufzahlen (YouTube Analytics nicht angebunden) – mögliche nächste Stufe.
- 1.13.1: Kunde: „Diashow“ in geschnittenen/hochgeladenen Videos. Ursache: Langfassung per concat-Demuxer + `-c:v copy` mit inpoints
  zwischen Keyframes (OBS: Keyframe-Abstand groß) → Material ab vorherigem Keyframe doppelt (Test: 8190 statt 7020 Bilder). Jetzt
  `fps=<Quelle>,select='between(t,a,b)+…',setpts=N/(fps*TB)` + `aselect/asetpts` per `-filter_complex_script`, NVENC/x264 (`probeFps`).
  Alter Weg nur noch bei `cut.longCopy` oder ganz ohne Schnitt. Kunde bietet PC mit RTX 3070/64 GB als Rechenhelfer an (nicht gebaut).
- 1.14.0: **Rechenhelfer** (`server/helper.js`, `db().helper {enabled, token, model}`): Routen `/api/helper/*` mit Kopf `X-Helper-Token`
  (vor Login/CSRF), Long-Poll `next` (25 s), `job/:id/audio|result|error`, `hello` (online = Lebenszeichen < 90 s). `whisper.js`: ist der Helfer
  online → `helper.transcribe(wav)` (nicht abgeholt in 2 Min. oder Zeitüberschreitung → lokal), `lastEngine`. Windows-Teil `tools/rechenhelfer/`
  (Rechenhelfer.ps1 UTF-8-BOM + CRLF für PowerShell 5.1, Einrichten/Starten/Autostart-entfernen.bat, LIESMICH), ZIP per `/api/helper-download?origin=`
  mit `rechenhelfer.json` (url, token). Dockerfile kopiert `tools/rechenhelfer`. Getestet mit pwsh 7 unter Linux (Testschalter `VZ_HELPER_HOME`,
  `VZ_WHISPER_EXE`) + fake-whisper: online, Auftrag, Ergebnis. **Nicht getestet:** echtes Windows/PowerShell 5.1, CUDA-Download (Asset-Name
  `whisper-cublas-12.*-bin-x64.zip` per GitHub-API gesucht), Aufgabenplanung. Kunden-PC: RTX 3070, 64 GB.
- 1.15.0: Handy/Tablet: ≤ 900 px `.bottomnav` (Posten, Freigabe, Eingang, Coach, Mehr → `moreSheet()`), Reiter oben aus; ≤ 600 px Detail als
  Vollbild, Karten 2-spaltig; `(pointer: coarse)` größere Knöpfe/16-px-Eingaben; Einstellungen mit Sprungleiste `.setjump` (IDs `s-…`).
  PWA: `public/manifest.webmanifest` (start_url `/?app=1#posten`), `public/sw.js` (nur Offline-Hinweis, kein Daten-Cache), Icons `public/icons/`,
  Installieren-Knopf (`beforeinstallprompt`) bzw. iOS-Hinweis im „Mehr“-Blatt. Geprüft: 360/390/768/1024 px ohne seitliches Verrutschen,
  iPhone-13- und iPad-Ansicht. Installation über https (videos.flexisticker.de) nötig.
- 1.16.0: Rechenhelfer 1.2 pausiert beim Zocken (Kunde braucht die GPU): `Get-GamingReason` = OBS-Prozess, Spieleliste (`helper.games`,
  Prozessnamen), `nvidia-smi` Auslastung ≥ `helper.gpuLoad` (25 %). Pausiert → hello `{paused:true}`, Server `online()` false → lokal.
  Laufendes Whisper als `Start-Process` (Windows: Hidden), alle 3 s Prüfung OBS/Spiel → Kill + Fehler → Server rechnet selbst.
  hello-Antwort liefert `gaming`-Einstellungen. 1.15.1: Status/Protokoll `%LOCALAPPDATA%\VideoZentrale-Rechenhelfer\rechenhelfer.log`, Modell beim Start.
  Getestet mit pwsh unter Linux (Testspiel-Prozess, langsames Fake-Whisper). Erkennungsverzögerung bis ~25 s (Long-Poll), Abbruch ≤ 3 s.
- 1.16.1: whisper.cpp-Releases heißen jetzt `whisper-bin-win-cuda-12.4.0-x64.zip` (vorher `whisper-cublas-12.*-bin-x64.zip`) → Helfer 1.3
  sucht beide Muster in den letzten 10 Releases. `Get-Download` (HttpWebRequest, 1-MB-Puffer, Range-Fortsetzung über `.part`, Fortschritt alle 5 s
  per hello-Status + Log je 10 %). Server: `helper.online()` false, solange Status „lädt/startet/Fehler/Modell …/whisper.cpp …“; Einstellungen
  frischen die Statuszeile alle 3 s auf (`refreshHelperStatus`).
- 1.16.2: Browser-Upload großer Videos hing bei ~70 % (4,28 GB, über NPM; kleine gingen) → `POST /api/upload/chunk?id&folder&name&offset&total`
  (32-MB-Stücke aus dem Browser, `.upload-<id>.part` im Zielordner, falscher offset → 409 mit `size`, abgerissenes Stück wird auf offset
  zurückgeschnitten, GET = Stand, alte Teile nach 2 Tagen weg `cleanUploadParts`). Client `uploadChunked` (10 Versuche, Fortsetzen, beforeunload).
  YouTube/TikTok-Upload: `chunkTimeout()` (AbortSignal, mind. 120 s bzw. 150 KB/s), asynchrones Lesen, Hinweis `v.yt/tt.note`, TikTok > 4 GB → Fehler.
  Mock: `MOCK_STALL_AT`, Test mit `UPLOAD_MIN_TIMEOUT_S=3`. **Nicht getestet:** echter Weg über NPM beim Kunden.
- 1.17.0: Aktivitätsleiste unter der Kopfzeile (`activityBar()`/`pollActivity()` alle 2,5 s bei Arbeit, sonst 10 s) aus `GET /api/activity`
  (server[]: Schnitt/Claude/Uploads mit Schritt+Prozent, `waiting` = Schnitt wartet auf Helfer; queue; helper.jobs mit Video aus `job.label` = Video-ID).
  `whisper.transcribe` meldet `onProgress(p, engine)` → Schritt „Sprache erkennen – Rechenhelfer X / Zentrale, Grafikkarte / Prozessor“.
  Achtung Test: VP8/WebM lässt sich nicht per `-c:v copy` in MP4 kopieren (Langfassung „Qavg: nan“) → Testvideos als H.264-MP4.
- 1.18.0 (12.10.2026): **Hook-Schnitt, Tempo, Überarbeiten** (`server/cutfx.js`). Short = Abschnittsliste `parts` [{a,b,hook,rev,zoom}] in Quellzeit;
  `renderShort` schneidet per `concatGraph` (trim/atrim je Teil, `-ss base -t span` auf die Eingabe, Zoom = crop+scale auf Quellmaße, Zurückspulen =
  reverse + setpts=PTS/3 + areverse/atempo), danach Layout wie bisher auf `[cv]`, Untertitel über `mapWords` (Füllwörter nie), Hook-Text `buildHookAss`.
  Claude: `hook {mode preview|cold|none, at, len, text}` in `chooseHighlights` (+ `HOOK_RULES`, Profil `hookStyle` auto|preview|cold|off, `hookHint`);
  `cleanHook()`: preview → cold wenn Höhepunkt < 3 s nach Start, cold → preview wenn danach < 60 %/20 s übrig, LinkedIn nie preview.
  Tempo `profile.tempo` aus|ruhig|normal|schnell: `tempoKeep()` entfernt Wortlücken ≥ gap, wenn ≥ 85 % davon ≥ quiet dB unter dem Clip-Median
  (Lautheit jetzt in 0,1 s: `loudness()` liefert `fine`, optional `range`), Prüfung erst 0,4 s nach dem Wort (M-Fenster hinkt), max. 35 % raus.
  `v.edit {hook, tempo, parts, how}`, `source.hook/tempo`. **Überarbeiten:** `POST /api/videos/:id/revise {wish}` → Warteschlange `{revise, wish}`
  (vor Schnitten), `runRevision` → `ai.reviseShort()` (Fenster ±60 s, Transkript mit Zeiten, 6 Standbilder, Schema start/end/hook/tempo/music/changes/viral)
  → `<Name> vN.mp4` mit `revisionOf/revisionRoot/revisionWish/revisionChanges`, `out.revise {state, step, newId}`; `POST /keep-revision` legt die
  vorherige in den Papierkorb. `canRevise` = true oder Grund. UI `renderRevise()` (Chips, Wunsch, v2-Kasten). Mock: Hook + `changes`-Schema,
  `FAKE_WHISPER_DENSE`. Getestet: 35-s-Clip → 25,6 s (11,8 s Pausen raus), Hook-Text/Zoom/Zurückspulen im Bild, cold zu kurz → preview, Revision v2 ohne Musik,
  Behalten. **Nicht getestet:** echte Claude-Hooks, echte Spielaufnahmen (Schwelle 85 %/dB evtl. nachjustieren), NVENC mit vielen Teilen.
- 1.19.0: Überarbeiten auch für `source.kind` long/summary: `ai.reviseLong()` (Transkript in ~20-s-Blöcken bis 120k Zeichen, 25 lauteste 5-s-Fenster,
  4–10 Standbilder, Schema segments[]/teaser{use,at,len,text}/tempo/music/title/changes; Abschnitte sortiert+zusammengeführt, ≥ 3 s) →
  `reviseLongVersion()`: Lautheit ganze Datei, `tempoKeep` je Abschnitt, Langfassung `renderLong(…, teaser)` (Teaser = 2. Eingabe `-ss at -t len`,
  concat vor die select-Fassung, Hook-ASS), Kurzfassung `renderSummary(…, teaserText, teaserLen)` (Teaser als erster Teil). Langfassung speichert jetzt
  `source.keep`. Kunde wünschte ausdrücklich „Intros rausschneiden“ → Chip + Regel im Prompt. UI: `REVISE_CHIPS_LONG`, Ziellänge (Min.).
  Getestet (Mock): 150-s-Aufnahme → Langfassung v2 1:01 mit Teaser, Intro weg, Kurzfassung v2. Ton aller Shorts/Kurzfassungen jetzt 48 kHz (`aresample`).
- 1.20.0: Kunde fragte, warum nicht nach dem Viral-Potenzial geschnitten wird (Bewertung kommt erst nach dem Schnitt aus `ai.suggest`).
  Jetzt `autocut.tipsWish(v)` (viral.hook/edit, sonst tip) → Überarbeitung; `ai.afterSuggest(fn)` ruft nach jedem Vorschlag `autoApplyTips(v)`:
  nur `geschnitten`, nicht bei `revisionOf` (keine Schleife), einmal (`v.tipsApplied`), Score < 9, Schalter `db().ai.autoTips` (Standard an).
  `POST /api/videos/:id/apply-tips`, UI `tipsAction()` in der Viral-Box. Getestet (Mock): Vorschlag → automatische v2, Knopf von Hand.
- 1.21.0 (12.10.2026): **Effekte** – Claude plant je Short `fx[]` (at in Quellzeit, kind emoji|sound|flash|text|shake|punch|freeze|replay|sticker,
  emoji, sound-ID, soundIdea, text, pos, sticker) in `chooseHighlights`/`reviseShort` (`FX_SCHEMA`, `FX_RULES`, `fxLevelOf(profile, wish)`).
  `cutfx.applyFx()`: Stufen `FX_LEVELS` (aus/dezent/normal/viel: Anzahl, Arten, Lautstärke), ≥ 1,2 s Abstand; freeze/replay/punch ändern die Abschnitte
  (freeze = tpad-Standbild + aevalsrc-Stille, replay = speed 0.5 mit atempo, punch = Zoom 1.18; in Pause → nächster Abschnitt), sonst Zeitpunkte über `outTime()`.
  Automatisch: Zurückspulen → Sound `rewind` + ⏪ + VHS-Look (noise/eq/drawbox), Hook-Vorschau → `boom`. `renderShort`: shake = crop mit sin-Ausdrücken,
  Texte `buildFxAss`, Blitz = color-Quelle mit Alpha-Fade, Emojis/Sticker = PNG (`-loop 1`) → pad 512 → **zoompan** (Pop, zentriert) → rotate → fade →
  overlay (scale eval=frame + overlay mit wechselnder Größe geht NICHT). Sounds: `adelay` + `amix normalize=0` + alimiter.
  `server/sfx.js`: Baukasten `LIBRARY` (30, Sonilo text-to-sound-effects, 0,0018 $/s, auf −16 LUFS normalisiert → `musik/sfx/ki/<id>.m4a`), eigene
  `musik/sfx/*.mp3` (Name = ID, Vorrang), Sonder-Sounds `x-<sha1>.m4a`; Routen `/api/sfx`, `/api/sfx/build`, `/api/sfx/file/:id`. Emojis: Noto Emoji 2D
  (Apache 2.0, `assets/emoji/` 256 px + `emoji.json`; 3D-Variante bewusst nicht – Lizenz nicht eindeutig), Dockerfile `COPY assets`.
  Sticker: `thumbs.makeSticker()` (nano-banana/edit mit Kanal-Foto bzw. nano-banana, dann BiRefNet, Cache `/data/sticker`). Profil `fxLevel`, `fxImages`.
  UI: Kanal-Felder, Kasten „🔊 Soundeffekte“ (Vorhören, Baukasten erzeugen), Chips Mehr/Weniger/Ohne Effekte, **v2-Abzeichen** in der Liste (`hasNewer`).
  Getestet (Mock): Short mit Emoji, Freeze, Zeitlupe, Wackeln, Blitz, Sticker, 7 Sounds (inkl. Sonder-Sound). **Nicht getestet:** echte Sonilo-Sounds/
  Lautstärke-Balance mit echter Stimme, echte Sticker aus Kundenfotos, NVENC mit vielen Eingaben.
- 1.22.0: **Guthaben-Warnung** (`server/credits.js`, `db().credits {fal, claude: {topup, at, spentAt, warnBelow}, alerts, live, falReadKey}`).
  fal: `GET https://api.fal.ai/v1/account/billing?expand=credits` (Recht billing:usage:read → eigener Nur-Lese-Schlüssel `falReadKey`, normaler Schlüssel
  darf meist nicht; Feld defensiv `credits.current_balance|balance|…`, nur gegen Mock getestet), alle 6 h + Knopf. Claude: keine Abfrage möglich → Schätzung
  `topup − (ai.spent − spentAt)`. Fehler: `credits.falError(status, body)` in allen fal-Aufrufen (402/403 „Exhausted balance/locked“ → Warnung statt
  „Schlüssel ungültig“), `ai.friendly` flaggt Anthropic „credit balance“. Warnungen über `/api/activity` (`credits`) → `.act-warn` in der Leiste oben.
  Routen `/api/credits` GET/POST, `/check`, `/dismiss`. Einstellungen → „💳 Guthaben“.
- Beim Kunden (11.10.2026): Rechenhelfer auf dem PC (RTX 3070) eingerichtet und **online**. Echte CUDA-Spracherkennung noch nicht bestätigt.
- Achtung `.dockerignore`: `tools` ist ausgeschlossen, nur `!tools/rechenhelfer` erlaubt (1.14.0/1.15.0-Bau schlug deshalb fehl). Neue Ordner,
  die ins Image sollen, dort freigeben.
- Einrichtung beim Kunden (11.10.2026): Zentrale läuft über `https://videos.flexisticker.de` (NPM, Access List „Nur Heimnetz“,
  lokaler UniFi-DNS-Eintrag → 192.168.1.111). Browser zeigte trotzdem 403: Chrome/Edge „Sicheres DNS“ fragte Google/Cloudflare
  (öffentliche IP) → ausschalten bzw. „aktueller Dienstanbieter“, `net-internals/#dns` leeren. Prüfung: `curl -I` am PC.
  Google: Projekt „Video Zentrale“, Google Auth Platform (Branding braucht Datenschutz-/AGB-Link → `www.flexisticker.de/…`),
  Client Typ Webanwendung, Redirect `https://videos.flexisticker.de/oauth/google`. TikTok: Entwicklerkonto per E-Mail, Domain
  `flexisticker.de` per DNS-TXT bei Alfahosting bestätigt, **Sandbox** (Key beginnt mit `sb`, eigenes Secret!), Produkte über
  „Add products“ (Login Kit mit Redirect URI unter Web, Content Posting API), Target Users michamodus + 3dbymicha.
  **Beide Plattformen verbunden.** App-Icon `docs/app-icon-1024.png`. Demo-Video aus der Sandbox am 11.10.2026 vom Kunden aufgenommen, Einreichung der Prüfung läuft.
  Nach Freigabe: Production-Client-Key/Secret (anders als Sandbox!) in der Zentrale eintragen, Kanäle neu verbinden.
- 1.23.0 (12.10.2026): **Ordnung** (`server/organize.js`, `db().org {enabled, rename, folders, rawDays, log[]}`): Videos dürfen in Unterordnern liegen
  (`v.file` relativ mit `/`, `library.walk` bis 4 Ebenen, `relocate()` verschiebt samt Begleitdateien, leere Ordner weg; extern verschobene Dateien
  über Name+Größe wiedererkannt). `desired(v)`: Rohvideo `rohvideos/<Kanal>/<JJJJ-MM>/<Thema>/JJJJ-MM-TT HH-MM <Thema> – Rohvideo`, Ausgaben
  `JJJJ-MM-TT [Thema – ]Titel (Short|Langfassung|Kurzfassung|LinkedIn-Clip)[ vN]`, hochgeladen `<Kanal>/<JJJJ>/<MM>`, geschnitten nur umbenennen.
  Thema = `ai.game` (Rohvideo: häufigstes der Kinder), ohne Thema bis 2 Tage warten. Nie bei Upload/Schnitt/Überarbeitung, `orgLock` nach Rückgängig.
  Läuft nach Vorschlag/Upload (`org.soon`) + stündlich. Aufräumen: Rohvideos älter `rawDays`, alle Kinder hochgeladen/Papierkorb/gepostet → Papierkorb.
  Routen `/api/org[/config|/run|/undo|/cleanup]`, `/api/videos/bulk {action trash|restore|delete, ids}`. UI: Reiter 📚 Bibliothek (`renderLibrary`),
  Einstellungen → Ordnung, Mehrfachauswahl (`S.sel`, `.selbar`), Filter Thema/Monat, Gruppierung (`localStorage vz-group`).
  Überarbeiten-Prompts sagen jetzt ausdrücklich: neu aus dem Rohvideo, Weggeschnittenes darf zurück (Short-Fenster ±120 s, Langfassung mit Abschnittsliste).
  **Regel: Rohvideo nie löschen, solange daraus noch überarbeitet werden soll** (Aufräumen nur nach Hochladen aller Kinder).
  Getestet (curl + Playwright): Ordnen, Neuscan ohne „fehlt“, Rückgängig, Mehrfach-Papierkorb/Wiederherstellen, Bibliothek 390 px. **Nicht getestet:** Unraid-Freigabe mit echten Dateien.
- 1.24.0: **Bestand umstellen** – `org.plan()` (Vorschau moves/skipped/noTopic, `GET /api/org/plan`), `org.convert()` (`POST /api/org/convert`, `now: true` =
  ohne Thema-Wartezeit), `org.detectTopics()` → `ai.detectTopics()` (20 Videos je Aufruf, Text: Titel/Datei/Beschreibung/Summary/Tags/Transkript, ohne Text 1 Standbild,
  effort low, Schema items[{id enum, game}]) → `v.orgTopic` (`orgTopicBy` Claude|Hand), Stand im Plan (`topics`). `POST /api/videos/:id/topic` (✎ Spiel in der Bibliothek).
  `topicOf`: v.orgTopic › Rohvideo.orgTopic › ai.game › Rohvideo.ai.game › Kinder. Rohvideo = `!source && folder rohvideos` (ältere Videos ohne `source` in hochgeladen
  sind fertige Videos; Hochformat → „(Short)“). Wartezeit ohne Thema nach Dateizeit (`mtime`), nicht `createdAt` (Bestand wird beim ersten Scan neu angelegt).
  UI `convertDialog()`, Hinweiszeile `.alert-line` in der Bibliothek bei `pending`. **Achtung DOM:** `replaceChildren(…, null)` schreibt „null“ → vorher filtern.
- 1.24.1: Kurzfassung „Error while processing the decoded data … Conversion failed“ beim Kunden = **Speicher voll**: `[0:v]trim` je Baustein auf der ganzen Aufnahme,
  Bausteine nicht chronologisch → ffmpeg puffert Rohbilder (nachgestellt mit `ulimit -v`: „Cannot allocate memory“). `renderSummary` jetzt mit eigener Eingabe je
  Baustein (`-ss/-t -i`, Graph per `-filter_complex_script`, Musik `idx = reel.length`). `lastError()` zeigt die Ursache vor „Conversion failed“.
  **Gleiches Muster** steckt in `concatGraph` (Shorts, Hook-Vorschau vorne → Puffer bis zur Hook-Stelle, max. Clip-Spanne) – bisher ohne Fehler beim Kunden.
- 1.25.0 (13.10.2026): **Saubere Schnittgrenzen** (Kunde: „oft mitten im Satz abgeschnitten“; Recherche Opus Clip/ClipsAI/StreamLadder: Wort-Zeitmarken +
  Satz-/Themengrenzen, Sprechpausen, Bildwechsel). `server/bounds.js`: `numbered(segs)` (S1 …), `sentenceLines()` („S12 [312.4–315.8] Text“ für Claude),
  `fromSentences()`, `snapRange(start, end, {sents, words, fine, scenes, dur, minLen, maxLen})` (Start auf Satzanfang −0,25 s nach vorigem Wort, Ende auf
  Satzende + leiseste Stelle bis 0,9 s vor dem nächsten Wort, Satz zu Ende bis +6 s, Maximallänge darf +5 s überziehen, sonst letztes Satzende; ohne Sprache
  Bildwechsel ±1,5 s bzw. leiseste Stelle; nie im Wort), `snapHook()`, `protectWords()` (Langfassung: Pausen nicht in Sätze), `sentenceBlocks()` (Kurzfassung).
  `whisper.sentences()`: Grenze bei Satzzeichen oder Pause ≥ 0,7 s, > 30 Wörter/15 s an größter Pause (Komma bevorzugt) geteilt.
  ai.js: `SENTENCE_RULES`, Schemas mit `fromSentence/toSentence` (0 = ohne Sprache → Sekunden) in chooseHighlights/chooseSummary/reviseShort/reviseLong
  (reviseLong mit Satzliste bis 150k Zeichen, sonst 20-s-Blöcke). **`cutCall()`**: gestreamt (`beta.messages.stream().finalMessage()`), `max_tokens` 64000,
  Effort `ai.cutEffort` (medium|high|xhigh|max, Standard **max**, Einstellungen → Claude), Abbruch bei `max_tokens` mit Hinweis. autocut: Einrasten nach
  Auswahl (Shorts, Kurzfassung, Überarbeitungen, Teaser), Hinweis „Grenzen: ganze Sätze / Eingerastet: …“ in der Notiz. Rechenhelfer Standard **large-v3**
  (Migration `migMaxCut` von large-v3-turbo). Mock: SSE-Antworten bei `stream: true`, Satzwahl. Getestet (Mock + fake-whisper, 180-s-Aufnahme): Shorts/
  Kurzfassung/Langfassung/Überarbeitungen auf Satzgrenzen, effort max gestreamt, Einstellung speichern. **Nicht getestet:** echte Claude-Antworten mit Satznummern,
  Kosten bei effort max (geschätzt 0,20–1 $ je Aufnahme), large-v3 auf dem Kunden-PC.
- 1.25.1 (18.10.2026): Unraid-Icon. Dockerfile-Label `net.unraid.docker.icon` = raw.githubusercontent …/main/public/icons/icon-512.png (Repo öffentlich).
  Unraid nimmt das Label nur, wenn im Container-Template kein Icon steht → sonst „Icon URL“ (erweiterte Ansicht) von Hand setzen.
- 1.26.0 (18.10.2026): TikTok-Prüfung abgelehnt wegen **Website URL** (videos.flexisticker.de nur im Heimnetz). **Öffentliche Info-Seiten** `server/info.js`
  unter `/info` (+ `/nutzungsbedingungen`, `/datenschutz`, Kurz `/terms` `/privacy` 301, `/info/style.css`, `/info/icon.png`), vor jeder Anmeldung in
  `createServer` (`info.handle`), nur GET/HEAD, kein JS. Kontakt/Impressum aus `db().publicInfo {company, contact, imprintUrl (Standard
  freigabe.flexisticker.de/impressum), privacyUrl}`, Routen `/api/public-info` GET/POST, Kasten „🌐 Öffentliche Info-Seite“ (Einstellungen, `#s-info`).
  **NPM:** Proxy Host videos.flexisticker.de → Advanced: `location ^~ /info { allow all; proxy_pass http://192.168.1.10:8094; proxy_set_header Host $host; }`
  – Access List „Nur Heimnetz“ bleibt für alles andere. TikTok: Website `https://videos.flexisticker.de/info`, Terms `…/info/nutzungsbedingungen`,
  Privacy `…/info/datenschutz`. Kurzzeitig lagen die Seiten im Flex-Studio-Portal (Flex-Studio 2.51.0) – auf Wunsch des Kunden wieder entfernt (2.51.1).
  Texte bei geänderten Scopes/Funktionen mitpflegen. **Nicht getestet:** NPM-Block beim Kunden, Aufruf von außen.
- 1.26.1: Info-Seite beschreibt **Direct Post als Hauptweg** (Kunde: nach TikTok-Freigabe soll direkt live gepostet werden), Entwurf/Posteingang nur Alternative.
  Nach der Freigabe: Production-Schlüssel eintragen, „Direkt veröffentlichen“ (`tiktok.directPost`) an, Kanäle neu verbinden (Scope video.publish).
  **Beim Kunden eingerichtet (18.10.2026):** NPM-Version mit Access List je Custom Location → Access List „Öffentlich“ (Satisfy Any, allow 0.0.0.0/0 + ::/0),
  Custom Location `/info` → 192.168.1.10:8094 mit „Öffentlich“; Proxy Host selbst weiter „Nur Heimnetz“. `/info` von außen erreichbar (Kunde bestätigt),
  TikTok-Prüfung neu eingereicht. Achtung: „Publicly Accessible“ im Reiter Details würde die ganze Zentrale öffnen.
- **Ideen-Plan „Virale Clips“ (19.10.2026):** `docs/ideen-plan-virale-clips.md` (Recherche mit 5 Agenten). Kunde: streamt live auf **Twitch + TikTok**
  (OBS → Twitch, OBS-Virtual-Cam → TikTok Live Studio), lädt bisher das **Twitch-VOD** herunter (keine OBS-Aufnahme, eine Tonspur), Full HD **30 fps**,
  Facecam-Position wechselt. Empfehlung an ihn: OBS automatisch mitaufnehmen (Stream-Encoder, Spuren 1 alles / 2 Mikro / 3 Spiel).
  Paket A + B + Freigabe-Wünsche = **1.27.0 gebaut**. Paket C Teil 1 (Grafikkarte von Hand freigeben) = 1.28.0. **Offen aus Paket C:** weitere
  Auftragsarten für den PC (Demucs = Stimme aus dem VOD, Audio-Ereignisse, OCR Spieltexte, WhisperX) – braucht Python/Modelle auf Windows, nicht gebaut.
- 1.27.0 (19.10.2026): **Momentfindung/Bildaufbau/Prüfung/Twitch/Zahlen.**
  - `server/signals.js`: Tonspuren (`audioTracks`, `voiceIndex` aus `cut.voiceTrack` auto = Spur 2 bei Mehrspur, `voiceUsable`), `prosody()` je Satz (laut +dB
    ggü. Sprech-Median, Tempo, Ausruf, `HYPE`-Wörter, Wiederholung, Whisper-Ereignisse) → `annotate()` (bounds.sentenceLines zeigt `(tag)`), `timeline()` je Sekunde,
    `peaks()` (Fenster 22 s vor/14 s nach dem Moment, forced = Twitch-Clips/Marker/Claude-Späher mit Bereich, Labels werden zusammengeführt, `min` schwache).
    Alte `candidates()` nur noch für die Kurzfassung ohne Sätze. whisper.js: `[Lachen]` usw. → `words.events` (`eventKind`), im Transkript gespeichert (`loadEvents`),
    `transcribe(…, {track})`. `loudness(…, track)`.
  - ai.js: `scoutMoments()` (ganze Abschrift mit Tonfall + Twitch-Zeilen, effort high, Schalter `ai.scout`), `chooseHighlights(…, {sents})` mit **Kontaktbögen**
    (`vision.contactSheet` 3×3, Sekunde eingebrannt – drawtext VOR fps, sonst falsche Zeit) + `LAYOUT_SCHEMA` (mode cam|crop|blur, cam in %, focus) → `layoutRaw`;
    `reviseShort` mit 3 Kontaktbögen (Clip/davor/danach), Tonfall, bisherigem Layout und QC-Mängeln; `reviewClip()` (QC, effort medium, Schalter `ai.qc`);
    `setExamples()`/`examplesFor()` (Top/Flop aus stats.js in Highlights, Späher, Überarbeiten, Coach). `cutCall(…, {effort})`.
  - `server/vision.js`: `refineBox()` legt Claudes Facecam-Schätzung an echte Kanten (Mittelbild aus 16 Graustufenbildern, Kantensuche ±20 %). `server/layout.js`:
    Graph cam (Facecam-Seitenverhältnis 4:3–16:9 oben, Spiel-Ausschnitt um focus) / crop / blur, Reaktion = fx `cam` (1080×1080 Facecam oben per overlay enable).
    autocut: `resolveLayout()` (feste Facecam `cut.facecam.enabled` hat Vorrang, `facecam.auto`), Hook-Text an die Naht (`buildHookAss({top})`), Emojis unter die Naht,
    **kein Zoom im cam-Layout** (Zoom auf der Quelle verschiebt die Facecam). `concatGraph` = **eine Eingabe je Abschnitt** (Speicher-Falle behoben). Shorts `hq` (NVENC p6 cq19 / x264 medium crf19, lanczos).
    Migration `migVarLen`: shortMin/Max 30/45 → 15/60.
  - `server/qc.js`: blackdetect/freezedetect/silencedetect/ebur128 + Claude-Kontaktbogen 4×3 des fertigen Clips → `v.qc {ok, score, issues, fixWish, lufs}`;
    `tipsWish` nimmt `qc.fixWish` mit, `autoApplyTips` auch bei QC-Mängeln.
  - `server/twitch.js`: Device Code Flow (Client-ID, Secret optional, Scopes user:read:chat user:read:broadcast), EventSub-WebSocket (Node-22-`WebSocket`, Abos
    stream.online/offline + channel.chat.message, session_reconnect), Chat `/data/twitch/chat-<stream>.jsonl` ([ms, text, emotes], keine Namen, 120 Tage),
    `syncVideos` (VODs → streams mit vodId), `clipsFor` (vod_offset), `markersFor`, `matchStream` (VOD-Nr. im Namen › Uhrzeit im Dateinamen › Länge/Datum),
    `signalsFor` (Chat je 10 s ggü. Median, −6 s Versatz, Clips forced, Marker −8 s), `assign`, `importVod` (yt-dlp, Dockerfile `ADD yt-dlp_linux`, Name „… (Twitch v<id>).mp4“,
    Schalter `twitch.vodImport`, 10 Min. nach stream.offline). Env `TWITCH_ID_BASE/API_BASE/WS_URL`, `YTDLP_BIN`.
  - `server/stats.js`: alle 6 h YouTube `videos?part=statistics` (+ Analytics `averageViewPercentage` wenn `youtube.analytics` → Scope yt-analytics.readonly, neu verbinden),
    TikTok `video/list` (wenn `tiktok.statsList` → Scope video.list, braucht TikTok-Freigabe Display API; Zuordnung Zeit/Länge/Text), Twitch-Abgleich; `v.perf {yt, tt}` mit Verlauf;
    `overview()` (relativ zum Kanal-Median, Rangkorrelation Viral-Score ↔ Zahlen), `examples(profile)` ab 6 Videos.
  - Routen: `/api/twitch[/config|/connect|/disconnect|/sync|/import/:stream]`, `/api/videos/:id/twitch`, `/api/stats[/refresh|/config]`, `/api/videos/dedupe {dryRun}`,
    `/api/videos/bulk {action: 'revise', wish}`. `autocut.duplicates()` (je revisionRoot bleibt die neueste; hochgeladene/laufende nie).
  - UI: Reiter 📈 Zahlen (`renderStats`), Freigabe-Sortierung (`S.sort`, vz-sort; viral|neu|zahlen), Sammel-Überarbeiten, „🧹 Doppelte aufräumen“, Chips ✔ geprüft/⚠/👁,
    Detail `renderQc`, Rohvideo: Signale + Twitch-Stream-Auswahl, Einstellungen: Twitch-Kasten (Code-Anmeldung `watchTwitch`), Zahlen-Kasten, Claude Späher/Prüfung, Schnitt: Stimmspur + Facecam automatisch.
  - Getestet (Mock + fake-whisper `FAKE_WHISPER_RICH` + 3-Spur-Testvideo mit Facecam-Rahmen + Playwright): Signale/Tonfall/Lachen, Späher, Kontaktbögen, Facecam-Rahmen
    auf ±1 %, cam/blur/Reaktion im Bild, QC, Langfassung/Kurzfassung/2 Shorts, Sammel-Überarbeiten, Duplikate, YouTube-Statistik + Analytics, Twitch-Code-Anmeldung,
    EventSub-Chat, VOD-Import (fake yt-dlp), 390 px ohne Überlauf. **Nicht getestet:** echtes Twitch (EventSub, Clips/vod_offset, Marker-Recht), echtes yt-dlp mit Twitch,
    echte Claude-Antworten (Facecam-Genauigkeit in %!), YouTube Analytics mit echtem Konto (Device-Flow erlaubt evtl. kein yt-analytics-Scope → Web-Anmeldung nutzen),
    TikTok video.list (Prüfung nötig), NVENC-Qualitätsparameter auf der 1050 Ti (Pascal: spatial-aq/lookahead sollten gehen).
- 1.28.0 (19.10.2026): **Kanal-Trailer / Highlight-Video** (`server/trailer.js`, war „Paket 4 Zusammenstellung“): Kandidaten = Shorts des Kanals
  (geschnitten/hochgeladen, Zeitraum `days`), Punkte aus Viral + Aufrufe ÷ Median + Zuschauer-Clip − QC; Quelle = Rohvideo-Bereich (sonst der fertige Short),
  je Rohstelle eine Fassung, max. 60. `plan()` → `ai.cutCall` (jetzt exportiert, + `SENTENCE_RULES`) mit Satzlisten je Moment → moments[{moment, from/toSentence, start, end, text}],
  title/tagline/outro; Einrasten `snapRange` (2–22 s, max. 25 s), Ziel-Länge +10 %. Ohne Claude `planSimple`. `render()`: je Moment eigene Eingabe, Bild
  `frameFilter` (9:16: `layout.graph` mit dem Layout des Shorts, interne Labels mit Präfix `t<i>`; 16:9: Hochformat-Quellen auf Blur), weißer Einblend-Blitz,
  Intro/Outro-Karten (color + Logo per zoompan-Pop + drawtext Anton), ASS-Texte (Einblendung + Spiel), Wort-Untertitel (nur 9:16, aus Rohvideo-Wörtern),
  Logo-Wasserzeichen, Whoosh je Schnitt (`sfx.get('whoosh')`), Musik `music.trackFor({kind:'trailer'})` (neu: immer wenn Musik an, max. 300 s) + `mixGraph`.
  Ausgabe `geschnitten/<Datum> <Kanal> – Kanal-Trailer|Highlight-Short.mp4`, `source.kind 'trailer'` (nicht überarbeitbar). `db().trailers[]` (Status, max. 50),
  Warteschlange über autocut (`enqueueTrailer`, `{trailer:id}`), Aktivitätsleiste. Logo: `/data/logos/<kanal>.png`, `saveLogo` (rund bei Profilbildern), `fetchLogo`
  (`youtube.channelImage`, `twitch.profileImage`), Routen `/api/trailer` GET (jobs + preview) / POST, `/api/profiles/:id/logo` POST (roh)/GET/DELETE, `/logo/fetch {from}`.
  UI `trailerDialog()` (Knopf „🎬 Trailer“ in Freigabe/Hochgeladen). **Grafikkarte freigeben** (`helper.mode` manual|night|auto, Migration `migRelease` → manual,
  `releaseUntil`, `release(hours|'morning'|'stop'|0)`, `online()` nur wenn `released()`, hello mit paused → Freigabe endet), Routen `/api/helper-release` (UI),
  `/api/helper/release` (Token, vom PC); Rechenhelfer 1.4: `-Release`, Desktop-Verknüpfungen bei `-Install`, `Grafikkarte freigeben.bat`/`sperren.bat`.
  Getestet (Mock + Playwright + pwsh): Logo vom YouTube-Profil, Trailer 16:9 (Intro/Outro/Wasserzeichen, −14 LUFS) und 9:16 (Facecam-Layout aus dem Short,
  Untertitel), Dialog 1400/390 px, Freigabe per pwsh/Knopf, Ende bei OBS. **Nicht getestet:** echte Claude-Dramaturgie, Trailer mit vielen Videos (Laufzeit/Speicher bei
  ~40 Eingaben), echtes Windows (Desktop-Verknüpfungen, PowerShell 5.1), Twitch-Profilbild echt.
- 1.29.0 (19.10.2026): **PC-Analyse** (Rest von Paket C). `server/helper.js` allgemein: `submit(kind, {files, params, timeoutMs, pickupMs})` → `{json, files}`,
  `next(caps)` (Helfer meldet `caps` in hello; alte Helfer nur whisper), Routen `/api/helper/job/:id/file/:name` (GET), `/upload/:name` (POST roh → `/data/helper-out/<job>/`),
  `can(kind)`, `canNow(kind)`; Einstellungen `helper.analyse`, `waitPc`, `waitHours` (12), `ocrWords`. `server/analyse.js`: Ton als FLAC 44,1 kHz stereo + Bilder alle 2 s
  (960 px, ZIP `t000012.jpg` = Sekunde) → Auftrag `analyse` (params demucs nur ohne eigene Stimmspur, events, ocr) → `/data/analyse/<rawId>/result.json` + `voice.wav`,
  `v.analyse {at, events, ocr, voice, device, took | failed, error}` (2 Fehlschläge → nicht mehr). `signals()`: Geräusche → events (laugh/shout/cheer/bang, zusammengefasst),
  OCR-Treffer aus Wörterliste (`DEFAULT_WORDS`, ≤3 Zeichen als ganzes Wort; **kein `\#` in u-Regex!**) → extra (−2 s) + Zeilen für den Späher.
  autocut.runCut: vor den Messungen `WaitForPc` (analyse.needed && !available && shouldWaitPc: Helfer kann analyse, waitPc, nicht `now`, < waitHours) → zurück in die
  Warteschlange mit `cut.waitPc/waitSince/retryAt` (+5 Min.), `next()` überspringt wartende (außer `now` oder PC frei), Timer 60 s. Danach Analyse, Stimme aus Demucs
  (`cut.voiceTrack = 'pc'`, Whisper auf `voice.wav`), Ereignisse/Signale/Späher-Zeilen zusammengeführt (`signals.pc`).
  Rechenhelfer 1.5: `Ensure-Python` (uv von GitHub → `uv venv --python 3.11` + `torch==2.5.1 torchaudio==2.5.1` cu124 + `demucs==4.0.1 transformers easyocr soundfile`,
  Marker `py-bereit-1.txt`, HF_HOME/TORCH_HOME/UV_* im Helferordner), caps whisper+analyse, `Run-Analyse` (Dateien holen, `analyse.py` per Start-Process mit
  Fortschritt aus stdout → hello-Status, Abbruch bei OBS/Spiel über `Wait-Proc`, voice.wav hochladen, result.json schicken). `tools/rechenhelfer/analyse.py`: Demucs htdemucs
  in 10-Min.-Stücken → voice 16 kHz; AST `MIT/ast-finetuned-audioset-10-10-0.4593` (BSD-3) 2-s-Fenster je 1 s auf Stimme (laugh/scream/shout/cheer/cry) und Spielton (bang/cheer);
  EasyOCR de+en (Konfidenz ≥ 0,45). Test-Schalter `VZ_PYTHON` (Stellvertreter-Skript). UI: Chip „🔒 wartet auf PC-Freigabe“, Hinweis im Rohvideo (spätestens …),
  PC-Analyse-Zeile, Helfer-Kasten „🧠 PC-Analyse“. `.gitignore` `__pycache__/`.
  Getestet (Server + pwsh-Helfer 1.5 + fake-python + Mock): Warten ohne Freigabe, Freigabe per `-Release stop` → Analyse → Schnitt mit Stimme vom PC, Lachen/Knall/„VICTORY ROYALE“
  bei Claude. **Nicht getestet:** echtes Python/PyTorch/Demucs/AST/EasyOCR (nur Syntax geprüft; Modelle aus der Sandbox nicht ladbar), Laufzeit/VRAM auf der RTX 3070,
  uv/PowerShell 5.1 auf echtem Windows, Größe/Upload von voice.wav bei mehrstündigen VODs.
- 1.29.1: Beim Kunden brach `Ensure-Python` sofort ab: Windows PowerShell 5.1 macht aus stderr-Zeilen nativer Programme (uv „Downloading cpython …“)
  bei `$ErrorActionPreference='Stop'` einen Abbruch. Jetzt `Invoke-Native` (lokal Continue, Zeilen ins Log, nur `$LASTEXITCODE` zählt), `UV_NO_PROGRESS`.
  **Regel: native Programme im Rechenhelfer immer über `Invoke-Native`.** Rechenhelfer 1.6: Mutex `Global\VideoZentraleRechenhelfer` (zweite Instanz beendet sich,
  Log zeigte zwei gleichzeitige Starts), `-Install` stoppt erst die laufende Aufgabe, Python-Einrichtung erneut alle 30 Min. Getestet mit pwsh (Fake-uv mit stderr, Mutex).
- 1.29.2: Einrichtung beim Kunden lief durch (torch 2.5.1+cu124, CUDA), aber `transformers` 5.x schaltet PyTorch < 2.6 still ab → AST wäre tot gewesen.
  Rechenhelfer 1.7: `transformers==4.46.3` fest (uv-Auflösung für Windows geprüft: huggingface-hub 0.36, tokenizers 0.20), Marker `py-bereit-2.txt` (neue Einrichtung
  läuft automatisch, venv/torch bleiben), Selbsttest `is_torch_available()` + Import ASTForAudioClassification, Ergebnis aus Zeile `SELBSTTEST-OK …`.
  **Nicht auf torch 2.6 gehen:** dort `torch.load(weights_only=True)` als Standard → Demucs-Modelle laden evtl. nicht.
- **Beim Kunden (19.10.2026, 20:29):** Rechenhelfer 1.7 läuft, PC-Analyse eingerichtet: Selbsttest OK (CUDA RTX 3070, torch 2.5.1+cu124, transformers 4.46.3),
  Marker `py-bereit-2.txt`, Mutex greift. **Noch offen:** erster echter Analyse-Auftrag (Modelle ~600 MB laden, Laufzeit/VRAM Demucs/AST/EasyOCR) – Kunde schickt danach
  das Protokoll. Schönheitsfehler fürs nächste Helfer-Update: „·“ erscheint im Log als „┬À“ (PowerShell liest Python-stdout als OEM-Codepage) → im Selbsttest „-“ nehmen
  oder `[Console]::OutputEncoding = UTF8` setzen (auch für PROGRESS-Zeilen mit Umlauten prüfen). Häufige 502/Zeitlimits im Log = Zentrale kurz weg (Updates/NPM), Helfer fängt das ab.
- 1.30.0 (20.10.2026): **Spiegeln, Titelbild vorne, Text-Vorlagen, Facecam aus Gesichtern.**
  - **Spiegeln** (`autocut.toggleMirror`, Route `POST /api/videos/:id/mirror {children}`): Flag `raw.mirror` → `hflip` an der Quelle in `concatGraph`
    (Option `mirror`), `renderLong` (Kopier-Weg aus), `renderSummary`, Trailer (`cand.mirror`); `layout.mirrorLayout` spiegelt cam/cam2/focus (Layouts bleiben
    in Quell-Koordinaten gespeichert). Ausgaben: **Neu rechnen ohne Claude** = `enqueueRerender(out, reason)` → Warteschlange `{rerender}` → `runRerender`
    (gleiche start/end/hook/fx/emph/Layout aus `source`/`edit`, Musik per Name wiedergefunden `sameTrack`, Datei an Ort und Stelle ersetzt `replaceFile`,
    Standbilder /data/ki/<id>-* weg). Eigene Videos ohne `source`: `runFlip` (hflip, Ton copy). Trailer: Hinweis „neu erstellen“. `v.rerender {state, step, reason}`
    in der Aktivitätsleiste. **Regel: Änderungen am Aussehen eines fertigen Shorts (Stil, Bildaufbau, Spiegeln) über `enqueueRerender`, nicht über Überarbeiten.**
  - **Titelbild vorne** (`server/cover.js`): `modeOf(v)` = `v.coverFrame` › `profile.coverFrame` (aus|bild|kurz); `jobs.js` baut vor dem Upload eine Kopie
    (Titelbild auf Videogröße mit Blur-Füllung, 1 Bild bzw. 0,4 s, Ton per adelay verschoben), lädt sie hoch, löscht sie; `v.yt/tt.cover`, `coverError`;
    TikTok Direct Post `video_cover_timestamp_ms: 0`. Route `POST /api/videos/:id/cover-frame {mode}`.
  - **Text-Vorlagen** (`captions.js`): `STYLES` (12, mode hi|reveal|karaoke|single, anim pop|bounce|shake, box = farbiger Kasten nur hinter dem aktiven Wort
    – libass BorderStyle 3 mit `\3c`/`\3a` je Wort, glow, glitch), `buildStyledAss(words, {style, emph, color, posY})`, `buildAss` = klassik; `HOOK_LOOKS`
    (kasten|banner|umriss|neon) in `buildHookAss({look, style})`, Akzentfarbe = erste kräftige Farbe der Vorlage. Schriften (`fonts/`, OFL bzw. Apache):
    Archivo Black, Bangers, Bebas Neue, Luckiest Guy, Permanent Marker, Poppins Black, Rubik Mono One (Bungee verworfen – rendert viel zu klein).
    Claude: `TEXT_SCHEMA` {style, hookLook, emph[{word, emoji}]} in chooseHighlights/reviseShort (`TEXT_RULES`, Kanal fest oder „auto“), `parseText`.
    autocut `textLook()` (Kanal › Claude › klassik; LinkedIn ruhig), `emphFx()` (≤ 2 Emojis an Schlüsselwörtern als fx). `edit.style/hookLook`, `source.emph`.
    Profil `captionStyle`/`hookLook` ('auto'|ID). Routen `GET /api/caption-styles`, `GET /api/caption-preview/:style?look=&poster=1` (3 s mp4 + jpg,
    `/data/vorschau`, `PREVIEW_VER`), `POST /api/videos/:id/text-style`. UI `styleGallery()` (Bild bis das Video läuft – Test-Chromium kann kein H.264).
  - **Facecam** (`server/facecam.js`): Rechenhelfer 1.8 `analyse.py --faces --facemodel` (OpenCV `FaceDetectorYN`, Modell `tools/rechenhelfer/face_detection_yunet_2023mar.onnx`
    230 KB, MIT, geht mit OpenCV 4.10 und 5.0) → `result.faces[{t,x,y,w,h,s}]`, `facesChecked`. `resolve()`: Gruppen nach Lage (`clusters`), Gesicht > 22 % Breite =
    Kamerabild → crop; Claudes Box mit Gesicht drin = bestätigt (+ refineBox wie bisher), sonst `seedFromFace` + `vision.refineBox(radius 0.6, inner = Gesicht)`;
    zweite Lage zeitlich getrennt → `cam2` + `switchAt` (Mitte zwischen letzter alter/erster neuer Sichtung) → renderShort legt zweiten Bildaufbau per
    `overlay enable` (`camSwitchExpr`, Hook-Vorschau-Teile nach Quellzeit) drüber; kein Gesicht im Clip und Box nicht dort, wo sonst Gesichter sind → blur.
    `layout.graph(…, {prefix})` für zwei Aufbauten. Gemerkte Szenen `profile.camScenes` (≤ 8, `profiles.addScene`, `snapScene` IoU > 0,35).
    Editor `camEditor()` (Standbild `GET /api/videos/:id/layout-frame?t=`, Rahmen ziehen/Ecken, Fokuslinie, „merken“) → `POST /api/videos/:id/layout`
    → `edit.layout {manual}` + neu rechnen. Rechenhelfer meldet caps `faces`; Log-Encoding UTF-8 (`Get-Content -Encoding UTF8`), Selbsttest ohne „·“.
  - Getestet (Mock-Claude + fake-whisper + Playwright; Gesichter mit echtem YuNet auf nachgestelltem 3-Min-Stream mit wanderndem Kamerafenster):
    Spiegeln Short + 4 Geschwister + eigenes Video, Titelbild vorne (Bildzahl +1 bzw. +12, Ton versetzt) inkl. Mock-YouTube-Upload, alle 12 Stile/4 Looks gerendert,
    Claude-Wahl + Emoji am Schlüsselwort, Stil nachträglich, Facecam aus Gesicht (±2 px an der Kante), Wechsel bei 95 s nahtlos, Editor + gemerkte Szene, 390 px,
    Schnitt ohne Analyse und Überarbeitung unverändert. **Nicht getestet:** echte Gesichter/Licht/Facecam-Rahmen beim Kunden, TikTok-Cover-Feld echt,
    Titelbild-Frame bei echten YouTube-Shorts (ob YouTube das erste Bild als Vorschau nimmt), Stile in echten Browsern (H.264-Vorschau), analyse.py mit echtem PyTorch.
- 1.31.0 (25.10.2026): **Lokale KI (Ollama)** – Kunde: Claude-Kosten zu hoch. Ollama läuft beim Kunden als Docker auf Unraid (`http://192.168.1.10:11434`,
  **nur Prozessor/Xeon**, Modell `qwen2.5:7b-instruct` = reines Textmodell; eingerichtet für die Protokoll-App `flexisticker/MLZ-Protokoll`, dort `server/assist.js`).
  `server/llm.js`: Aufgaben `TASKS` (texte, pruefung, themen, coach, scout, schnitt, ueberarbeiten, trailer), Modus je Aufgabe `claude|auto|lokal`
  (Standard: kleine Aufgaben auto, schnitt/ueberarbeiten/trailer claude; ohne Adresse/PC immer Claude), `db().llm {url, model, ctx, pc {enabled, model}, tasks, stats}`.
  `chat()`: Anthropic-content → Ollama `/api/chat` (format = JSON-Schema, num_ctx, Bilder nur bei Bildverständnis – `/api/show` capabilities bzw. Name, max. 6),
  `fit()` kürzt (Abschriften: markierte Zeilen behalten, Rest gleichmäßig ausdünnen), Pflichtfelder prüfen + 1 Wiederholung, Statistik je Aufgabe/Ort (gespart = Tokens × Claude-Preis).
  **PC**: wenn `pc.enabled` und Helfer `canNow('llm')` → Auftrag `llm` über den Rechenhelfer (Anfrage als Datei `request`). ai.js: **`ask(task, content, schema, {effort, maxTokens})`**
  ersetzt alle direkten Claude-Aufrufe (`cutCall` = Hülle), `canAsk(task)` statt `apiKey`-Prüfungen (autocut, qc, trailer, Vorschlag-Warteschlange). Ohne Bilder: `layoutRaw` wird
  verworfen (Facecam aus Gesichtern/Standard), Bild-Prüfung (`reviewClip`) entfällt (`llm.visionAvailable`). `v.ai.engine`. Routen `GET/POST /api/llm`, `POST /api/llm/test`.
  UI Einstellungen → „🏠 Lokale KI“ (`#s-lokal`, Tabelle je Aufgabe mit Kosten/Ersparnis). CSS: `.settings > .box { min-width: 0 }` (Tabelle schob sonst die Seite am Handy).
  **Rechenhelfer 1.9**: `Ensure-Ollama` (Zip `ollama-windows-amd64.zip` von GitHub latest, 1,6 GB, nach `ollama/`; `OLLAMA_HOST=127.0.0.1:11435`, `OLLAMA_MODELS=ollama-modelle`,
  `/api/pull` des PC-Modells), danach Ollama wieder beenden; `Update-Caps` (llm nur wenn Modell bereit); `Run-Llm` (Anfrage holen, `curl.exe` als Prozess → per `Wait-Proc` abbrechbar beim
  Zocken, Antwort roh an `/result`); Pause beim Zocken → `Stop-Ollama` (Grafikspeicher frei). hello liefert `llm {enabled, model}`. Test-Schalter `VZ_OLLAMA_EXE`.
  Test: `test/mock-ollama.js [port] [modelle…]` (füllt das Schema, `/api/log`). Getestet: Schnitt + Späher + Texte über Server-Ollama (Claude-Kosten unverändert), Rückfall auf Claude bei
  Ollama-Ausfall, Kürzen bei 4k-Kontext (119 von 900 Zeilen, Lacher-Zeile drin), PC-Weg über pwsh-Helfer (6 Bilder), Überarbeiten lokal, 390 px. **Nicht getestet:** echtes Ollama/Qwen
  (Qualität der Clip-Auswahl, Dauer auf dem Xeon – vermutlich Minuten je Aufruf), echtes Windows-Ollama-Zip/CUDA auf der RTX 3070, qwen2.5vl:7b mit 16k Kontext in 8 GB.
  **Merke (wieder passiert):** nie `pkill -f` mit einem Muster, das in der eigenen Befehlszeile steht – beendet die eigene Shell. PIDs aus Dateien bzw. `ps` nehmen.
- 1.31.1 (25.10.2026): Kunde: Claude-API gesperrt (kein Guthaben), „das Teure lokal, Claude nur für Günstiges“, „beide Rechner zusammen“.
  `llm.PRESETS` (sparen = Standard: texte/pruefung/themen/coach claude, scout/schnitt/ueberarbeiten/trailer auto; lokal; claude), `configure({preset})`, Migration `presetV2`
  (unveränderte 1.31.0-Vorgaben → neue). ai.js: `claudeBlocked()` (`ai.blocked {at, reason}` bei Authentication/PermissionDenied/BadRequest „credit|balance|billing“, 6 Std.,
  neuer Schlüssel bzw. `unblock` hebt auf), `ask()` geht bei gesperrtem Claude auch für claude-Aufgaben lokal, `canAsk` = Claude nutzbar ODER lokal bereit.
  Verteilung `pickTarget()` (freierer Rechner, Gleichstand → PC; `busy {pc, server}`), PC-Auftrag nicht abgeholt/abgebrochen → Server übernimmt; Vorschlag-Warteschlange
  `parallel()` = Anzahl Rechner, wenn lokal. Mock: `MOCK_CLAUDE_NO_CREDIT=1` (test/mock.js), `MOCK_OLLAMA_DELAY`. Getestet: Guthaben-Fehler → 1× Claude, danach direkt lokal;
  4 Vorschläge auf Server + PC verteilt.
- 1.32.0 (25.10.2026): Oberfläche/Schritte/Warnungen sagen „KI“ statt „Claude“ (nur Claude-Zugang, Kosten, Guthaben heißen weiter Claude); Vorschlag zeigt
  „erstellt von: <engine>“; `ai.status().usable` = irgendeine KI erreichbar. Modi je Aufgabe jetzt 4 (`llm.MODES`/`MODE_NAMES`): lokal, auto (lokal, sonst Claude),
  claude (**Claude, sonst lokal** – bei jedem Claude-Fehler/Ablehnung/abgeschnittener oder unlesbarer Antwort lokal, `viaLocal` in `ai.ask`), nurclaude (nie lokal).
  `goesLocal(task)` für Bildprüfung/Parallelität. Getestet per Skript (Mock-Ollama, Claude unerreichbar).
- 1.32.1: Kunde: „KI-Vorschlag holen“ → „Claude lehnt die Anfrage ab“ (400, genauer Text noch unbekannt). Standbilder < 1 KB werden verworfen,
  400 mit „image“ → ein Versuch ohne Bilder, jede 400 wird mit Aufgabe ins Container-Log geschrieben (`[ki] Claude 400 …`). Enum `labels`/`ids` ohne Doppelte.
- 1.32.2: Ursache gefunden: 400 invalid_request_error „You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.“
  (Ausgabenlimit in console.anthropic.com). `isBlockErr` erkennt „usage limit“, `blocked.until` aus dem Text (`limitUntil`), `claudeBlocked()` gilt bis dahin
  (sonst 6 Std.), deutsche Meldung in `friendly`. Getestet mit nachgebautem 400 (ohne/mit Mock-Ollama).
- 1.32.3: „null“ im Überarbeiten-Kasten bei Shorts (`sec.append(…, target)` mit target = null → native append schreibt „null“; jetzt gefiltert).
- 1.32.4: Kunde: nach Umstellen „kein KI mehr startbar“ (Claude bis 01.11. gesperrt, lokal nicht bereit). `ai.status().whyNot` nennt die Gründe, Hinweis im KI-Vorschlag mit Sprung zu `#s-lokal`.
- 1.32.5: iPhone: Video-Ansicht breiter als der Bildschirm. Ursache: `.detail` am Handy `1fr` (= minmax(auto)) + `.btn` nowrap → längster Knopf bestimmt die Breite
  (nachgestellt bei 300 px: 19 px Überlauf). Jetzt `minmax(0, 1fr)`, `min-width: 0` für Kinder, ≤ 600 px Knöpfe mit Umbruch + `overflow-x: hidden` am Sheet;
  Spiegeln-Häkchen `label.check` (globale Regel `input { width: 100% }` schob es in die Mitte). **Regel: Grid-Spalten am Handy immer `minmax(0, 1fr)`.**
- 1.32.6: Kunde sah keinen Fortschritt beim Laden des Ollama-Modells auf dem PC (Rechenhelfer 1.9 rief `/api/pull` mit `stream:false` = blockierend,
  ohne hello → nach 90 s „offline“). Rechenhelfer 1.10: `Pull-Model` (HttpWebRequest, NDJSON je Schicht total/completed, alle 5 s Say-Hello + Fenster, Protokoll je 10 %).
  `llm.test()`/`status()` liefern `pc.helperStatus/helperVersion` → Einstellungen zeigen den Ladestand. Mock-Ollama streamt `/api/pull` (`MOCK_PULL_SECS`). Getestet mit pwsh + Mock.
  Rechenhelfer aktualisiert sich nicht selbst → Kunde muss ZIP neu laden.
- 1.33.0 (25.10.2026): **Texte neu erzeugen, Whisper-Halluzinationen, KI-Anzeige im Video.**
  - Eingeblendete Texte: Routen `GET/POST /api/videos/:id/texts` (Hook `source.hook.text`, `source.fx[i].text` für freeze/replay/text; leer → `textOff`, dann kein
    „WARTE …“-Standard), `POST /texts/suggest {wish}` → `ai.rewriteTexts()` (Aufgabe `texte`, effort low, Gesprochenes im Clip mit Sekunden) → nur Vorschlag; Speichern
    = `enqueueRerender('Texte geändert')`. UI `textsEditor()` (Knopf im Spiegeln-Kasten). Beim Rendern `fx.tidyText` (Wortwiederholungen, Länge) + `fx.uniqueTexts` (kein Text doppelt/gleich Hook).
  - Kunde: „ich halte den Projektor“ wiederholte sich in Untertiteln = **Whisper-Halluzination** (Spielstimme/Musik/Stille, `-l de` übersetzt auch englische Spielansagen).
    Whisper jetzt `-mc 0 -sns` (Server + Rechenhelfer 1.11; Flags in whisper.cpp v1.9.5 geprüft), `whisper.dropHallucinations()` in `toWords` **und** `loadWords` (alte Transkripte):
    bekannte Abspann-Sätze (`HALLU`), Wortgruppen ≥ 3 Wörter > 2× direkt hintereinander, Wortgruppe 3–8 Wörter ≥ 4× im Video und > 3 % des Texts. Einzelwort-Wiederholungen („nein nein nein!“) bleiben.
  - KI-Anzeige: `ai.forVideo(id, fn)` (AsyncLocalStorage) um Vorschlag/Schnitt/Überarbeiten/Texte, `ai.activeJobs()` (task, label, engine über `llm.chat({onTarget})`)
    → `/api/activity` `ki[]`; UI `drawWork()` → `.workbox` (sticky oben im Video; **`.modal > .sheet` jetzt `overflow-x: clip` statt hidden**, sonst kein sticky).
  - `runRerender`: `probeVideoLen` vor dem Ersetzen (leere Ausgabe → Fehler, Original bleibt).
  - Getestet: Halluzinations-Filter (Skript), Texte neu erzeugen über Mock-Ollama, Hook im neu gerechneten Bild, Dialog 390 px, KI-Anzeige mit Ollama-Angabe.
  - **Angeboten, nicht gebaut:** Tonspuren je Video beim Import anzeigen + vorhören + Stimmspur wählen (Kunde: Mikro auf eigener OBS-Spur).
- 1.34.0 (25.10.2026): **Cloud-KI + automatische Wahl** (Kunde: „Gemini Flash nehmen wir … die KI soll entscheiden, was wo am besten ist, auch von den Preisen“).
  - `server/cloud.js`: OpenAI-kompatible Chat Completions, Anbieter `fal` (https://fal.run/openrouter/router/openai/v1, `Authorization: Key <fal-Schlüssel>`, Modell
    `google/gemini-3.8-flash`, 0,75/3,75 $ je Mio. – Preise/Modell-ID per Websuche 25.10.2026, **nicht live geprüft**; fal meldet `usage.cost`), `google`
    (generativelanguage …/v1beta/openai, `gemini-flash-latest`), `deepseek` (nur Text, `json_object`), `custom` (URL, z. B. OmniRoute :20128/v1). `db().cloud {providers, blocked,
    spend[JJJJ-MM][id], budgets, strategy sparen|qualitaet}`. Schema per `response_format json_schema strict`, bei 400 → `json_object` + Schema im Text; Pflichtfelder prüfen + 1 Wiederholung.
    Sperre: 401/403 + Guthaben-Texte 6 Std., 429 10 Min. Test-Schalter `CLOUD_<ID>_URL`. Mock `test/mock-cloud.js` (`MOCK_CLOUD_FAIL`, `_NOSCHEMA`, `_COST`).
  - ai.js: Claude-Aufruf herausgelöst (`askClaude`, zählt auch `cloud.addSpend('claude')`, Monatsbudget), Modus **`smart`** (Standard, Migration `presetV3` setzt alle Aufgaben einmalig darauf)
    und `cloud` (ohne Claude). `TASK_REQ` (Mindest-Stufe 1–3, Bilder need/nice), `candidates()` (lokal Stufe 1/Preis 0, Cloud, Claude Stufe 3 mit Denk-Faktor 3; sortiert: Stufe erfüllt ›
    [Qualität] › Bilder › geschätzte Kosten), `askSmart()` probiert der Reihe nach. `NoVisionError` → `reviewClip` ohne Bild-KI = null. Parallel 3 bei Cloud. Stats `cloud:<id>`.
  - Routen `GET/POST /api/cloud`, `POST /api/cloud/test {id}`; UI Kasten „☁️ KI-Anbieter & automatische Wahl“ (`#s-cloud`). Info-Seite nennt fal/OpenRouter/Gemini.
  - Getestet (Skript + Playwright): texte/pruefung → fal mit Bild, themen → lokal, schnitt → fal; 402 → Sperre, lokal übernimmt; kein json_schema → json_object; Einstellungen 1300/390 px.
    **Nicht getestet:** echtes fal-OpenRouter (Modell-ID, `strict`-Schema mit Gemini, Kosten-Feld), Google/DeepSeek echt, Qualität von Gemini bei der Clip-Auswahl.
- 1.35.0 (28.10.2026): **Design-Prüfung nach Apple HIG** (Skill `dickwu/apple-design-skill`, Kunde wollte „drüber gehen“). Bewusst **nur dunkel** (HIG dark-mode.md erlaubt
  das für Medien-Apps). `--accent` #6e4cff / `--accent2` #d92f6a / `--yt` #e0302f / Viral-hot #d93a2b (weiße Schrift ≥ 4,5:1), `--field` Eingabe-Rand, `--focus`.
  PC ≥ 901 px: `.tabs` mit `order` in eigener zweiter Zeile; alle TABS mit Zeichen. `(pointer: coarse)` 44/36 px Tippflächen. `prefers-reduced-motion`,
  `prefers-reduced-transparency`, `prefers-contrast: more`, `:focus-visible`. `h()`: `.modal` → role=dialog/aria-modal, `.close` → aria-label. Globaler Esc schließt
  das oberste Fenster (Videoansicht `data-own-esc`), MutationObserver setzt Fokus auf „×“ und zurück. Offen (nur vorgeschlagen): Reiter-Reihenfolge nach Arbeitsablauf,
  Aktivitätsleiste im Leerlauf ausblenden.
- **TikTok-Prüfung abgelehnt (31.10.2026):** App-Icon (lila/pink Verlauf + Play-Dreieck) „zu leicht mit bekannter Marke verwechselbar“ und
  **„Apps für persönliche oder firmeninterne Nutzung werden nicht freigegeben“** → Production-Freigabe für die Zentrale praktisch ausgeschlossen
  (nicht als öffentliches Produkt ausgeben!). Weiterbetrieb in der **Sandbox**: Inbox-Upload (Posteingang) für die Target Users funktioniert, `tiktok.directPost` aus lassen.
- Ideen danach: „Best of der Woche“ automatisch (Zeitplan), Platz-Einblendungen „Platz 3/2/1“.
- **Offen – Planungstool (angeboten, wartet auf „leg los“):** Reiter „Planung“ mit Wochen-/Monatskalender, Drag & Drop,
  Sendeplätze je Kanal **stellt der Kunde selbst ein** (keine festen Startzeiten), „Einplanen“ auf nächsten freien Platz, Shorts
  eines Langvideos über Tage verteilen, Übersicht Heute/Woche, Lückenwarnung. YouTube `publishAt` erst nach YouTube-Audit
  (bis dahin Erinnerung „jetzt öffentlich stellen“), TikTok zur geplanten Zeit als Entwurf (Direct Post erst nach TikTok-Prüfung).
- Ideen: KI-B-Roll per fal.ai (Video-Modelle), Viralitäts-Bewertung, Hook-Einblendung, Zeitplan.
- Entscheidung Kunde: Auslieferungen immer direkt auf `main` pushen.
- Ideen: Zeitplan (publishAt), Shorts automatisch aus langen Videos, Titelbild-Vorlagen, Untertitel (whisper).
