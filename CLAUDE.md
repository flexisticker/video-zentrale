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
- **Offen – Paket 4 Zusammenstellung (angeboten, Kunde will es):** „Best of“ aus mehreren Videos (Zeitraum/Auswahl, 16:9 oder 9:16, Claude
  ordnet Highlights, Platz-Einblendungen), später automatisch wöchentlich. Nach 1.18.0 als eigenes Paket bauen.
- **Offen – Planungstool (angeboten, wartet auf „leg los“):** Reiter „Planung“ mit Wochen-/Monatskalender, Drag & Drop,
  Sendeplätze je Kanal **stellt der Kunde selbst ein** (keine festen Startzeiten), „Einplanen“ auf nächsten freien Platz, Shorts
  eines Langvideos über Tage verteilen, Übersicht Heute/Woche, Lückenwarnung. YouTube `publishAt` erst nach YouTube-Audit
  (bis dahin Erinnerung „jetzt öffentlich stellen“), TikTok zur geplanten Zeit als Entwurf (Direct Post erst nach TikTok-Prüfung).
- Ideen: KI-B-Roll per fal.ai (Video-Modelle), Viralitäts-Bewertung, Hook-Einblendung, Zeitplan.
- Entscheidung Kunde: Auslieferungen immer direkt auf `main` pushen.
- Ideen: Zeitplan (publishAt), Shorts automatisch aus langen Videos, Titelbild-Vorlagen, Untertitel (whisper).
