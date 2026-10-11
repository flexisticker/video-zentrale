# Video-Zentrale

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

## YouTube verbinden (einmalig, ca. 10 Min.)

1. <https://console.cloud.google.com> → neues Projekt „Video-Zentrale“.
2. „APIs & Dienste“ → Bibliothek → **YouTube Data API v3** → Aktivieren.
3. „OAuth-Zustimmungsbildschirm“: Typ **Extern**, App-Name, deine E-Mail; Testnutzer: dein Google-Konto.
   Danach **„App veröffentlichen“** (Status „In Produktion“) – sonst läuft die Anmeldung nach 7 Tagen ab.
   Eine Prüfung durch Google ist dafür nicht nötig; beim Verbinden erscheint nur „Google hat diese App nicht überprüft“
   → „Erweitert“ → „Weiter“.
4. „Anmeldedaten“ → „Anmeldedaten erstellen“ → OAuth-Client-ID → Typ **„Fernseher und Geräte mit begrenzter Eingabe“**.
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
