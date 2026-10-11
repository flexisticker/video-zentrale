// Was ist neu – neueste Version oben. Bei jeder Auslieferung ergänzen (und package.json-Version erhöhen).
export const CHANGELOG = [
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
