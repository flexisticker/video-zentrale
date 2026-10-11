# Micha’s Video-Zentrale

Geschnittene Videos mit Titelbild ansehen, Titel/Texte anpassen und für **YouTube** (als privat) und **TikTok**
(als Entwurf im Posteingang) freigeben. Läuft als Docker-Container auf Unraid.

## Ablauf

```
OBS nimmt auf F:\ auf
   └─ OBS-Sortierer (Windows-Aufgabe, alle 5 Min.) ─▶ \\PowerServer\videos\eingang      (Rohaufnahmen)
                                                       \\PowerServer\videos\geschnitten  (Video + Titelbild + .json)
Video-Zentrale (Browser) ── prüfen, freigeben ──▶ YouTube (privat) / TikTok (Entwurf)
                                                       \\PowerServer\videos\hochgeladen  (Archiv, automatisch)
```

- **Automatischer Schnitt:** Jede neue Rohaufnahme in `eingang` wird ausgewertet (Lautstärke je Sekunde, Bildwechsel,
  Sprache per Whisper) und geschnitten: **Langfassung** (ruhige Abschnitte – Menü, Pause, Laden – über 20 s heraus,
  Schnitte an Keyframes ohne Neukodieren des Bildes, Ton auf −14 LUFS) und **bis zu 3 Shorts** (30–45 s, 9:16 aus der
  Bildmitte, neu kodiert). Die Short-Stellen wählt **Claude** aus den ~12 auffälligsten Kandidaten (Standbild + Lautstärke +
  Gesagtes), ohne API-Schlüssel die lautesten Stellen. Ergebnisse → `geschnitten` (mit Claude-Vorschlag), Original → `rohvideos`.
  Sicherungen: ohne Tonspur oder wenn mehr als die Hälfte wegfiele, wird nichts gekürzt. Läuft nacheinander mit niedriger Priorität.
- **Nachtbetrieb:** unter Einstellungen → Automatischer Schnitt ein Zeitfenster (Standard 01:00–07:00) einschalten – neue
  Aufnahmen warten dann bis zum Fensterbeginn (Kachel zeigt „🌙 schneidet ab …“). „Jetzt schneiden“ im Detail geht trotzdem sofort.
- **Shorts im Detail:** animierte Untertitel Wort für Wort (Schrift Anton, gesprochenes Wort farbig, Farbe einstellbar),
  optional **Facecam-Layout** (Facecam oben, Spiel unten – Bereich einmal unter Einstellungen → Automatischer Schnitt
  auf einem Standbild markieren). Kodiert wird auf der **Grafikkarte** (NVENC), wenn verfügbar, sonst Prozessor.
  Unraid: Extra Parameters `--runtime=nvidia`, Variablen `NVIDIA_VISIBLE_DEVICES=all`, `NVIDIA_DRIVER_CAPABILITIES=all`.
- **Titelbilder:** Fotos von dir (verschiedene Gesichtsausdrücke) unter Einstellungen → Titelbilder hochladen; mit fal.ai
  werden sie automatisch freigestellt (BiRefNet „Portrait“, ca. 0,1–0,2 Cent). Claude plant je Video 3 Varianten
  (Standbild, Gesichtsausdruck, 2–4 Wörter, Seite); die Zentrale baut sie mit ffmpeg (1280 × 720, Kanalfarbe).
  Variante 1 wird automatisch Titelbild, solange keins da ist. „✨ KI-Aufwertung“ schickt eine Variante an
  FLUX Kontext (fal.ai, ca. 4 Cent) → Variante 4. Nur für Querformat (Shorts/TikTok-Cover wählt man in der App).
- **KI-Titelbild:** Claude beschreibt zu jedem Video eine passende Szene + Bildtext; Nano Banana (fal.ai, ca. 4 Cent) malt daraus
  mit deinem Foto und einem Standbild ein komplettes Titelbild (Variante 5, wird bevorzugt als Titelbild gesetzt). Automatisch
  (abschaltbar unter Einstellungen → fal.ai) oder per Knopf „✨ KI-Titelbild erzeugen“ im Detail.
- **Hintergrundmusik:** eigene Titel (z. B. von Epidemic Sound) nach `\\PowerServer\videos\musik` legen – für alle Kanäle direkt
  dort, nur für einen Kanal in `musik\<kanal-id>` (z. B. `musik\michamodus`), nach Stimmung in Unterordnern `episch`, `lustig`,
  `spannend`, `chillig`, `energisch`, `fröhlich`, `traurig`. Claude wählt je Short Stimmung + Musikstil. Gibt es keinen passenden
  Titel, erzeugt fal.ai **KI-Musik** (Sonilo text-to-music, laut Anbieter kommerziell nutzbar, 0,0025 $/s ≈ 0,15 $/min; Datei +
  Nachweis mit Prompt in `musik\ki`). Gemischt unter die Stimme (Musik ca. −28 LUFS, Stimme −14 LUFS) mit Ducking. Standard: in Shorts
  an, Langfassung aus. Einstellungen → Hintergrundmusik; Musikstil je Kanal in den Kanaleinstellungen.
- **LinkedIn (als Person):** Kanal „LinkedIn“ (nur Download, kein automatischer Upload). Rohvideos nach `\\PowerServer\videos\eingang-profi`
  → automatisch LinkedIn-Kanal, Profi-Schnitt (Clips 4:5 / 1:1 / 16:9, ruhige Untertitel in Lato, keine Musik), Claude schreibt Beitrag in Ich-Form
  + 3–5 Hashtags. Im Video: Video/Titelbild herunterladen, Beitrag kopieren, „Als gepostet markieren“ (→ Archiv). Auch jedes andere Video kann
  von Hand auf den Kanal LinkedIn gestellt werden. Claude schlägt LinkedIn nie selbst vor.
- **Schnitt nach Wunsch:** im Video (Eingang/Rohvideos) festlegen: Langfassung ja/nein, Anzahl Shorts/Clips, Kurzfassung (1–10 Min.,
  beste Stellen am Stück, Claude wählt aus 15-s-Bausteinen) und einen Wunsch in Worten („nur den Bosskampf“). Tipp: „Automatisch schneiden“
  aus oder Nachtbetrieb an, dann bleibt Zeit, den Plan vorher einzustellen.
- **Papierkorb:** „🗑 Löschen“ im Video (mit Abfrage) → Ordner `papierkorb`, dort wiederherstellen oder endgültig löschen, „Papierkorb leeren“;
  automatisch nach 30 Tagen (Einstellungen → Allgemein, 0 = nie).
- **📱 Zum Posten:** Reiter für das Handy – alles, was noch von Hand gepostet werden muss (TikTok-Entwürfe ohne Text, LinkedIn), mit
  „Text kopieren“ und „Gepostet“.
- **TikTok direkt veröffentlichen (Direct Post):** Einstellungen → TikTok-App → „Direkt veröffentlichen erlauben“ (in der TikTok-App Direct Post +
  Scope `video.publish` freischalten, Kanäle neu verbinden). Im Video „▶ Direkt auf TikTok posten …“: Kontoinfo live, Vorschau, Titel, Sichtbarkeit
  ohne Vorauswahl, Kommentare/Duett/Stitch, Offenlegung (Deine Marke / Markeninhalt, Markeninhalt nicht privat), Zustimmung Musiknutzung.
  Ohne TikTok-Prüfung nur „Nur ich“.
- **Sicherung:** Einstellungen → 💾 Sicherung. Täglich automatisch (Standard 03:30, 14 aufheben) nach `/data/sicherung`
  (= `/mnt/user/appdata/video-zentrale/sicherung`), „Jetzt sichern“, „Sicherung herunterladen“ (ZIP), Wiederherstellen aus Datei oder
  Server-Liste (vorher automatische Sicherung „vor-wiederherstellung“). Enthält Kanäle, Verbindungen/Schlüssel, Einstellungen,
  Videodaten, Fotos, Transkripte – nicht die Videos/Musik. Datei sicher aufbewahren (enthält Schlüssel).
- **Versionierung:** Version oben rechts (Klick = Versionen / Was ist neu), Build-Nummer/Commit/Datum setzt die GitHub Action.
  Nach einem Update zeigt die Zentrale einmal „Was ist neu“. Alle 6 Std. wird auf ghcr.io nachgesehen, ob ein neueres Image da ist
  (Label `de.flexisticker.version`) – dann leuchtet „⬆ Update“.
- **Sprache → Text (Whisper):** whisper.cpp im Container, Modell (Standard „small“, ~470 MB) wird beim ersten Mal von
  huggingface.co nach `/data/whisper` geladen. Läuft auf der **Grafikkarte** (CUDA, gleiche Unraid-Einstellungen wie NVENC),
  sonst automatisch auf dem Prozessor. Transkript im Detail aufklappbar (Klick auf Zeit springt im Video), geht an Claude.
- **Kanäle:** jedes Video gehört zu einem Kanal (Start: **MichaModus** = Gaming, Standard; **3dbymicha** = gewerblich).
  Je Kanal eigene YouTube- und TikTok-Verbindung sowie Vorgaben (Kategorie, Tags, Text unter der Beschreibung).
  Die Zentrale **schlägt den Kanal vor**: `"channel"` in der .json › Stichwörter des Kanals in Titel/Dateiname (zählen doppelt),
  Tags, Beschreibung › Standardkanal. Im Detail lässt sich der Kanal ändern; die Kacheln zeigen ihn als Abzeichen
  (gestrichelt mit „?“ = Vorschlag), oben gibt es einen Kanal-Filter.
- **Claude schlägt vor:** Für neue Videos unter „Zur Freigabe“ schaut sich Claude 6 Standbilder an und schlägt
  3 Titel, Beschreibung, Tags, TikTok-Text, den Kanal und das beste Standbild als Titelbild (plus kurzen Bildtext) vor.
  Ist noch nichts von Hand oder per .json eingetragen, wird der erste Vorschlag gleich übernommen (bleibt änderbar),
  ohne eigenes Titelbild wird das empfohlene Standbild gesetzt. Im Detail: andere Titel anklicken, einzelne Teile
  übernehmen, mit Hinweis neu vorschlagen lassen. Claude hört den Ton nicht – Inhalte aus Gesprochenem gehen in die Notiz.
  Braucht einen eigenen API-Schlüssel von console.anthropic.com (Guthaben, ca. 2–6 Cent je Vorschlag, Modell Claude Opus 5.5).
- **Zur Freigabe** = Ordner `geschnitten`. Neben `Mein Video.mp4` dürfen liegen:
  `Mein Video.jpg` (oder .png/.webp) als Titelbild und `Mein Video.json` mit Texten:
  ```json
  { "title": "…", "description": "…", "tags": ["gaming", "deutsch"], "category": "20", "tiktok": "Text #gaming", "channel": "MichaModus" }
  ```
- Ohne Titelbild erzeugt die Zentrale ein Vorschaubild aus dem Video. Im Detail: „Aktuelles Videobild nehmen“
  (Standbild aus dem Player) oder eigenes Bild hochladen.
- **YouTube:** Upload immer als **privat** (nicht geprüfte Google-Apps dürfen nichts anderes). Danach in YouTube Studio
  auf „Öffentlich“ stellen – der Knopf in der Zentrale führt direkt hin. Titelbild wird mit hochgeladen
  (Kanal muss bei YouTube per Telefon bestätigt sein). Tageskontingent der API: ca. 6 Uploads.
- **TikTok:** Video landet als Entwurf im TikTok-Posteingang (Benachrichtigung in der App). Text dort einfügen
  (Knopf „Kopieren“ in der Zentrale) und posten. Max. 5 offene Entwürfe in 24 Stunden.
- Nach YouTube **und** TikTok wandert das Video automatisch nach `hochgeladen` (abschaltbar).
- Videos/Titelbilder lassen sich auch per Drag & Drop in die Zentrale ziehen.

## Installation auf Unraid

1. **Freigabe anlegen:** Shares → Add Share → Name `videos` (SMB-Export an, Zugriff für deinen Benutzer).
2. **Container anlegen:** Docker → Add Container
   - Repository: `ghcr.io/flexisticker/video-zentrale:latest`
   - Port: Host `8094` → Container `8090`
   - Pfad: `/videos` → `/mnt/user/videos`
   - Pfad: `/data` → `/mnt/user/appdata/video-zentrale`
   - Variable `TZ` = `Europe/Berlin`
   - Icon URL (erweiterte Ansicht): `http://192.168.1.10:8094/icon.svg`
   - WebUI (erweiterte Ansicht): `http://[IP]:[PORT:8090]/` (ab 1.1 bringt das Image die Angabe selbst mit)
3. Browser: `http://192.168.1.10:8094` → beim ersten Start Passwort festlegen.
4. Updates wie bei Flex-Studio: Docker → „Check for Updates“ → „apply update“.

Das Paket ist privat → Unraid braucht den vorhandenen ghcr-Login (gleicher Token wie für Flex-Studio, `read:packages`).

## OBS-Sortierer (Windows)

`tools/OBS-Sortierer.ps1` + `tools/Installieren.ps1` auf den PC kopieren (z. B. `F:\OBS - VIDEO Aufnahmen\_Sortierer`),
`Installieren.ps1` per Rechtsklick → „Mit PowerShell ausführen“. Ziel ist `\\PowerServer\videos\eingang`.
**Vorher** die Freigabe einmal im Explorer öffnen und „Anmeldedaten speichern“ anhaken.
Fertig = OBS schreibt nicht mehr an der Datei und sie ist seit 2 Minuten unverändert. Protokoll: `OBS-Sortierer.log`
im Aufnahmeordner. Optional MKV → MP4 umpacken und Vorschaubild (braucht ffmpeg: `winget install Gyan.FFmpeg`).

## https-Adresse (für Verbinden mit einem Klick)

Google und TikTok erlauben das Anmelden im Fenster nur über https. Wie bei `studio.flexisticker.de`:
1. DNS: A-Eintrag `videos` → feste IP (bzw. lokaler UniFi-DNS-Eintrag `videos` → 192.168.1.111).
2. Nginx Proxy Manager: Proxy Host `videos.flexisticker.de` → `http://192.168.1.10:8094`, „Websockets“ egal,
   SSL: Let's Encrypt, Force SSL; Access List „Nur Heimnetz“.
3. Zentrale ab dann über `https://videos.flexisticker.de` öffnen – die Einstellungen zeigen die passenden Weiterleitungs-Adressen.
Ohne https bleibt bei YouTube der Weg „per Code“ (google.com/device).

## YouTube verbinden (einmalig, ca. 10 Min.)

1. <https://console.cloud.google.com> → neues Projekt „Video-Zentrale“.
2. „APIs & Dienste“ → Bibliothek → **YouTube Data API v3** → Aktivieren.
3. „OAuth-Zustimmungsbildschirm“: Typ **Extern**, App-Name, deine E-Mail; Testnutzer: dein Google-Konto.
   Danach **„App veröffentlichen“** (Status „In Produktion“) – sonst läuft die Anmeldung nach 7 Tagen ab.
   Eine Prüfung durch Google ist dafür nicht nötig; beim Verbinden erscheint nur „Google hat diese App nicht überprüft“
   → „Erweitert“ → „Weiter“.
4. „Anmeldedaten“ → „Anmeldedaten erstellen“ → OAuth-Client-ID → Typ **„Webanwendung“** mit autorisierter Weiterleitungs-URI
   `https://videos.flexisticker.de/oauth/google` (über die IP-Adresse ohne https stattdessen Typ „Fernseher und Geräte mit begrenzter Eingabe“).
5. Client-ID und Client-Secret in der Zentrale unter Einstellungen → „Google-App“ eintragen. Dann **je Kanal**
   „YouTube verbinden“ → Code unter google.com/device eingeben und dort das passende Konto bzw. den Kanal wählen
   (bei Brand-Konten fragt Google nach dem Kanal). Eine Google-App reicht für beide Kanäle.

## TikTok verbinden (einmalig)

1. <https://developers.tiktok.com> → Konto → „Manage apps“ → App anlegen.
2. Produkte **Login Kit** und **Content Posting API** hinzufügen, Scope `video.upload` (und `user.info.basic`).
3. **Redirect URI** (muss https sein):
   - am schönsten: Zentrale über Nginx Proxy Manager per https erreichbar machen (wie `studio.flexisticker.de`,
     z. B. `videos.flexisticker.de` mit Access-List „Nur Heimnetz“) → `https://videos.flexisticker.de/oauth/tiktok`;
   - sonst irgendeine eigene https-Adresse, z. B. `https://flexisticker.de/tiktok` – nach der Anmeldung die Adresse aus
     der Browserzeile kopieren und in der Zentrale bei „Adresse nach der Anmeldung“ einfügen.
4. App im **Sandbox**-Modus lassen, dein TikTok-Konto als „Target User“ eintragen (für den Entwurfs-Upload reicht das;
   eine Prüfung durch TikTok braucht es erst für direktes Veröffentlichen).
5. Client Key, Client Secret, Redirect URI unter „TikTok-App“ eintragen. Dann **je Kanal** „TikTok verbinden“ –
   vorher im Browser bei TikTok mit genau diesem Konto angemeldet sein (für das zweite Konto bei TikTok abmelden
   oder ein privates Fenster nehmen). Beide Konten in der Sandbox als Target User eintragen.

## Technik

- Node 22 ohne Fremdpakete, ffmpeg im Image. Daten: `/data/zentrale.json` (Videos, Passwort-Hash, Zugänge),
  Vorschaubilder `/data/thumbs`. Videos bleiben unverändert in `/videos`.
- Anmeldung mit Passwort (scrypt), Sitzung 30 Tage, 5 Fehlversuche → 15 Min. Sperre, alle schreibenden Aufrufe
  brauchen den Kopf `X-Zentrale: 1`, CSP ohne Inline-Skripte.
- YouTube: Geräte-Anmeldung (OAuth Device Flow, Scope `youtube`), Upload fortsetzbar in 32-MB-Stücken.
  TikTok: OAuth + Inbox-Upload in 10-MB-Stücken, Statusabfrage bis „im Posteingang“.
- Lokal testen: `DATA_DIR=./data VIDEO_DIR=./videos PORT=8090 node server/index.js`.
  `test/mock.js` bildet die Google-/TikTok-Schnittstellen nach (Umgebungsvariablen `YT_OAUTH_BASE`, `YT_API_BASE`,
  `TT_AUTH_BASE`, `TT_API_BASE` = `http://127.0.0.1:9300`).
