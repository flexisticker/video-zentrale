# Wie die Video-Zentrale Clips wie die Profis findet

*Ideen-Plan für Micha's Video-Zentrale, Stand 19.10.2026. Noch ist nichts davon gebaut. Losgelegt wird erst, wenn du „leg los“ sagst.*

## 1. Kurzfazit

Beim **Schneiden** ist die Video-Zentrale schon nah an Opus Clip und StreamLadder. Beim **Finden** der Momente und beim **Bildaufbau** liegt sie deutlich zurück, und aus echten Zahlen lernt sie noch gar nicht. Satzgenaue Grenzen, Hook-Vorschau, Wort-Untertitel, Effekte und Musik gibt es schon. Damit deckt die Zentrale genau die Schwäche ab, über die sich Opus-Nutzer am meisten beschweren: Schnitte mitten im Satz und abgeschnittene Pointen ([eesel.ai](https://www.eesel.ai/blog/opusclip-reviews)). Auch die Profi-Tools liefern viel Ausschuss. In einem Test waren 47 von 76 Opus-Clips veröffentlichbar ([ScaleReach](https://www.scalereach.ai/blog/opus-clip-review)), und Submagic lieferte 7 von 12 Clips ohne Nacharbeit ([ScaleReach](https://www.scalereach.ai/blog/submagic-review-for-captions-and-edits)). „Niveau StreamLadder/Opus“ heißt also nicht Perfektion. Es heißt: guter erster Durchgang, den du nur noch aussortierst.

Die vier größten Hebel:

1. **Stimme und Spiel getrennt hören.** Heute hört die Zentrale nur die Mischspur. Ein Schrei und eine Explosion sehen für sie gleich aus. Mit getrennten OBS-Tonspuren plus Erkennung von Lachen, Schreien und Tonfall findet sie Reaktionen statt bloßem Lärm.
2. **Claude mehr sehen und lesen lassen.** Heute sieht Claude nur etwa 10 % einer langen Aufnahme und bekommt je Kandidat genau ein Standbild. Eigene Code-Analyse: Bei 3 h Aufnahme sind das höchstens 30 Fenster à 37 s. Abhilfe: ein Durchgang über das ganze Transkript plus Kontaktbögen (Raster aus 9 Bildern mit Zeitstempel) je Kandidat.
3. **Bildaufbau wie StreamLadder.** Die Facecam wird automatisch erkannt. Bei großen Reaktionen wird sie groß, und es gibt einen Blur-Hintergrund statt des starren Mitten-Ausschnitts.
4. **Aus echten Zahlen lernen.** Opus trainiert seine Auswahl nach eigenen Angaben mit Likes, Exporten und Social-Performance von 6 Mio. Nutzern ([Opus-Blog](https://www.opus.pro/blog/opusclip-celebrates-30m-in-funding-and-the-launch-of-clipanything)). Das können wir im Kleinen nachbauen, mit deinen YouTube-Zahlen und deinem Behalten/Löschen.

**Der Power-PC kann viel übernehmen**: genauere Wortzeiten, Lachen/Schreien erkennen, Texte im Spiel lesen, flüssige Zeitlupe, Rendern. Aber nur nachts bzw. wenn du nicht zockst. Claude ersetzt er nicht.

## 2. Was die Profis anders machen

Die allgemeinen Tools (Opus, Klap, Vizard, Munch) arbeiten im Kern mit dem **Transkript** und vermarkten zusätzlich „visuelle, Audio- und Stimmungs-Signale“, ohne die Methode offenzulegen ([Opus ClipAnything](https://www.opus.pro/clipanything)). Bei Gaming mit wenig Sprache werden sie laut Rezensionen schwach, die Auswahl wirkt dann „zufällig“ ([nemovideo](https://www.nemovideo.com/blog/opus-clip-review-2026)). Ein Herstellerbenchmark von Reap behauptet dagegen das Gegenteil ([reap.video](https://reap.video/reports/state-of-top-ai-video-clipping-tools-2026)). Die **Gaming-Spezialisten** arbeiten anders. Eklipse liest Killfeed und Scoreboard per Texterkennung, achtet auf Tonspitzen und Chat-Tempo ([Eklipse Help](https://eklipse.gg/help/how-does-eklipse-ai-choose-highlights/)) und bietet einen Sprachbefehl „Clip it!“ zum Markieren ([twoaveragegamers](https://www.twoaveragegamers.com/eklipse-review-2026-hands-on-testing-for-streamers/)). Powder erkannte Schreie über die Tonhöhe, außerdem Lachen und Chat-Hype, mit über 40 spielspezifischen Modellen ([TechCrunch](https://techcrunch.com/2023/11/20/powder-an-ai-clipping-tool-for-gaming-can-detect-when-a-creator-yells-during-a-stream/)). Wie StreamLadder ClipGPT Momente findet, ist **nicht dokumentiert**. Belegt sind dort vor allem die automatische Erkennung von Facecam und Gameplay sowie fertige Hochformat-Vorlagen ([navtools](https://navtools.ai/tool/streamladder)).

Der **Virality Score** von Opus bewertet Hook, Flow, Value und Trend ([Opus Help](https://help.opus.pro/docs/article/virality-score)). Rezensenten behandeln ihn als Sortierhilfe, nicht als verlässliche Vorhersage ([thecmo](https://thecmo.com/tools/opusclip-review/)). Beim Bild ist der Standard **Facecam oben, Gameplay unten** (etwa 40/60) ([clypse](https://clypse.ai/blog/how-to-make-vertical-gaming-clips-facecam-2026)), und Opus wirbt mit „dynamischem Layoutwechsel“ ([opus.pro/pricing](https://www.opus.pro/pricing)). Ein bekannter Fehler der Tools: Der automatische Ausschnitt folgt dem bewegten Spiel statt dem Gesicht ([Vyroclips](https://vyroclips.com/opusclip-auto-crop-missing-face-cam-fix)).

In der Forschung zeigt sich ein zweistufiges Muster. Ein Signal (etwa ein Chat-Ausbruch) findet die ungefähre Stelle, ein zweiter Schritt setzt die genauen Grenzen ([LIGHTOR, Microsoft Research](https://www.microsoft.com/en-us/research/uploads/prod/2020/02/icde20lightor.pdf)). So arbeitet die Zentrale schon: Claude wählt aus, danach rastet sie auf Satzgrenzen ein. Was fehlt, sind **bessere Signale für Stufe 1**.

## 3. Ideen-Plan in Stufen

Legende: Nutzen ★ bis ★★★ · Aufwand S/M/L · PC = braucht den Rechenhelfer · Kosten = laufende Kosten je Aufnahme (Claude-Preise laut [Anthropic](https://platform.claude.com/docs/en/build-with-claude/vision), Bildkosten ca. Breite × Höhe / 750 Token).

### Stufe 0: Sofort-Korrekturen (Grundlage, kein Risiko)

| Idee | Nutzen | Aufwand | PC? | Kosten | Abhängig von |
|---|---|---|---|---|---|
| Speicher-Falle beim Short-Schnitt mit Hook-Vorschau beheben (gleiches Muster wie der Kurzfassungs-Fehler aus 1.24.1; bei 1080p könnten bis ~3 GB gepuffert werden) | ★★ (Stabilität) | S | nein | 0 | – |
| Hook-Text und Emojis „oben“ liegen heute genau über der Facecam und verdecken die Reaktion in den ersten Sekunden → an die Naht bzw. in den Spielbereich | ★★ | S | nein | 0 | – |
| Shorts mit 60 fps statt fest 30, bessere Encoder-Einstellungen und schärferes Hochskalieren | ★★ | S | nein | 0 | – |
| Clip-Länge variabel (12–60 s statt fester 37-s-Fenster). Kurze Fails werden heute künstlich gestreckt | ★★ | S | nein | 0 | – |
| Whisper: Lacher-Marker wie „[Lachen]“ behalten statt wegwerfen, Stille-Erkennung (VAD), Spiel-/Kanalnamen als Vorgabe | ★★ | S | nein | 0 | – |
| Endlautstärke auf ca. −14 LUFS / −1 dBTP prüfen. Plattformen regeln nur leiser, nicht lauter ([OpenClip](https://openclip.app/learn/audio-normalization)) | ★ | S | nein | 0 | – |
| Effekte testweise auf „normal“ statt „viel“ stellen, damit es nicht nach KI-Massenware aussieht (ein Profil-Schalter) | ★ | S | nein | 0 | deine Entscheidung |

### Stufe 1: Bessere Erkennung („Was ist ein Highlight?“)

| Idee | Nutzen | Aufwand | PC? | Kosten | Abhängig von |
|---|---|---|---|---|---|
| **OBS-Mehrspur**: Mikro und Spielton getrennt aufnehmen, die Zentrale erkennt die Spuren automatisch. Danach Whisper nur auf der Stimme, Tempo-Schnitt nach Stimme, Ducking sauberer | ★★★ | S | nein | 0 | OBS-Einstellung bei dir |
| **Tonfall je Satz** ohne KI-Modell: wie laut im Vergleich zu deinem Normalpegel, wie schnell, Ausrufe, Wiederholungen („nein nein nein“), Lexikon (Alter, Digga, was?!). Steht dann direkt in Claudes Satzliste | ★★ | S | nein | 0 | besser mit Mehrspur |
| **Lachen/Schreien/Jubel/Schüsse/Explosionen** erkennen mit einem kleinen Audiomodell (PANNs/EfficientAT, auf 527 Geräuschklassen trainiert) ([PANNs](https://arxiv.org/pdf/1912.10211), [EfficientAT](https://github.com/fschmid56/EfficientAT)) | ★★★ | M | gern, geht auch auf dem Server | 0 | Mehrspur oder Stimm-Trennung |
| **Facecam-Reaktion**: Mimik (Überraschung/Lachen) aus dem Facecam-Ausschnitt, 2 fps, mit HSEmotion (Apache 2.0, kommerziell erlaubt) ([hsemotion-onnx](https://github.com/HSE-asavchenko/hsemotion-onnx)) | ★★ | M | nein (CPU reicht) | 0 | Facecam-Erkennung (Stufe 3) |
| **Spielereignisse lesen**: Texterkennung auf festen Bildbereichen („VICTORY“, „ELIMINATED“, Killfeed), je Spiel ein Profil, so wie es Montage Maker macht ([montage_maker](https://github.com/rlmsinclair/montage_maker)) | ★★★ (bei Shootern/BR) | M–L | ja | 0 | Liste deiner Hauptspiele |
| **Markierung während der Aufnahme** per Hotkey oder Sprachbefehl, wie „Clip it!“ bei Eklipse | ★★ | M | nein | 0 | wie du aufnimmst (zu prüfen) |
| **Twitch-Chat & Zuschauer-Clips** als Signal, falls du live streamst. Chat-Ausbrüche sind das klassische Highlight-Signal ([Patent US 10972524](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10972524)) | ★★★ | M | nein | 0 | nur wenn du streamst |
| **Mehrere Sprecher** (Freunde im Discord): wer redet, alle durcheinander = oft Chaos/Lacher (pyannote, CC-BY-4.0) ([pyannote](https://pypi.org/project/pyannote-audio/4.0.2/)) | ★ | M | ja | 0 | Freunde müssen in der Aufnahme hörbar sein |
| Alle Signale zu **einer Zeitleiste** zusammenführen (je Sekunde ein Gesamtwert, auf jede Aufnahme normiert). Startgewichte sind geschätzt und werden später gelernt | ★★★ | M | nein | 0 | mind. 2 der Signale oben |

Wichtig für Gaming: Die Reaktion kommt 0,5–2 s *nach* dem Ereignis. Der Clip muss also vor der Spitze beginnen und erst *nach* der Reaktion enden, nicht am letzten Wort davor.

### Stufe 2: Claude sieht und hört mehr

| Idee | Nutzen | Aufwand | PC? | Kosten | Abhängig von |
|---|---|---|---|---|---|
| **Kontaktbögen statt 1 Standbild**: je Kandidat 1–2 Raster mit 3×3 Bildern, Sekunde eingeblendet. Damit setzt Claude Hook- und Effekt-Zeitpunkte auf echte Bildereignisse (Tod, Sieg, Gesicht) | ★★★ | S | nein | ca. 0,3–0,4 $ | – |
| **Scout-Durchgang über das ganze Transkript** plus Signal-Zeitleiste: Claude nennt 20–40 Momente, auch leise witzige Gesprächsstellen, die heute nie Kandidat werden | ★★★ | M | nein | ca. 0,2–0,6 $ | besser mit Stufe 1 |
| **Loop-Ende**: Schluss direkt nach der Pointe, ohne Ausklingen, möglichst passend zum Anfang. Wiederholungen zählen bei Shorts als Aufrufe ([Shortimize](https://www.shortimize.com/blog/youtube-shorts-retention-rate)) | ★★ | S | nein | gering | – |
| **Schlüsselwörter betonen**: Claude liefert je Clip 3–8 Wörter, die farbig/größer erscheinen statt jedes Wort gleich | ★★ | S | nein | gering | – |
| **Spielnamen/Slang in Untertiteln korrigieren** (Claude prüft das Transkript des Clips). Fehler in Untertiteln sind eine Top-Beschwerde über Auto-Clipper ([Trustpilot](https://ie.trustpilot.com/review/opus.pro)) | ★★ | S | nein | gering | – |

### Stufe 3: Bildaufbau wie StreamLadder

| Idee | Nutzen | Aufwand | PC? | Kosten | Abhängig von |
|---|---|---|---|---|---|
| **Facecam automatisch finden** (Gesichtserkennung auf 30–60 Bildern je Aufnahme). Heute ist der Facecam-Bereich eine feste Einstellung und standardmäßig aus | ★★★ | M | nein | 0 | – |
| **Blur-Layout**: Spiel in 16:9 mittig, darüber und darunter unscharf. Gut für 3D-Druck, Strategie, Übersicht | ★★ | S | nein | 0 | – |
| **Dynamischer Layoutwechsel**: bei Lach-/Schrei-Spitze 1–2 s Facecam groß, Zoom aufs Gesicht statt auf die Bildmitte | ★★★ | M | nein | 0 | Facecam-Erkennung, Stufe 1 |
| **Untertitel-Position**: an der Naht zwischen Facecam und Spiel, nie über HUD/Gesicht, innerhalb der TikTok-Schutzzonen (ca. 130 px oben, 250 px unten, 120 px rechts) ([Remotion](https://www.remotion.dev/elements/overlays/social-safe-zones/)) | ★★ | S | nein | 0 | Facecam-Erkennung |
| **Langweilige Stellen beschleunigen** (Looten, Laufen) statt harter Schnitte | ★ | M | nein | 0 | Bewegung + Stille |
| **Mitlaufender Ausschnitt** (Druckkopf, Person, Action) für 3dbymicha und Kameravideos. Bei Ego-Shootern bleibt die Mitte | ★★ | M–L | ja | 0 | – |
| Aufnahme in **1440p**: Der 9:16-Ausschnitt aus 1080p wird heute ×1,78 hochskaliert und dadurch unscharf | ★★ | – | – | 0 | OBS/Leistung bei dir |

### Stufe 4: Qualitätskontrolle vor der Freigabe

| Idee | Nutzen | Aufwand | PC? | Kosten | Abhängig von |
|---|---|---|---|---|---|
| **Maschinen-Check** jedes fertigen Clips: schwarze Bilder, ungewollte Standbilder, Stille, Lautheit, Ton-Bild-Versatz, Länge | ★★ | S | nein | 0 | – |
| **Claude schaut den fertigen Clip an** (Kontaktbogen des Ergebnisses): Gesicht abgeschnitten? Untertitel verdecken etwas? Hook in Sek. 0–2 sichtbar? Bei Fehlern automatisch neu rendern | ★★★ | M | nein | ca. 0,03–0,1 $/Clip | – |
| **v1 gegen v2 vergleichen**, bevor die automatische Überarbeitung die alte Fassung ersetzt. Heute bewertet Claude seine eigene Arbeit, und v2 bleibt auch, wenn sie schlechter ist | ★★ | M | nein | gering | Render-Check |

### Stufe 5: Lernen aus echten Zahlen

| Idee | Nutzen | Aufwand | PC? | Kosten | Abhängig von |
|---|---|---|---|---|---|
| **YouTube-Zahlen holen** (Aufrufe, Likes, Kommentare nach 24 h / 3 / 7 Tagen). Geht mit der vorhandenen Verbindung | ★★★ | S–M | nein | 0 | – |
| **Zuschauerbindung** (durchschnittlich gesehen, „engaged views“, Verlaufskurve) über die YouTube Analytics API. Die Kurve zeigt sekundengenau, wo Leute dranbleiben oder zurückspulen ([Zernio docs](https://docs.zernio.com/analytics/get-youtube-video-retention), [YouTube metrics](https://developers.google.com/youtube/analytics/metrics)) | ★★★ | M | nein | 0 | einmal neu verbinden (neues Recht) |
| **Deine Entscheidungen auswerten**: gelöscht, behalten, Titel geändert, nie hochgeladen, gepostet | ★★ | S | nein | 0 | – |
| **Gedächtnis je Kanal**: Top-5 und Flop-5 der letzten 60 Tage gehen als Beispiele in Claudes Auswahl. Der Coach bekommt endlich Zahlen und zeigt, ob Claudes Viral-Score überhaupt stimmt | ★★★ | M | nein | gering | Zahlen holen |
| **Hook-Varianten**: 2–3 Fassungen je Short, du wählst mit einem Tipp, die Wahl wird gelernt. Echte A/B-Tests für Shorts gibt es per API nicht | ★★ | M | nein | gering | – |
| **Eigenes Ranking-Modell** ab ca. 150–300 Clips mit Zahlen, als Vorauswahl vor Claude | ★★ | M | optional | 0 | Stufe 1 + Zahlen |
| TikTok-Zahlen (Aufrufe/Likes/Shares) | ★ | M | nein | 0 | weitere TikTok-Prüfung (Recht `video.list`) |

YouTube zählt seit 31.03.2025 jeden Start als Shorts-Aufruf. Aussagekräftig sind die „engaged views“ ([Sprout Social](https://support.sproutsocial.com/hc/en-us/articles/35874991211533-YouTube-Shorts-View-Count-Update-March-2025)). Deshalb sollten wir mit diesen rechnen und immer gegen deinen eigenen Durchschnitt vergleichen, nicht gegen fremde Richtwerte.

### Stufe 6: Power-PC als Rechenzentrum

| Idee | Nutzen | Aufwand | PC? | Kosten | Abhängig von |
|---|---|---|---|---|---|
| **Rechenhelfer als allgemeine Auftragsliste** (nicht nur Whisper): Audio-Ereignisse, Texterkennung, Gesichter, Wortausrichtung, Rendern. Aufträge **parken bis nachts**, statt auf den schwachen Server auszuweichen | ★★★ (Voraussetzung) | M | ja | Strom | – |
| **Genauere Wortzeiten** (faster-whisper/WhisperX mit Wortausrichtung): Untertitel-Pop und Schnitte sitzen auf der Silbe | ★★ | M | ja | 0 | Auftragsliste |
| **Stimm-Trennung mit Demucs**, falls Mehrspur nicht geht | ★★ | M | ja | 0 | nur ohne Mehrspur |
| **Flüssige Zeitlupe** mit RIFE statt verdoppelter Bilder | ★ | S–M | ja | 0 | Auftragsliste |
| **Rendern auf der 3070** (neuerer Encoder, viel stärkerer Prozessor für Filter) | ★★ | M | ja | 0 | Auftragsliste |
| **Lokales Bildmodell** (Qwen3-VL-4B) beschreibt alle 2 s, was im Spiel passiert, als Text für Claude | ★ bis ★★ | M | ja | 0 | Messung nötig |

### Stufe 7: „Mega geil“ – Visionen

| Idee | Nutzen | Aufwand | PC? | Kosten |
|---|---|---|---|---|
| **Regie-Agent**: Claude bekommt Werkzeuge (Bilder holen, Signale abfragen, Probe-Render, sich selbst ansehen) und arbeitet wie ein Cutter in mehreren Durchgängen | ★★★ | L | optional | ca. 1–3 $ |
| **Reaktions-Pop-out**: Bei Lach-/Schrei-Spitze springt die Facecam groß ins Bild, mit Zoom und Sound, vollautomatisch | ★★★ | M | nein | 0 |
| **Clip-Serien mit Cliffhanger** („Teil 1/3“) bei langen Geschichten wie Bossfight oder Ranked-Match | ★★ | M | nein | gering |
| **Wochen-Best-of** (dein Paket 4), sortiert nach echten Zahlen und Ereignis-Labels („Top 5 Rage-Momente“) | ★★★ | M–L | optional | gering |
| **Running Gags** über alle Videos erkennen → Serienformate | ★ | M | optional | gering |
| **Englische Untertitel-Fassung** + übersetzte Titel für Fails ohne viel Sprache | ★★ | M | nein | gering |
| **Eigener Highlight-Detektor**, trainiert auf deinen Clips (ab einigen hundert Beispielen) | ★★ | L | ja | 0 |

## 4. Kann der Power-PC helfen? Ja, als Nacht-Rechenzentrum

Die RTX 3070 (8 GB) reicht für alle Hilfsmodelle, wenn sie **nacheinander** laufen. Sie reicht nicht für ein lokales Sprachmodell als Claude-Ersatz. Lange Transkripte brauchen so viel Zwischenspeicher, dass ein 8B-Modell bei 32 000 Token Kontext nicht mehr in 8 GB passt ([jacar.es](https://jacar.es/?p=5453)). Claude kostet je Aufnahme ohnehin nur Cent- bis niedrige Dollarbeträge. Ein Kontaktbogen-Bild kostet bei Sonnet-Preisen etwa einen halben Cent ([Anthropic](https://platform.claude.com/docs/en/build-with-claude/vision)).

| Aufgabe | Speicher auf der Karte | Tempo für 1 h Aufnahme | Wann | Beleg |
|---|---|---|---|---|
| Spracherkennung faster-whisper large-v3 (gebündelt, int8) | ca. 4,5 GB | ca. 1–2 min (heute whisper.cpp: ca. 4–5 min) | nachts / nicht beim Zocken | gemessen auf 3070 **Ti** ([faster-whisper](https://github.com/SYSTRAN/faster-whisper)) |
| Wortausrichtung + Sprecher (WhisperX/pyannote) | ca. 5–6 GB gesamt | Sprecher: unter 1 min (geschätzt) | nachts | Blog-Schätzung ([localaimaster](https://localaimaster.com/blog/whisperx-guide)), pyannote auf H100: 31 s/h |
| Stimm-Trennung Demucs | ca. 4 GB | 2,5–20 min (Quellen widersprechen sich ×10) | nachts | [LinuxLinks](https://www.linuxlinks.com/machine-learning-linux-demucs-music-source-separation/2/), [StemSplit](https://stemsplit.io/blog/demucs-local-setup-guide) |
| Lachen/Schreien (PANNs/EfficientAT) | klein (< 1 GB, Schätzung) | vermutlich unter 1 min | jederzeit, auch Server | nicht gemessen |
| Facecam-Mimik (HSEmotion) | klein | 7 200 Bilder bei 2 fps, auch auf CPU | Server reicht | nicht gemessen |
| Texterkennung im Spiel (PaddleOCR o. ä.) | klein bis mittel | nicht gemessen | nachts | – |
| Bildmodell Qwen3-VL-4B (Q4) | ca. 6 GB | grob 30–90 min (0,5 Bilder/s, **muss gemessen werden**) | nur nachts | [codersera](https://codersera.com/blog/qwen3-vl-4b-vs-qwen3-vl-8b-benchmarks-vram-guide/) |
| Zeitlupe RIFE | gering | 1080p doppelt in Echtzeit, Sekunden je Replay | jederzeit außer beim Zocken | 3070-Nutzerberichte ([SVP-Forum](https://www.svp-team.com/forum/viewtopic.php?pid=81167)) |
| Rendern (NVENC H.264/HEVC) | gering | schneller als 1050 Ti (nicht gemessen); Kopieren über 1 GbE ca. 1,5–3,5 min | **nicht beim Zocken**, OBS braucht NVENC | [NVENC App Note](https://docs.nvidia.com/video-technologies/video-codec-sdk/12.2/pdf/NVENC_Application_Note.pdf) |
| Lokales Sprachmodell statt Claude | passt nicht sinnvoll | – | – | **nicht empfohlen** |

Die 3070 kann AV1 nur abspielen, nicht kodieren. Das ist egal, YouTube und TikTok bekommen H.264. Die bestehende Spiel-/OBS-Erkennung des Rechenhelfers bleibt die Grundregel: Wenn du zockst, ruht der PC. Neu wäre nur, dass Analyse-Aufträge dann **warten** (z. B. bis 12 h, Nachtfenster gibt es schon), statt sofort auf den Server auszuweichen.

## 5. Was wir technisch brauchen

| Was | Warum | Wer |
|---|---|---|
| **OBS: Mikro und Spielton auf getrennten Tonspuren** (z. B. Spur 1 Mix, 2 Mikro, 3 Spiel) | größter Hebel überhaupt, ersetzt die Stimm-Trennung | du (5 Minuten in OBS) |
| Aufnahme in **1440p/60** statt 1080p, falls der PC das schafft | schärferer Hochformat-Ausschnitt, flüssigeres Gameplay | du |
| **YouTube-Recht „Analytics lesen“** (`yt-analytics.readonly`) + YouTube Analytics API im Google-Projekt aktivieren | Zuschauerbindung, engaged views | du klickst, Kanäle einmal neu verbinden |
| TikTok-Recht `video.list` (eigene App-Prüfung) | TikTok-Zahlen | später, nach der laufenden Prüfung |
| Hugging-Face-Zugang (Token) | pyannote-Modell ist zugangsbeschränkt | einmalig, nur falls Sprecher-Erkennung gewünscht |
| Python-Umgebung auf dem PC (per `uv`, ohne Admin) | WhisperX, Audio-Modelle, OCR; ca. 3–5 GB Platte je Umgebung, Modelle zusätzlich einige GB | ich baue es in den Rechenhelfer ein |
| PC nachts an (oder Energiesparplan mit Aufwachen) | Nacht-Rechenzentrum | du |
| Twitch-API-Zugang | nur falls du live streamst (Chat/Zuschauer-Clips) | du, nach Rückfrage |
| Lizenzprüfung je Modell | YOLO ist AGPL, LibreFace nicht kommerziell → meiden; HSEmotion (Apache 2.0) und pyannote (CC-BY-4.0) sind ok | ich, vor dem Einbau |

## 6. Fragen an dich

1. **Streamst du live** (Twitch/YouTube), oder nimmst du nur lokal auf? Bei Live-Streams wären Chat und Zuschauer-Clips das stärkste Signal.
2. **Nimmt OBS Mikro und Spiel schon getrennt auf?** Falls nicht: Ist das für dich in Ordnung?
3. In welcher **Auflösung und mit wie vielen fps** nimmst du auf? Ist mehr möglich?
4. Ist die **Facecam immer an der gleichen Stelle**, und immer an?
5. Sind deine **Freunde im Discord** in der Aufnahme hörbar?
6. Welche **3–5 Spiele** spielst du am meisten? Für die lohnt sich das Lesen von Spieltexten (Killfeed, Sieg).
7. Welche deiner Clips liefen **bisher am besten**? Daraus werden die ersten Beispiele für Claude.
8. Wirken dir die Effekte aktuell **zu viel**?
9. Darf der **PC nachts laufen**, und bist du bereit, YouTube einmal neu zu verbinden?
10. Was ist dein **Budget pro Aufnahme** für Claude (heute geschätzt 0,20–1 $)? Mit Scout und Kontaktbögen kämen etwa 0,5–1 $ dazu.

## 7. Empfohlene Reihenfolge

**Erstes „leg los“-Paket: „Hören, Sehen, Messen“** (alles ohne PC, überwiegend Aufwand S):

1. Stufe 0 komplett: Speicher-Fix, Hook-Text weg von der Facecam, 60 fps/Qualität, variable Länge, Lacher-Marker, VAD.
2. Mehrspur-Erkennung, sobald du OBS umgestellt hast. Tonfall je Satz in Claudes Satzliste.
3. Kontaktbögen für Claude (Kandidaten und Überarbeitung).
4. YouTube-Zahlen holen (ohne neues Recht) und deine Behalten/Löschen-Entscheidungen speichern, damit das Lernen ab sofort Daten sammelt.

Dieses Paket wirkt sofort auf jede neue Aufnahme und kostet kaum laufend etwas. Es fängt auch an, Daten zu sammeln, und das ist der langsamste Teil. **Paket 2** wären Scout über das ganze Transkript, Facecam-Erkennung, Blur-Layout, Layoutwechsel und Render-Check. **Paket 3** wäre der Power-PC als Auftragsliste mit Lachen/Schreien, Spieltexten und genauen Wortzeiten. Danach kommen Lernen mit Analytics und die Visionen (Regie-Agent, Best-of).

## 8. Ehrliche Grenzen

Die Recherche steht auf **dünnem Eis**. Fast alle Seiten waren in dieser Sitzung nur über Suchauszüge lesbar, nicht im Volltext. Viele Quellen sind Hersteller oder Mitbewerber, die sich selbst loben. Wie Opus, StreamLadder oder Klap intern arbeiten, ist nicht dokumentiert. Zwei Reviews und ein Herstellerbenchmark widersprechen sich sogar darin, ob Opus bei Gaming stark oder schwach ist. Dass ein hoher Virality Score mit echten Aufrufen zusammenhängt, ist **nirgends unabhängig belegt**. Längenempfehlungen schwanken je nach Quelle zwischen 15 und 60 s. Der größte Datensatz zeigt virale TikToks gehäuft bei 15–30 s ([viral.app](https://viral.app/blog/insights/short-form-video-trends)), aber „die Länge folgt dem Moment“ ist die ehrlichere Regel.

**Für die RTX 3070 gibt es keine echten Messungen.** Die Whisper-Zahlen stammen von einer 3070 Ti, die Demucs-Zahlen widersprechen sich um den Faktor 10, und für Bildmodelle, Texterkennung und Audiomodelle fehlen Messwerte ganz. Vor dem Ausbau müsste ich auf deinem PC messen. Bei den Signalen gilt: Audiomodelle sind nicht an Gaming-Ton mit Stimme getestet. Fertige Lach-Detektoren treffen auf verrauschtem Material nur etwa jedes zweite Mal ([Gillick et al.](https://www.isca-archive.org/interspeech_2021/gillick21_interspeech.html), Vergleichswerte nur aus Suchauszug). Für Deutsch gibt es keine Werte für das Emotionsmodell emotion2vec. Demucs ist für Musik trainiert, nicht für Spielsounds. Die Texterkennung im Spiel muss je Spiel eingerichtet werden. Ob YouTube die Verlaufskurve auch für Shorts per API liefert und ob die Quote „angesehen vs. weggewischt“ dort abrufbar ist, ist **nicht bestätigt**. Und die Gewichte für die Zeitleiste sind am Anfang Bauchgefühl, bis genug eigene Zahlen da sind.

Die gute Nachricht: Die wichtigsten ersten Schritte (Mehrspur, Tonfall, Kontaktbögen, Zahlen sammeln) hängen von keiner dieser Unsicherheiten ab.

---

### Anhang: Technische Notizen (für spätere Sitzungen)

- Ist-Stand laut Code-Analyse (1.26.1): Lautheit und Whisper nur auf `0:a:0` (Mischspur). Szenenwechsel nur an Keyframes. Kandidaten sind feste 37-s-Fenster, max. 30. `chooseHighlights` bekommt 1 Standbild (640 px) je Kandidat. Facecam-Layout ist fest und standardmäßig aus. Der Zoom geht immer auf die Bildmitte. Ausgabe fest 30 fps. Es werden keine Statistiken abgerufen (Scope `youtube` erlaubt aber schon `videos.list?part=statistics`).
- Risiko R1: `concatGraph` hängt alle Teile an `[0:v]`. Bei Hook-Vorschau wird gepuffert wie damals bei `renderSummary` (1.24.1). Lösung: je Teil eigene Eingabe `-ss/-t -i`.
- Risiko R3: `renderLong` mit sehr vielen `between()`-Termen bei `reviseLong` + Tempo. Ab ca. 200 Abschnitten in Chunks rendern.
- Kontaktbogen: `fps=0.5,scale=360:-2,drawtext=…,tile=3x3`, ca. 1,2–1,6 k Token je Bild.
- Startgewichte der Fusion (Annahme): Lachen/Schreien 0,25 · Arousal 0,15 · Facecam 0,15 · Lautheitssprung 0,10 · Spielereignis 0,10 · Sprecherüberlappung/Ausrufe 0,10 · Bewegung 0,05 · Neuheit 0,10. Normierung je Aufnahme (Median/MAD), ±3 s Max-Pooling, 10–20 s Vorlauf vor der Spitze.
- Rechenhelfer heute nur `kind: 'whisper'`. Erweiterung auf `audio-tags | ocr | vlm-log | faces | align | render` mit Proxy-Video (640 px, 2 fps) und JSON-Ergebnis.

## 9. Nach deinen Antworten (19.10.2026)

**Deine Antworten:** Du streamst live auf Twitch und TikTok, nimmst in Full HD mit 30 fps auf, die Facecam-Position wechselt, OBS-Spuren unklar („VOD-Spuren“ gibt es). Wunsch: Die Zentrale holt sich selbst die Zahlen von TikTok, Twitch und YouTube und wertet sie aus.

Was sich dadurch ändert:

### Neuer größter Hebel: Twitch-Chat als Highlight-Signal
Das ist genau das Signal, mit dem Eklipse, Powder und die Forschung (LIGHTOR) am besten fahren: **Wenn der Chat explodiert („LUL“, „KEKW“, „W“, „?“, viele Nachrichten pro Sekunde), ist gerade etwas passiert.**
- **Live mitschreiben:** Die Zentrale verbindet sich während deines Streams mit deinem Twitch-Chat (offizielle Twitch-Schnittstelle EventSub, Recht `user:read:chat`) und speichert jede Nachricht mit Uhrzeit – nur Zeit + Text, keine Zuschauerdaten weiter.
- **Zeit abgleichen:** OBS-Aufnahmen tragen Datum/Uhrzeit im Dateinamen → Chat-Zeit minus Aufnahmebeginn = Stelle im Video. Chat reagiert 3–10 s *nach* dem Moment, darum setzt die Zentrale den Clip-Start entsprechend früher (das Einrasten auf Sätze gibt es schon).
- **Zuschauer-Clips von Twitch:** Wenn Zuschauer bei dir clippen, liefert Twitch die Stelle im VOD und die Aufrufe der Clips → das sind „von Menschen gewählte“ Highlights, stärker als jede KI-Schätzung.
- **TikTok-Live-Chat:** dafür gibt es **keine offizielle Schnittstelle** (nur inoffizielle Bastellösungen, die gegen die Regeln verstoßen können) → lassen wir weg.
- Kosten: keine. PC: nicht nötig. Aufwand: M.

### Neues Paket: Statistik-Zentrale (YouTube, TikTok, Twitch)
| Plattform | Was wir bekommen | Was nötig ist |
|---|---|---|
| YouTube | Aufrufe, Likes, Kommentare je Video (geht mit der bestehenden Verbindung); Wiedergabedauer, % angesehen, Zuschauerverlauf über **YouTube Analytics** | für Analytics einmal neu verbinden (zusätzliches Nur-Lese-Recht `yt-analytics.readonly`) |
| TikTok | Aufrufe, Likes, Kommentare, Shares je Video (Display API, Recht `video.list`) | Recht in der TikTok-App ergänzen – kann eine **weitere Prüfung durch TikTok** auslösen; erst einreichen, wenn die laufende Prüfung durch ist |
| Twitch | Zuschauer-Clips mit Aufrufen, VODs, Stream-Marker | Twitch-Verbindung neu anlegen (Entwickler-App auf dev.twitch.tv, Anmeldung per Code wie bei YouTube) |

Daraus baut die Zentrale: Reiter „📈 Zahlen“ mit Top/Flop je Kanal und Plattform, Vergleich gegen deinen eigenen Durchschnitt (nicht gegen fremde Richtwerte), und – das Wichtigste – **Claude bekommt bei jedem Schnitt deine besten und schlechtesten Clips als Beispiele** („so etwas läuft bei MichaModus, so etwas nicht“). Der Coach bekommt endlich echte Zahlen. Später: eigenes Bewertungsmodell aus den Zahlen.

### Was sonst angepasst wird
- **30 fps:** bleibt so, kein Umstellen nötig (der „60 fps“-Punkt aus Stufe 0 entfällt; Ausgabe bleibt bei 30 fps, nur die Bildqualität wird verbessert).
- **Facecam wechselt die Position** → die automatische Facecam-Erkennung (Stufe 3) wird wichtiger und rückt ins erste Paket: Die Zentrale sucht je Aufnahme (bzw. je Abschnitt) das Gesicht, statt eines festen Rechtecks.
- **OBS-Tonspuren:** Die „Twitch-VOD-Spur“ ist eine eigene Spur fürs Stream-Archiv (ohne Musik) – für die Aufnahme zählt etwas anderes. So stellst du es ein (5 Minuten, schadet nichts):
  1. OBS → *Einstellungen → Ausgabe* → Ausgabemodus **Erweitert** → Reiter **Aufnahme** → Format **MKV** (oder MP4/Hybrid) → bei **Audiospur 1, 2 und 3** Haken setzen.
  2. Im Audiomixer ⚙ → **Erweiterte Audioeigenschaften**: Mikrofon auf Spur **1 + 2**, Desktop-/Spielton auf Spur **1 + 3**, Discord auf **1 + 3** (oder eigene Spur 4).
  3. Ergebnis: Spur 1 = alles (wie bisher, für YouTube), Spur 2 = nur deine Stimme, Spur 3 = Spiel. Die Zentrale nutzt Spur 2 für Untertitel/Lachen/Tonfall – alte Aufnahmen mit nur einer Spur laufen weiter wie heute.
  Wenn du magst, schick mir einen Screenshot von *Ausgabe → Aufnahme* und den *Erweiterten Audioeigenschaften*, dann sag ich dir genau, wo der Haken hin muss.

### Neue Empfehlung fürs erste „leg los“
**Paket A „Hören, Sehen, Messen“** (wie oben, angepasst):
1. Sofort-Korrekturen: Speicher-Falle beim Short mit Hook-Vorschau, Hook-Text nicht über die Facecam, bessere Bildqualität, variable Clip-Länge, Lacher-Marker behalten.
2. Mehrspur-Ton (Stimme separat) + Tonfall je Satz.
3. Bildraster (9 Bilder) je Kandidat für Claude.
4. Facecam automatisch finden (auch wenn sie wandert).

**Paket B „Chat & Zahlen“**:
1. Twitch verbinden: Chat live mitschreiben → Chat-Ausschläge als Highlight-Signal; Zuschauer-Clips übernehmen.
2. Statistik-Zentrale: YouTube (+ Analytics), Twitch, TikTok (sobald das Recht freigegeben ist).
3. Top/Flop-Beispiele automatisch in Claudes Schnitt-Auswahl und in den Coach.

Reihenfolge-Vorschlag: **A und B zusammen**, weil B ab dem ersten Stream Daten sammeln muss – je früher, desto besser.

**Noch zwei kurze Fragen:** Läuft die OBS-Aufnahme **gleichzeitig mit dem Stream** (also ein Rechner, Aufnahme + Stream parallel)? Und streamst du auf TikTok mit **demselben OBS** oder über die TikTok-App / TikTok Live Studio?

### Nachtrag: Grafikkarte von Hand freigeben (Wunsch Michael, 19.10.2026)
Der PC rechnet nur, wenn du ihn freigibst:
- **Freigeben:** Knopf in der Zentrale („PC freigeben – 2 Std. / bis morgen früh / bis ich stoppe“) und zusätzlich eine Verknüpfung auf dem PC-Desktop („Grafikkarte freigeben“ / „Grafikkarte sperren“), damit du nicht erst die Zentrale öffnen musst.
- **Warteschlange:** Schwere Aufträge (Lachen/Schreien erkennen, Texte im Spiel lesen, genaue Wortzeiten, Zeitlupe, Rendern) sammeln sich, bis du freigibst; die Zentrale zeigt „3 Aufträge warten auf den PC (ca. 25 Min.)“. Eilige Sachen (Spracherkennung für einen Schnitt) macht notfalls weiter der Server – wie heute.
- **Sicherheitsnetz bleibt:** Startest du trotz Freigabe OBS oder ein Spiel, bricht der PC sofort ab (innerhalb von 3 s, gibt es heute schon) und die Freigabe endet.
- **Einstellung „Modus“:** *Nur nach Freigabe* (dein Wunsch, Standard) · *Automatisch wenn frei* (wie heute) · *Nachts automatisch* (z. B. 2–7 Uhr).
- Aufwand: S–M, gehört zu Paket C (Power-PC als Rechenzentrum).

### Nachtrag: Quelle ist das Twitch-VOD, nicht OBS (19.10.2026)
Michael nimmt nicht mit OBS auf, sondern lädt das VOD von Twitch herunter. Folgen:
- **Chat passt perfekt:** VOD-Zeit 0 = Streambeginn. Live mitgeschriebener Chat (EventSub) lässt sich exakt auf das VOD legen; Zuschauer-Clips und Stream-Marker liefert Twitch direkt mit ihrer Stelle im VOD (`vod_offset`). Kein Uhrzeit-Abgleich über Dateinamen nötig.
- **Chat alter VODs:** Die offizielle Twitch-API liefert keinen Chat-Verlauf vergangener Streams. Mit einem inoffiziellen Weg (wie das Programm TwitchDownloader) ginge es – funktioniert meist, kann aber jederzeit brechen → optional, Daten ab sofort sammeln ist der sichere Weg.
- **Automatischer VOD-Import (Idee):** Die Zentrale merkt Streamende, lädt das VOD selbst (yt-dlp, inoffizieller Download-Weg; offiziell gibt es nur den Download-Knopf im Twitch-Dashboard) in den `eingang` und verknüpft es mit Chat, Clips und Markern. Vorteil: nichts mehr von Hand, VODs verfallen nicht unbemerkt.
- **Nur eine Tonspur:** Im VOD sind Stimme und Spiel gemischt → Mehrspur entfällt. Ersatz: Stimme per **Demucs** abtrennen (Power-PC, nach Freigabe; ohne PC: Tonfall nur aus der Mischspur, ungenauer). Option für später: OBS zusätzlich lokal mitschneiden lassen (bessere Bildqualität als das VOD, getrennte Spuren) – kostet beim Streamen Leistung, nur wenn der PC das schafft.
- **Facecam ist ins Stream-Bild eingebrannt** → automatische Facecam-Erkennung bleibt wichtig.
- **Neuer Tipp:** Während des Streams **Stream-Marker setzen** (Twitch-Befehl /marker oder Stream-Deck-Taste), wenn etwas Geiles passiert → die Zentrale nimmt diese Stellen als sichere Highlights.

### Nachtrag: OBS → Twitch, virtuelle Kamera → TikTok Live Studio (19.10.2026)
- TikTok-Live ist dasselbe Bild wie Twitch → Twitch-VOD reicht als Quelle. TikTok-Live-Chat/-Wiederholungen haben keine offizielle Schnittstelle → nicht anbinden.
- **Empfehlung (kostenlos, fast keine Mehrlast):** OBS beim Streamen **automatisch mitaufnehmen** lassen, mit dem **Stream-Encoder** („Stream-Encoder verwenden“) – dann wird nichts doppelt kodiert. Gewinn: getrennte Tonspuren (Stimme/Spiel, kein Demucs nötig), kein VOD-Download, keine stummgeschalteten Musikstellen wie im VOD. Der vorhandene **OBS-Sortierer** schiebt die Aufnahme danach automatisch in den Eingang. Chat-Abgleich dann über Aufnahmebeginn (= Streambeginn, weil automatisch gestartet).
  - OBS: *Einstellungen → Ausgabe → Erweitert → Aufnahme*: Encoder „(Stream-Encoder verwenden)“, Format MKV, Audiospuren 1–3. *Einstellungen → Allgemein*: „Automatisch aufnehmen beim Streamen“. Spuren wie oben (Mikro 1+2, Spiel/Discord 1+3).
  - Speicherbedarf: wie VOD, ca. 2,5–4 GB je Stunde bei 6000 kbit/s.
- Ohne Mitaufnahme bleibt der VOD-Weg (Import + Demucs) – beides wird unterstützt.
