// Was ist neu – neueste Version oben. Bei jeder Auslieferung ergänzen (und package.json-Version erhöhen).
export const CHANGELOG = [
  { version: '1.32.2', date: '25.10.2026', items: [
    'Ausgabenlimit im Anthropic-Konto erreicht („You have reached your specified API usage limits“): Die Zentrale erkennt das jetzt, fragt Claude bis zum genannten Termin nicht mehr und lässt alles die lokale KI rechnen. Verständliche Meldung statt englischem Fehlertext.',
  ] },
  { version: '1.32.1', date: '25.10.2026', items: [
    'KI-Vorschlag: leere bzw. kaputte Standbilder werden nicht mehr mitgeschickt; lehnt Claude ein Bild ab, versucht die Zentrale es einmal ohne Bilder. Die genaue Claude-Meldung steht jetzt im Protokoll des Containers.',
  ] },
  { version: '1.32.0', date: '25.10.2026', items: [
    'Knöpfe und Texte sagen jetzt „KI“ statt „Claude“ (z. B. „✨ KI-Vorschlag holen“) – egal ob Claude oder die lokale KI rechnet. Im Vorschlag steht, wer ihn erstellt hat.',
    'Je Aufgabe vier Wege (Einstellungen → Lokale KI): „Nur lokal“, „Lokal, sonst Claude“, „Claude, sonst lokal“ und „Nur Claude“. „Claude, sonst lokal“ springt jetzt bei jedem Claude-Fehler auf die lokale KI um, nicht nur bei fehlendem Guthaben.',
  ] },
  { version: '1.31.1', date: '25.10.2026', items: [
    'Neue Vorgabe „Teures lokal, Günstiges Claude“: Clips auswählen, Späher, Überarbeiten und Trailer rechnet Ollama; Titel/Texte, Prüfung, Themen und Coach bleiben bei Claude. Vorlagen per Knopf: auch „Alles lokal“ oder „Alles Claude“.',
    '⛔ Ist Claude gesperrt (kein Guthaben, Schlüssel ungültig), laufen automatisch alle KI-Aufgaben lokal – die Zentrale fragt Claude dann 6 Stunden lang nicht mehr (Knopf „Guthaben aufgeladen – wieder versuchen“).',
    '🖥+🗄 Server und PC rechnen gleichzeitig: Aufträge gehen an den freieren Rechner, Vorschläge laufen zu zweit. Holt der PC einen Auftrag nicht ab (rechnet gerade Sprache), übernimmt der Server.',
  ] },
  { version: '1.31.0', date: '25.10.2026', items: [
    '🏠 Lokale KI (Ollama) statt Claude – spart Kosten: Einstellungen → „Lokale KI“. Die Zentrale nutzt deinen Ollama auf dem Server (z. B. http://192.168.1.10:11434) und – wenn die Grafikkarte freigegeben ist – deinen PC (Rechenhelfer 1.9 richtet Ollama dort selbst ein, Modell mit Bildverständnis).',
    'Je Aufgabe wählbar: Claude, „Lokal, bei Fehler Claude“ oder „Nur lokal“ – Titel/Texte, Render-Prüfung, Themen, Coach, Späher, Clips auswählen, Überarbeiten, Trailer. Übersicht, was Claude gekostet hat und was lokal gespart wurde.',
    'Lange Aufnahmen werden für die lokale KI passend gekürzt: Sätze mit Signalen (laut, Lachen …) bleiben, der Rest wird gleichmäßig über die ganze Aufnahme ausgedünnt.',
  ] },
  { version: '1.30.0', date: '20.10.2026', items: [
    '🪞 Video spiegeln (Knopf im Video): Das Bild wird gespiegelt, Untertitel, Hook-Texte und Effekte bleiben lesbar. Bei Shorts/Lang-/Kurzfassungen wird mit gleichem Schnitt neu gerechnet (ohne Claude), auf Wunsch auch alle anderen Videos derselben Aufnahme. Am Rohvideo gilt es für alle künftigen Schnitte.',
    '🖼 Titelbild als erstes Bild ins Video: Beim Hochladen wird eine Kopie mit deinem Titelbild vorne gebaut (als einzelnes Bild oder 0,4 s) – Vorschauen bei Shorts, TikTok und WhatsApp zeigen dann dein Titelbild. Je Kanal voreinstellbar, je Video änderbar. Bei TikTok „Direkt veröffentlichen“ wird es auch als Cover gewählt.',
    '🔤 Text-Vorlagen wie bei StreamLadder/Opus Clip: 12 Untertitel-Stile (Hormozi, Karaoke, Pop, Box, Neon, Comic, Einzelwort, Schreibmaschine, Glitch, Wackeln, Marker, Klassisch) und 4 Looks für den Hook-Text, mit neuen Schriften. Claude wählt je Clip passend zur Stimmung und hebt Schlüsselwörter hervor (farbig, größer, ggf. mit Emoji) – oder du legst den Stil je Kanal fest. Galerie mit Vorschau, Stil je Short nachträglich änderbar.',
    '🎥 Facecam automatisch: Die PC-Analyse sucht jetzt auch Gesichter (Rechenhelfer 1.8). Daraus findet die Zentrale den Facecam-Rahmen pixelgenau – auch wenn sie im Stream die Position wechselt (der Short springt dann mit). Kein Gesicht im Clip → ganzes Bild statt falschem Ausschnitt.',
    '🎥 Facecam / Ausschnitt von Hand korrigieren: Rahmen auf einem Standbild ziehen, „merken“ – künftige Clips des Kanals nehmen ihn automatisch, wenn die Facecam dort sitzt.',
  ] },
  { version: '1.29.2', date: '19.10.2026', items: [
    'Rechenhelfer 1.7: Die Geräusch-Erkennung (Lachen, Jubel, Explosionen) hätte nicht funktioniert – die neueste „transformers“-Version verlangt ein neueres PyTorch und hat sich still abgeschaltet. Jetzt fest auf eine passende Version gesetzt; der Selbsttest prüft das ausdrücklich. Die Nachinstallation passiert beim nächsten Start von selbst (nur wenige MB).',
  ] },
  { version: '1.29.1', date: '19.10.2026', items: [
    'Rechenhelfer 1.6: Die Einrichtung der PC-Analyse brach unter Windows sofort bei „Downloading cpython …“ ab (Windows PowerShell hielt die Fortschrittsmeldungen für Fehler). Behoben – bitte den Rechenhelfer neu herunterladen und „Einrichten.bat“ starten.',
    'Es läuft jetzt immer nur ein Rechenhelfer gleichzeitig (vorher konnten zwei Fenster parallel starten). Scheitert die Einrichtung, versucht er es alle 30 Minuten erneut, ohne Neustart.',
  ] },
  { version: '1.29.0', date: '19.10.2026', items: [
    '🧠 PC-Analyse auf deiner Grafikkarte (Rechenhelfer 1.5): trennt deine Stimme vom Spielton (Demucs – wichtig für Twitch-VODs mit nur einer Tonspur), erkennt Lachen, Schreie, Jubel, Explosionen und Schüsse per KI und liest Spieltexte wie „VICTORY“, „ELIMINATED“ oder „#1“.',
    'Alles fließt in die Momentfindung: genauere Spracherkennung auf der sauberen Stimme, echter Tonfall, Geräusche und Spieltexte als Highlight-Signale für Claude.',
    'Der Schnitt wartet (einstellbar, höchstens 12 Std.), bis du die Grafikkarte freigibst – „Jetzt schneiden“ schneidet sofort ohne. In der Liste steht dann „🔒 wartet auf PC-Freigabe“.',
    'Einrichtung auf dem PC passiert von selbst: Python, PyTorch (CUDA) und die Modelle werden einmalig in den Ordner des Rechenhelfers geladen (ca. 5–6 GB, ohne Administratorrechte).',
  ] },
  { version: '1.28.0', date: '19.10.2026', items: [
    '🎬 Highlight-Video / Kanal-Trailer (Freigabe → „🎬 Trailer“): die besten Momente quer über alle Shorts eines Kanals, 30 Sekunden bis 5 Minuten, quer (YouTube-Kanaltrailer) oder hoch (Short/TikTok). Claude baut den Spannungsbogen: stärkster Einstieg, Abwechslung, bestes Highlight zum Schluss.',
    'Mit Logo-Intro, „Jetzt abonnieren“-Outro, Logo als Wasserzeichen, kurzen Einblendungen, Spiel/Thema, Blitz + Whoosh an jedem Schnitt und Musik. Zeitraum wählbar (z. B. „Best of der Woche“).',
    'Logo je Kanal: hochladen oder das Profilbild vom YouTube-Kanal bzw. von Twitch holen (rund ausgeschnitten).',
    '🔓 Rechenhelfer rechnet jetzt nur, wenn du die Grafikkarte freigibst: Knöpfe unter Einstellungen → Rechenhelfer (2 Std., bis morgen früh, bis ich sperre) oder die neuen Desktop-Verknüpfungen „Grafikkarte freigeben/sperren“ auf dem PC. Startest du ein Spiel oder OBS, endet die Freigabe sofort. Alternativ: nachts automatisch oder immer.',
  ] },
  { version: '1.27.0', date: '19.10.2026', items: [
    '🎯 Momente finden wie die Profis: Statt nur „wo ist es laut“ zählen jetzt deine Stimme (bei OBS-Mehrspur getrennt vom Spiel), dein Tonfall je Satz (lauter als sonst, schneller, Ausrufe, „Alter!“, Wiederholungen), erkannte Lacher/Schreie, Bildwechsel und Twitch-Signale.',
    '👀 Claude liest vor dem Schnitt die ganze Aufnahme und meldet starke Momente – auch leise, witzige Stellen, die keine Lautstärke-Spitze haben. Je Kandidat sieht Claude jetzt einen Bildraster aus 9 Bildern statt eines einzelnen Standbilds.',
    '🖼 Bildaufbau wie StreamLadder: Claude erkennt die Facecam (auch wenn sie je Szene woanders sitzt), die Zentrale legt den Ausschnitt genau an den Rahmen an. Facecam oben + Spiel unten, Ausschnitt um die Action oder ganzes Bild mit Blur-Hintergrund. Bei starken Reaktionen wird die Facecam kurz groß.',
    'Hook-Text und Emojis liegen nie mehr über deinem Gesicht. Shorts in besserer Bildqualität; Länge folgt dem Moment (15–60 s statt fest 30–45 s).',
    '✔ Jeder fertige Short wird geprüft: schwarze/eingefrorene Stellen, Stille, Lautheit – und Claude schaut sich den fertigen Clip an (Gesicht verdeckt? Untertitel lesbar? Action im Bild?). Mängel fließen in die automatische Überarbeitung.',
    '🟣 Twitch: Chat wird live mitgeschrieben (nur Zeit + Text), Chat-Ausschläge, Zuschauer-Clips und Stream-Marker werden Highlight-Signale. Optional lädt die Zentrale das VOD nach dem Stream selbst in den Eingang.',
    '📈 Neuer Reiter „Zahlen“: Aufrufe/Likes von YouTube (optional % angesehen über Analytics), TikTok (sobald freigegeben) und Twitch. Claude bekommt deine besten und schwächsten Clips als Beispiele für den nächsten Schnitt, der Coach arbeitet mit echten Zahlen.',
    '✅ Freigabe: sortiert nach Viral-Punkten, „🔁 Mit neuen Erkenntnissen überarbeiten“ für ausgewählte Videos, „🧹 Doppelte aufräumen“ legt ältere Fassungen in den Papierkorb, wenn es schon eine überarbeitete gibt (hochgeladene bleiben).',
    'Fehler behoben: Shorts mit Höhepunkt vorweg konnten wie früher die Kurzfassung sehr viel Speicher brauchen – jeder Abschnitt wird jetzt direkt angesprungen.',
  ] },
  { version: '1.26.1', date: '18.10.2026', items: [
    'Info-Seite: TikTok wird jetzt so beschrieben, wie es nach der Freigabe läuft – Videos gehen direkt aus der Zentrale live auf das eigene Profil (Veröffentlichungsdialog mit Sichtbarkeit, Interaktionen, Kennzeichnung); Entwurf in den Posteingang nur noch als Alternative.',
  ] },
  { version: '1.26.0', date: '18.10.2026', items: [
    '🌐 Öffentliche Info-Seite unter /info (Beschreibung, Nutzungsbedingungen, Datenschutzhinweise – deutsch + englisch) für die App-Prüfung bei TikTok. Nur dieser Pfad ist ohne Anmeldung erreichbar; Anleitung für die Freigabe in Nginx Proxy Manager unter Einstellungen → Info-Seite.',
  ] },
  { version: '1.25.1', date: '18.10.2026', items: [
    'Unraid zeigt jetzt ein Icon für den Container (Docker-Label net.unraid.docker.icon). Falls es nicht erscheint: beim Container unter „Icon URL“ die Adresse aus der Anleitung eintragen.',
  ] },
  { version: '1.25.0', date: '13.10.2026', items: [
    '✂ Saubere Schnitte wie bei Opus Clip: Claude wählt Anfang und Ende jetzt als ganze Sätze (nummerierte Sätze mit Zeitstempel statt geschätzter Sekunden) – kein Abschneiden mitten im Satz mehr.',
    'Sicherheitsnetz beim Schneiden: Start/Ende rasten auf Satzanfang bzw. Satzende ein, mit etwas Luft und in der leisesten Stelle der Sprechpause; ohne Sprache auf einen Bildwechsel. Zu lange Clips enden am letzten Satzende statt hart bei der Maximallänge.',
    'Kurzfassung aus zusammenhängenden Sätzen statt starrer 15-Sekunden-Stücke; Langfassung entfernt Pausen nie mehr mitten in einem Satz; Hook-Vorschau und Teaser auf ganzen Wörtern.',
    'Bessere Satzerkennung: lange Monologe ohne Punkt werden an der größten Sprechpause geteilt, nicht stur nach 20 Wörtern.',
    '🧠 Maximale Denkstufe für alle Schnitt-Entscheidungen (Highlights, Kurzfassung, Überarbeiten) – einstellbar unter Einstellungen → Claude. Rechenhelfer nutzt jetzt das beste Spracherkennungs-Modell large-v3 (genauere Wort-Zeiten und Satzzeichen).',
  ] },
  { version: '1.24.1', date: '12.10.2026', items: [
    'Fehler behoben: Kurzfassung brach mit „Error while processing the decoded data … Conversion failed“ ab. Lagen die Bausteine nicht in zeitlicher Reihenfolge (z. B. Höhepunkt vorne), musste ffmpeg minutenlang Bilder zwischenspeichern und lief voll. Jetzt wird jeder Baustein direkt angesprungen – schneller und ohne Speicherhunger.',
    'Fehlermeldungen von ffmpeg zeigen jetzt die eigentliche Ursache statt nur „Conversion failed“.',
  ] },
  { version: '1.24.0', date: '12.10.2026', items: [
    '🗂 Vorhandene Videos umstellen: Einstellungen → Ordnung bzw. Bibliothek → „Vorhandene umstellen …“ zeigt vorher genau, welches Video wie heißen und wo liegen wird – erst nach deinem Klick wird verschoben.',
    '🎮 Ältere Videos ohne erkanntes Spiel: Claude bestimmt das Spiel nachträglich aus Titel, Beschreibung und Gesprochenem (ca. 0,4 Cent je Video). In der Bibliothek kannst du das Spiel einer Aufnahme mit „✎ Spiel“ auch selbst setzen – es gilt für alles, was daraus entstanden ist.',
    'Ältere, von Hand geschnittene Videos werden jetzt richtig als fertige Videos benannt (nicht als „Rohvideo“); ältere Dateien warten nicht mehr 2 Tage auf ein Thema.',
  ] },
  { version: '1.23.0', date: '12.10.2026', items: [
    '🗂 Ordnung: Videos bekommen sprechende Namen (Datum, Spiel laut Claude, Titel, Short/Langfassung) und landen in Ordnern – Rohvideos\\Kanal\\Monat\\Spiel, Hochgeladen\\Kanal\\Jahr\\Monat. Läuft automatisch, nie während Schnitt oder Upload; jede Verschiebung lässt sich unter Einstellungen → Ordnung rückgängig machen.',
    '📚 Neuer Reiter Bibliothek: jede Aufnahme mit allem, was daraus entstanden ist (und ob es hochgeladen ist), nach Spiel sortiert, dazu Speicherplatz je Ordner und Aufräum-Vorschläge für Rohvideos, aus denen alles hochgeladen ist.',
    '☑ Mehrfachauswahl: „Auswählen“ → Videos antippen → gemeinsam in den Papierkorb legen, wiederherstellen oder endgültig löschen. Filter nach Spiel und Monat, Ansicht „Nach Aufnahme“ gruppiert.',
    '🔁 Überarbeiten schneidet immer neu aus dem kompletten Rohvideo – Claude darf früher weggeschnittene Stellen zurückholen (Shorts jetzt ±2 Minuten um den Clip), es geht also nichts nach und nach verloren.',
  ] },
  { version: '1.22.0', date: '12.10.2026', items: [
    '💳 Guthaben-Warnung: Oben erscheint ein Hinweis, wenn das Guthaben von fal.ai (Bilder, Musik, Sounds) oder Claude knapp wird oder ein Dienst „kein Guthaben“ meldet – mit Link zum Aufladen.',
    'fal.ai: echtes Guthaben über einen zusätzlichen Nur-Lese-Schlüssel (alle 6 Stunden abgefragt). Claude: Stand nach dem Aufladen eintragen, die Zentrale zieht ihren Verbrauch ab. Schwellen einstellbar unter Einstellungen → Guthaben.',
    'Fehler behoben: Ein gesperrtes fal.ai-Konto (Guthaben leer) wurde als „Schlüssel ungültig“ gemeldet.',
  ] },
  { version: '1.21.0', date: '12.10.2026', items: [
    '🎉 Effekte in Shorts: Claude ist jetzt Effekt-Regisseur – animierte Emojis 😱😂🔥, Soundeffekte, Blitz, Wackeln, Zoom-Punch, Freeze mit Text („WARTE …“), Zeitlupen-Wiederholung und KI-Comic-Sticker aus deinen Fotos. Jeder Effekt sitzt auf einem echten Moment, nicht überladen.',
    '⏪ Zurückspulen im VHS-Look mit Band-Sound, Hook-Vorschau startet mit Bass-Boom.',
    '🔊 Sound-Baukasten (30 Sounds, einmal per KI erzeugt, kommerziell nutzbar) unter Einstellungen → Sounds, mit Vorhören. Eigene Sounds in „musik\\sfx“ haben Vorrang. Fehlende Sounds entstehen beim Schnitt automatisch.',
    'Je Kanal einstellbar: Effekte aus / dezent / normal / viel, KI-Sticker an/aus (MichaModus = viel + Sticker, 3dbymicha = dezent, LinkedIn = aus). Beim Überarbeiten: „Mehr Effekte“, „Weniger Effekte“, „Ohne Effekte“.',
    'In der Liste sieht man jetzt überarbeitete Fassungen: grünes „🔁 v2“ an der neuen Fassung, „↳ hat v2“ am Original.',
  ] },
  { version: '1.20.0', date: '12.10.2026', items: [
    '⚡ Viral-Tipps werden jetzt umgesetzt: Sobald Claude das fertige Video bewertet hat, schneidet die Zentrale es einmal automatisch nach den Tipps zu Einstieg und Schnitt neu – als „v2“ zum Vergleichen.',
    'Oder von Hand: Knopf „⚡ Tipps umsetzen“ direkt beim Viral-Potenzial. Automatik abschaltbar unter Einstellungen → Claude.',
  ] },
  { version: '1.19.0', date: '12.10.2026', items: [
    '🔁 Überarbeiten jetzt auch bei Langfassung und Kurzfassung: Claude sieht sich die ganze Aufnahme an (Gesprochenes, laute Stellen, Standbilder) und schneidet sie nach deinem Wunsch neu – als „v2“ zum Vergleichen.',
    'Schnellwahl: „Intro raus“ (Lobby, Ladebildschirm, Menü, Warten), langweilige Stellen raus, nur die besten Stellen, Teaser mit dem Höhepunkt am Anfang, weniger Pausen, Outro kürzen, mit/ohne Musik – plus Ziellänge in Minuten.',
    'Teaser: ein 3–8 s Höhepunkt läuft ganz vorne mit großem Text, danach beginnt das Video.',
  ] },
  { version: '1.18.0', date: '12.10.2026', items: [
    '⚡ Hook-Schnitt: Claude sucht in jedem Short den stärksten Moment. Entweder kommt der Höhepunkt 1–2,5 s vorweg (mit Zoom), dann wird zurückgespult und der Clip läuft von vorn – oder der Short steigt direkt mitten in der Action ein. Dazu ein großer Hook-Text im ersten Bild.',
    '✂ Tempo: Sprechpausen und „ähm“ fliegen raus (nur wo es wirklich leise ist – Spiel-Action bleibt). Stufen je Kanal: aus / ruhig / normal / schnell (Jump Cuts + kurze Zooms). MichaModus = schnell, 3dbymicha = normal, LinkedIn = ruhig.',
    '🔁 Überarbeiten: Bei jedem Short sagen, was anders werden soll (Schnellwahl oder eigener Wunsch). Claude schneidet aus dem Rohvideo neu, die neue Fassung erscheint daneben als „v2“ – behalten oder verwerfen.',
    'Einstellbar unter Einstellungen → Kanäle (Hook-Stil, Tempo, Hinweis für Claude) und Automatischer Schnitt (Hook-Text an/aus). „ähm“ erscheint nie mehr in den Untertiteln.',
  ] },
  { version: '1.17.0', date: '11.10.2026', items: [
    '👀 Neue Leiste oben: Du siehst jederzeit, was die Zentrale gerade macht (Schritt, Video, Prozent, Warteschlange) und was dein Rechenhelfer macht (Spracherkennung für welches Video, seit wann) – oder ob beide arbeiten.',
    'Bei der Spracherkennung steht jetzt dabei, wer rechnet: Rechenhelfer, Server-Grafikkarte oder Server-Prozessor. Klick auf einen Eintrag öffnet das Video.',
  ] },
  { version: '1.16.2', date: '11.10.2026', items: [
    'Fehler behoben: Große Videos (z. B. 4 GB) blieben beim Hineinziehen in den Eingang bei ca. 70 % hängen. Sie gehen jetzt in 32-MB-Stücken hoch – bei einem Abbruch geht es an derselben Stelle weiter, mit Prozent, MB/s und Restzeit.',
    'Uploads zu YouTube und TikTok erkennen hängende Verbindungen und setzen selbst fort; der Grund steht beim Fortschritt (⚠). TikTok meldet Videos über 4 GB gleich verständlich.',
  ] },
  { version: '1.16.1', date: '11.10.2026', items: [
    'Fehler behoben: Rechenhelfer meldete „whisper.cpp fehlt“ – whisper.cpp hat die Namen seiner Download-Dateien geändert. Der Helfer findet jetzt beide Schreibweisen.',
    'Download-Fortschritt: Prozent, MB, Geschwindigkeit und Restzeit im Fenster des Helfers und live unter Einstellungen → Rechenhelfer. Abgebrochene Downloads werden fortgesetzt.',
    'Rechenhelfer-ZIP neu herunterladen, Dateien am PC ersetzen und „Einrichten.bat“ erneut ausführen.',
  ] },
  { version: '1.16.0', date: '11.10.2026', items: [
    '🎮 Rechenhelfer pausiert beim Zocken: wenn OBS läuft, ein Spiel aus deiner Liste läuft oder die Grafikkarte ausgelastet ist. Startest du mitten in einer Spracherkennung ein Spiel, bricht er sofort ab – die Zentrale rechnet dann selbst.',
    'Einstellbar unter Einstellungen → Rechenhelfer (Grenze für die Grafikkarten-Last, Spiele-Liste). Rechenhelfer-ZIP neu herunterladen und am PC ersetzen.',
  ] },
  { version: '1.15.1', date: '11.10.2026', items: [
    'Rechenhelfer 1.1: meldet sich sofort in der Zentrale und zeigt, was er gerade macht (lädt whisper.cpp, lädt Modell, bereit), lädt das Modell gleich beim Start und schreibt ein Protokoll (rechenhelfer.log).',
    'Bitte das Rechenhelfer-ZIP neu herunterladen, die Dateien am PC ersetzen und „Einrichten.bat“ erneut ausführen.',
  ] },
  { version: '1.15.0', date: '11.10.2026', items: [
    '📱 Handy & Tablet: Leiste unten (Posten, Freigabe, Eingang, Coach, Mehr), Videos im Vollbild, größere Knöpfe, Sprungleiste in den Einstellungen.',
    'Als App installierbar: eigenes Symbol auf dem Startbildschirm, startet ohne Browserleiste direkt in „Zum Posten“ (iPhone: Teilen → Zum Home-Bildschirm, Android: Menü → App installieren).',
  ] },
  { version: '1.14.0', date: '11.10.2026', items: [
    '🖥 Rechenhelfer: Dein PC mit NVIDIA-Grafikkarte übernimmt die Spracherkennung (großes Whisper-Modell) – genauer, schneller, der Server wird entlastet.',
    'Einrichten: Einstellungen → Rechenhelfer → einschalten → ZIP herunterladen → auf dem PC „Einrichten.bat“. Ist der PC aus, rechnet die Zentrale selbst.',
  ] },
  { version: '1.13.1', date: '11.10.2026', items: [
    'Fehler behoben: „Diashow“/Ruckler in der Langfassung. Die Schnitte ohne Neukodieren setzten nur an Keyframes an und schleppten bis zu 10 s doppelt mit. Jetzt wird bildgenau mit gleichmäßiger Bildrate neu kodiert (Grafikkarte).',
    'Betroffene Videos neu schneiden: Rohvideo öffnen → „So nochmal schneiden“.',
  ] },
  { version: '1.13.0', date: '11.10.2026', items: [
    'Tipps je Video: Einstieg/Hook, Schnitt, Titel/Bild und „Nächstes Mal beim Aufnehmen“ – unter „Viral-Potenzial“ im Video.',
    '💡 Coach: Claude schaut sich deine letzten Videos je Kanal an – was gut läuft, 5 persönliche Tipps für mehr Reichweite und Ideen für neue Videos.',
  ] },
  { version: '1.12.0', date: '11.10.2026', items: [
    'Mehr Clips: bis zu 10 je Video, MichaModus jetzt standardmäßig 6, 3dbymicha 4 (je Kanal einstellbar).',
    'Je Kanal festlegen, was Claude als Clips rausholen soll – MichaModus: Funny Moments, Ärger/Rage, Fails, Reaktionen, alles was Zuschauer bindet.',
    '🔥 Viral-Potenzial: Claude schätzt jedes Video/jeden Clip ehrlich ein (1–10) mit Begründung und Tipp für mehr Reichweite – auf der Karte und im Video.',
  ] },
  { version: '1.11.0', date: '11.10.2026', items: [
    '📱 „Zum Posten“: Handy-Ansicht mit allem, was du noch selbst posten musst (TikTok-Entwürfe, LinkedIn) – Text mit einem Tipp kopieren, „Gepostet“ abhaken.',
    'TikTok direkt veröffentlichen (Direct Post) mit Text, Sichtbarkeit, Kommentare/Duett/Stitch und Kennzeichnung von Werbung – nach den TikTok-Vorgaben. Einschalten unter Einstellungen → TikTok-App.',
    'Ohne TikTok-Prüfung sind direkt gepostete Videos nur für dich sichtbar – das ist die Grundlage für das Demo-Video zur Prüfung.',
  ] },
  { version: '1.10.1', date: '11.10.2026', items: [
    'TikTok: Die Zentrale zeigt, was TikTok zum Upload meldet (z. B. „an deinen Posteingang zugestellt“), mit Knopf „TikTok-Status abfragen“.',
    'Ohne Bestätigung von TikTok steht jetzt „unbestätigt“ statt eines Häkchens. Das Video findest du in der TikTok-App unter Posteingang → Benachrichtigungen („Dein Video von Zentrale ist bereit“).',
  ] },
  { version: '1.10.0', date: '11.10.2026', items: [
    'Hintergrundmusik ruhiger: Absenkung beim Sprechen einstellbar (aus / leicht / mittel / stark), neuer Standard „leicht“ (ca. 6 dB statt 17 dB).',
    'Musik-Lautstärke per Schieberegler, Standard etwas leiser als bisher (−30 LUFS).',
    'Jeder Musiktitel wird einmal gemessen und fest eingestellt – keine Lautstärke-Schwankungen mehr innerhalb des Titels.',
  ] },
  { version: '1.9.4', date: '11.10.2026', items: [
    'Titelbild herunterladen: Knopf am Titelbild, bei jedem KI-Vorschlag (⤓) und bei Shorts direkt im YouTube-Bereich – zum Setzen in der YouTube-App.',
  ] },
  { version: '1.9.3', date: '11.10.2026', items: [
    'YouTube: Die Zentrale zeigt jetzt eindeutig, ob das Titelbild übermittelt wurde (✓ mit Uhrzeit, Fehlertext oder „ohne Titelbild hochgeladen“), bei Shorts mit Hinweis auf die YouTube-App.',
  ] },
  { version: '1.9.2', date: '11.10.2026', items: [
    'YouTube: zusätzlicher Knopf „Videos von <Kanal> in Studio“ und Hinweis, falls Studio „Ein Fehler ist aufgetreten“ zeigt (dann ist dort ein anderer Kanal aktiv).',
  ] },
  { version: '1.9.1', date: '11.10.2026', items: [
    'Fehler behoben: TikTok-Upload brach bei Videos zwischen 5 und 10 MB mit „The chunk size is invalid“ ab. Videos bis 64 MB gehen jetzt in einem Stück. Einfach „Erneut versuchen“ klicken.',
  ] },
  { version: '1.9.0', date: '11.10.2026', items: [
    'LinkedIn: neuer Kanal „LinkedIn“ (als Person, Ich-Form). Videos aus dem Ordner „eingang-profi“ landen automatisch dort.',
    'Profi-Schnitt für LinkedIn: Clips im Format 4:5 (oder 1:1/16:9), ruhige Untertitel, keine Musik, Claude wählt Kernaussagen statt Gags.',
    'Claude schreibt den LinkedIn-Beitrag (seriös, mit Frage am Ende) und passende Hashtags. Im Video: „Video herunterladen“, „Beitrag kopieren“, „Als gepostet markieren“.',
    'Schnitt nach Wunsch: je Video wählen – Langfassung, Anzahl Shorts/Clips, Kurzfassung (1–10 Minuten, beste Stellen am Stück) – plus Wunsch in Worten an Claude.',
    'Papierkorb: Videos löschen mit Sicherheitsabfrage, wiederherstellen oder endgültig löschen; wird nach 30 Tagen automatisch geleert (einstellbar).',
  ] },
  { version: '1.8.0', date: '11.10.2026', items: [
    'Fehler behoben: Schnitt brach bei Unraid mit „EXDEV: cross-device link not permitted“ ab (appdata und Videos auf verschiedenen Laufwerken). Einfach „Erneut versuchen“ klicken.',
    'KI-Titelbilder jederzeit nachträglich: im Video unter dem Titelbild 1–3 Vorschläge erzeugen, eigenen Text eingeben, eins anklicken.',
    'Funktioniert auch ohne Claude-Vorschlag und für Shorts (Hochformat-Cover 9:16).',
    'Schon auf YouTube? „Titelbild auf YouTube aktualisieren“ tauscht es dort aus.',
  ] },
  { version: '1.7.0', date: '11.10.2026', items: [
    'Sicherung der Einstellungen: Kanäle, Verbindungen, Schlüssel, Videodaten, Fotos und Transkripte als ZIP.',
    'Täglich automatisch (Uhrzeit und Anzahl einstellbar), jederzeit „Jetzt sichern“ oder herunterladen.',
    'Wiederherstellen aus einer Datei oder einer Sicherung auf dem Server – der vorherige Stand wird vorher automatisch gesichert.',
  ] },
  { version: '1.6.0', date: '11.10.2026', items: [
    'Neuer Name: Micha’s Video-Zentrale.',
    'Hintergrundmusik: eigene Titel aus dem Ordner „musik“ (z. B. Epidemic Sound, je Kanal und Stimmung) oder KI-Musik über fal.ai (Sonilo, kommerziell nutzbar).',
    'Musik wird unter die Stimme gemischt und automatisch leiser, sobald du sprichst. Claude wählt je Short Stimmung und Musikstil.',
    'Versionierung: Version und Build oben rechts und in den Einstellungen, „Was ist neu“ nach jedem Update, Hinweis wenn ein neues Update bereitsteht.',
  ] },
  { version: '1.5.0', date: '11.10.2026', items: [
    'Whisper (Sprache → Text) läuft auf der Grafikkarte, sonst automatisch auf dem Prozessor.',
    'Nachtbetrieb: neue Aufnahmen nur in einem Zeitfenster schneiden (z. B. 01:00–07:00).',
    'KI-Titelbild: aus deinem Foto, einem Standbild und Claudes Idee malt die KI ein komplettes Titelbild.',
  ] },
  { version: '1.4.1', date: '11.10.2026', items: ['Freigestellte Fotos werden in den Einstellungen sofort ohne Hintergrund angezeigt.'] },
  { version: '1.4.0', date: '11.10.2026', items: [
    'Kodieren auf der Grafikkarte (NVENC), animierte Untertitel in Shorts, Facecam-Layout.',
    'Titelbilder mit deinen Fotos (fal.ai freistellen), KI-Aufwertung.',
  ] },
  { version: '1.3.0', date: '11.10.2026', items: ['Automatischer Schnitt (Langfassung + Shorts), Whisper-Transkript, Anmeldung bei YouTube/TikTok mit einem Klick (https).'] },
  { version: '1.2.0', date: '11.10.2026', items: ['Claude schlägt Titel, Beschreibung, Tags, Kanal und Titelbild vor.'] },
  { version: '1.1.0', date: '11.10.2026', items: ['Zwei Kanäle (MichaModus, 3dbymicha) mit eigenen YouTube-/TikTok-Verbindungen und Kanalvorschlag.'] },
  { version: '1.0.0', date: '11.10.2026', items: ['Erste Version: Videos prüfen, Texte/Titelbild anpassen, für YouTube (privat) und TikTok (Entwurf) freigeben.'] },
];
