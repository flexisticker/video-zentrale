# OBS-Sortierer
# Prüft den Aufnahmeordner und verschiebt fertige Aufnahmen in den Zielordner (Eingang der Video-Zentrale).
# "Fertig" heißt: OBS schreibt nicht mehr an der Datei (sie ist nicht mehr gesperrt)
# und sie wurde seit $RuheMinuten nicht mehr verändert.
# Läuft über die Windows-Aufgabenplanung (siehe Installieren.ps1) oder von Hand.

# ---------------- Einstellungen ----------------
$Quelle      = 'F:\OBS - VIDEO Aufnahmen'
# Ziel = Eingang der Video-Zentrale auf Unraid (Freigabe "videos").
# Ohne Zentrale z. B. 'F:\OBS - VIDEO Aufnahmen\Fertig' eintragen.
$Ziel        = '\\PowerServer\videos\eingang'
$Endungen    = @('.mkv', '.mp4', '.mov', '.flv', '.ts', '.m4v', '.webm')
$RuheMinuten = 2

# MKV verlustfrei in MP4 umpacken (dauert nur Sekunden, Qualität bleibt gleich).
# Braucht ffmpeg (https://www.gyan.dev/ffmpeg/builds/ oder: winget install Gyan.FFmpeg).
$Umpacken          = $false
# Nach erfolgreichem Umpacken: Original-MKV behalten (in "Fertig\MKV-Original") oder löschen.
$OriginalBehalten  = $true
# Vorschaubild (JPG) aus der Videomitte neben das fertige Video legen (braucht ffmpeg).
$Vorschaubild      = $false
$FfmpegPfad        = 'ffmpeg'   # oder voller Pfad, z. B. 'C:\ffmpeg\bin\ffmpeg.exe'
# ------------------------------------------------

$ErrorActionPreference = 'Stop'
$LogDatei = Join-Path $Quelle 'OBS-Sortierer.log'

function Log($text) {
    $zeile = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
    Write-Output $zeile
    try { Add-Content -LiteralPath $LogDatei -Value $zeile -Encoding UTF8 } catch { }
}

function IstFrei($pfad) {
    # OBS hält die Datei während der Aufnahme offen -> exklusives Öffnen schlägt fehl.
    try {
        $s = [System.IO.File]::Open($pfad, 'Open', 'Read', 'None')
        $s.Close()
        return $true
    } catch {
        return $false
    }
}

function FreierName($ordner, $name) {
    $ziel = Join-Path $ordner $name
    if (-not (Test-Path -LiteralPath $ziel)) { return $ziel }
    $basis = [System.IO.Path]::GetFileNameWithoutExtension($name)
    $endung = [System.IO.Path]::GetExtension($name)
    $n = 2
    while ($true) {
        $ziel = Join-Path $ordner ('{0} ({1}){2}' -f $basis, $n, $endung)
        if (-not (Test-Path -LiteralPath $ziel)) { return $ziel }
        $n++
    }
}

function Ffmpeg([string[]]$argumente) {
    $p = Start-Process -FilePath $FfmpegPfad -ArgumentList $argumente -NoNewWindow -Wait -PassThru `
        -RedirectStandardError (Join-Path $env:TEMP 'obs-sortierer-ffmpeg.txt')
    return $p.ExitCode -eq 0
}

function Q($pfad) { '"' + $pfad + '"' }

# Nur eine Instanz gleichzeitig (Aufgabenplanung startet alle paar Minuten).
$mutex = New-Object System.Threading.Mutex($false, 'Global\OBS-Sortierer')
if (-not $mutex.WaitOne(0)) { exit 0 }

try {
    if (-not (Test-Path -LiteralPath $Quelle)) { Write-Output "Ordner fehlt: $Quelle"; exit 1 }
    if (-not (Test-Path -LiteralPath $Ziel)) { New-Item -ItemType Directory -Path $Ziel | Out-Null }

    $grenze = (Get-Date).AddMinutes(-$RuheMinuten)
    # Nur Dateien direkt im Aufnahmeordner, Unterordner (auch "Fertig") bleiben unberührt.
    $dateien = Get-ChildItem -LiteralPath $Quelle -File |
        Where-Object { $Endungen -contains $_.Extension.ToLower() -and $_.LastWriteTime -lt $grenze -and $_.Length -gt 0 }

    foreach ($d in $dateien) {
        if (-not (IstFrei $d.FullName)) { continue }   # wird noch aufgenommen

        $ergebnis = $null
        if ($Umpacken -and $d.Extension.ToLower() -eq '.mkv') {
            $mp4 = FreierName $Ziel ($d.BaseName + '.mp4')
            $ok = Ffmpeg @('-hide_banner', '-loglevel', 'error', '-y', '-i', (Q $d.FullName),
                           '-map', '0', '-c', 'copy', '-movflags', '+faststart', (Q $mp4))
            if ($ok -and (Test-Path -LiteralPath $mp4) -and (Get-Item -LiteralPath $mp4).Length -gt 0) {
                if ($OriginalBehalten) {
                    $archiv = Join-Path $Ziel 'MKV-Original'
                    if (-not (Test-Path -LiteralPath $archiv)) { New-Item -ItemType Directory -Path $archiv | Out-Null }
                    Move-Item -LiteralPath $d.FullName -Destination (FreierName $archiv $d.Name)
                } else {
                    Remove-Item -LiteralPath $d.FullName
                }
                $ergebnis = $mp4
                Log "Umgepackt: $($d.Name) -> $([System.IO.Path]::GetFileName($mp4))"
            } else {
                if (Test-Path -LiteralPath $mp4) { Remove-Item -LiteralPath $mp4 -ErrorAction SilentlyContinue }
                Log "Umpacken fehlgeschlagen, verschiebe Original: $($d.Name)"
            }
        }

        if (-not $ergebnis) {
            $ergebnis = FreierName $Ziel $d.Name
            Move-Item -LiteralPath $d.FullName -Destination $ergebnis
            Log "Verschoben: $($d.Name)"
        }

        if ($Vorschaubild) {
            $jpg = [System.IO.Path]::ChangeExtension($ergebnis, '.jpg')
            # Bild bei 50 % der Laufzeit; thumbnail-Filter wählt ein aussagekräftiges Bild in der Nähe.
            $dauer = 0
            try {
                $probe = Join-Path ([System.IO.Path]::GetDirectoryName($FfmpegPfad)) 'ffprobe'
                if (-not [System.IO.Path]::GetDirectoryName($FfmpegPfad)) { $probe = 'ffprobe' }
                $dauer = [double](& $probe -v error -show_entries format=duration -of csv=p=0 $ergebnis)
            } catch { }
            $start = [string][math]::Floor($dauer / 2)
            if (Ffmpeg @('-hide_banner', '-loglevel', 'error', '-y', '-ss', $start, '-i', (Q $ergebnis),
                         '-vf', 'thumbnail,scale=1280:-2', '-frames:v', '1', '-q:v', '3', (Q $jpg))) {
                Log "Vorschaubild: $([System.IO.Path]::GetFileName($jpg))"
            }
        }
    }
} catch {
    Log "Fehler: $($_.Exception.Message)"
} finally {
    $mutex.ReleaseMutex()
}
