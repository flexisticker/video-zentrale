// Was ist neu – neueste Version oben. Bei jeder Auslieferung ergänzen (und package.json-Version erhöhen).
export const CHANGELOG = [
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
