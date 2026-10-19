# Rechenhelfer für Micha's Video-Zentrale
# Läuft auf einem Windows-PC mit NVIDIA-Grafikkarte und übernimmt die Spracherkennung (Whisper, großes Modell)
# und ab 1.5 die PC-Analyse (Stimme trennen, Geräusche, Spieltexte – analyse.py mit Python/PyTorch),
# sobald die Grafikkarte freigegeben ist. Ist er aus oder gesperrt, rechnet die Zentrale wie bisher selbst.
#
#   Rechenhelfer.ps1             -> läuft im Fenster (Strg+C beendet)
#   Rechenhelfer.ps1 -Install    -> startet künftig automatisch bei der Anmeldung (Aufgabenplanung)
#   Rechenhelfer.ps1 -Uninstall  -> Autostart entfernen
#   Rechenhelfer.ps1 -Release stop|4|morning|0 -> Grafikkarte freigeben (bis gestoppt / 4 Std. / bis morgen 8 Uhr) bzw. sperren (0)
param([switch]$Install, [switch]$Uninstall, [string]$Release = '')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # macht Downloads in Windows PowerShell deutlich schneller
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Version = '1.5'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigFile = Join-Path $Here 'rechenhelfer.json'
$Home2 = if ($env:VZ_HELPER_HOME) { $env:VZ_HELPER_HOME } else { Join-Path $env:LOCALAPPDATA 'VideoZentrale-Rechenhelfer' }
$TaskName = 'Video-Zentrale Rechenhelfer'
New-Item -ItemType Directory -Force -Path $Home2, (Join-Path $Home2 'modelle'), (Join-Path $Home2 'tmp') | Out-Null

$LogFile = Join-Path $Home2 'rechenhelfer.log'
function Log($t) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'dd.MM. HH:mm:ss'), $t
  Write-Host $line
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8; if ((Get-Item $LogFile).Length -gt 1MB) { Move-Item $LogFile "$LogFile.alt" -Force } } catch { }
}
$Status = 'startet'

# ---------- Autostart ----------
if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Log 'Autostart entfernt.'; exit 0
}
if ($Install) {
  $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$($MyInvocation.MyCommand.Path)`""
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg -WorkingDirectory $Here
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Spracherkennung für die Video-Zentrale' -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Log 'Autostart eingerichtet und gestartet. Der Rechenhelfer läuft jetzt (minimiert) und startet bei jeder Anmeldung.'
  # Verknüpfungen auf dem Desktop: Grafikkarte freigeben / sperren
  try {
    $desk = [Environment]::GetFolderPath('Desktop')
    $sh = New-Object -ComObject WScript.Shell
    foreach ($x in @(@('Grafikkarte freigeben (Video-Zentrale)', 'stop'), @('Grafikkarte sperren (Video-Zentrale)', '0'))) {
      $lnk = $sh.CreateShortcut((Join-Path $desk ($x[0] + '.lnk')))
      $lnk.TargetPath = 'powershell.exe'
      $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Release $($x[1])"
      $lnk.WorkingDirectory = $Here
      $lnk.IconLocation = if ($x[1] -eq '0') { 'imageres.dll,100' } else { 'imageres.dll,101' }
      $lnk.Save()
    }
    Log 'Desktop-Verknüpfungen „Grafikkarte freigeben/sperren“ angelegt.'
  } catch { Log ('Desktop-Verknüpfungen nicht angelegt: ' + $_.Exception.Message) }
  exit 0
}

# ---------- Einstellungen ----------
if (-not (Test-Path $ConfigFile)) { throw "rechenhelfer.json fehlt – bitte das ZIP aus der Zentrale (Einstellungen → Rechenhelfer) verwenden." }
$cfg = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
$Base = $cfg.url.TrimEnd('/')
$Headers = @{ 'X-Helper-Token' = $cfg.token }
$Pc = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { [Environment]::MachineName }

# ---------- Grafikkarte freigeben / sperren (Desktop-Verknüpfung) ----------
if ($Release -ne '') {
  try {
    $h = if ($Release -match '^\d+$') { [int]$Release } else { $Release }
    $r = Invoke-RestMethod -Method Post -Uri "$Base/api/helper/release" -Headers $Headers -ContentType 'application/json' -Body (@{ hours = $h } | ConvertTo-Json)
    if ($r.released) {
      $bis = if ($r.until) { ([DateTime]::Parse($r.until)).ToLocalTime().ToString('dd.MM. HH:mm') } else { '' }
      Write-Host "Grafikkarte FREIGEGEBEN – die Zentrale darf jetzt rechnen$(if ($Release -eq 'stop') { ' (bis du sperrst oder ein Spiel/OBS startest)' } elseif ($bis) { " (bis $bis)" })." -ForegroundColor Green
    } else { Write-Host 'Grafikkarte GESPERRT – die Zentrale rechnet selbst.' -ForegroundColor Yellow }
  } catch { Write-Host ('Zentrale nicht erreichbar: ' + $_.Exception.Message) -ForegroundColor Red }
  Start-Sleep -Seconds 3
  exit 0
}

# ---------- Download mit Fortschritt (Log + Anzeige in der Zentrale), setzt abgebrochene Downloads fort ----------
function Get-Download($url, $file, $label) {
  $part = "$file.part"
  $have = if (Test-Path $part) { (Get-Item $part).Length } else { 0 }
  $req = [Net.HttpWebRequest]::Create($url)
  $req.UserAgent = 'video-zentrale'
  $req.AllowAutoRedirect = $true
  $req.Timeout = 60000; $req.ReadWriteTimeout = 120000
  if ($have -gt 0) { $req.AddRange([long]$have) }
  $res = $req.GetResponse()
  try {
    $resumed = ($have -gt 0 -and [int]$res.StatusCode -eq 206)
    if (-not $resumed) { $have = 0 }
    $total = if ($res.ContentLength -gt 0) { $res.ContentLength + $have } else { 0 }
    if ($resumed) { Log ("{0}: setze fort bei {1:N0} MB" -f $label, ($have / 1MB)) }
    $in = $res.GetResponseStream()
    $out = [IO.File]::Open($part, $(if ($resumed) { [IO.FileMode]::Append } else { [IO.FileMode]::Create }), [IO.FileAccess]::Write)
    try {
      $buf = New-Object byte[] (1MB)
      $done = $have; $lastShow = Get-Date; $lastLog = -10; $t0 = Get-Date; $start = $have
      while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
        $out.Write($buf, 0, $n); $done += $n
        if (((Get-Date) - $lastShow).TotalSeconds -ge 5) {
          $lastShow = Get-Date
          $sec = [Math]::Max(1, ((Get-Date) - $t0).TotalSeconds)
          $speed = ($done - $start) / $sec
          if ($total -gt 0) {
            $pct = [Math]::Floor($done * 100 / $total)
            $rest = if ($speed -gt 0) { [TimeSpan]::FromSeconds(($total - $done) / $speed) } else { $null }
            $txt = "{0}: {1} % ({2:N0} von {3:N0} MB, {4:N1} MB/s{5})" -f $label, $pct, ($done / 1MB), ($total / 1MB), ($speed / 1MB), $(if ($rest) { ', noch ca. ' + [Math]::Ceiling($rest.TotalMinutes) + ' Min.' } else { '' })
            if ($pct -ge $lastLog + 10) { $lastLog = $pct - ($pct % 10); Log $txt }
          } else { $txt = "{0}: {1:N0} MB geladen ({2:N1} MB/s)" -f $label, ($done / 1MB), ($speed / 1MB) }
          Write-Host "`r$txt      " -NoNewline
          Say-Hello $txt
        }
      }
      Write-Host ''
    } finally { $out.Close(); $in.Close() }
  } finally { $res.Close() }
  if ($total -gt 0 -and (Get-Item $part).Length -lt $total) { throw "$label unvollständig – wird beim nächsten Versuch fortgesetzt." }
  Move-Item $part $file -Force
  Log "$label fertig ($('{0:N0}' -f ((Get-Item $file).Length / 1MB)) MB)."
}

# ---------- whisper.cpp mit CUDA besorgen ----------
# Dateinamen der Releases haben sich geändert: früher whisper-cublas-12.x-bin-x64.zip, seit 2026 whisper-bin-win-cuda-12.4.0-x64.zip.
function Find-WhisperAsset {
  $rels = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=10' -Headers @{ 'User-Agent' = 'video-zentrale' }
  foreach ($rel in @($rels | Where-Object { -not $_.draft -and -not $_.prerelease })) {
    $a = $rel.assets | Where-Object { $_.name -match '^whisper-bin-win-cuda-12[\d.]*-x64\.zip$' -or $_.name -match '^whisper-cublas-12[\d.]*-bin-x64\.zip$' } |
      Sort-Object name -Descending | Select-Object -First 1
    if ($a) { return @{ rel = $rel; asset = $a; cuda = $true } }
  }
  foreach ($rel in @($rels | Where-Object { -not $_.draft -and -not $_.prerelease })) {
    $a = $rel.assets | Where-Object { $_.name -match '^whisper-bin-x64\.zip$' } | Select-Object -First 1
    if ($a) { Log 'Keine CUDA-Version gefunden – nehme CPU-Version.'; return @{ rel = $rel; asset = $a; cuda = $false } }
  }
  $names = (@($rels)[0].assets | ForEach-Object { $_.name }) -join ', '
  throw "Keine passende whisper.cpp-Datei gefunden (vorhanden: $names)"
}
function Get-WhisperExe {
  if ($env:VZ_WHISPER_EXE) { return $env:VZ_WHISPER_EXE }   # nur für Tests
  $exe = Get-ChildItem -Path (Join-Path $Home2 'whisper') -Recurse -Filter 'whisper-cli.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) { return $exe.FullName }
  Log 'Suche whisper.cpp (CUDA) auf GitHub …'
  $f = Find-WhisperAsset
  $zip = Join-Path $Home2 'whisper.zip'
  Get-Download $f.asset.browser_download_url $zip "whisper.cpp $($f.rel.tag_name)"
  Expand-Archive -Path $zip -DestinationPath (Join-Path $Home2 'whisper') -Force
  Remove-Item $zip -Force
  Log "whisper.cpp $($f.rel.tag_name) ($($f.asset.name)) installiert."
  $exe = Get-ChildItem -Path (Join-Path $Home2 'whisper') -Recurse -Filter 'whisper-cli.exe' | Select-Object -First 1
  if (-not $exe) { throw 'whisper-cli.exe nicht im Archiv gefunden.' }
  return $exe.FullName
}

function Get-Model($name) {
  $file = Join-Path $Home2 "modelle\ggml-$name.bin"
  if (Test-Path $file) { return $file }
  Log "Lade Whisper-Modell „$name“ (einmalig, ca. 1,5–3 GB) …"
  Get-Download "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$name.bin" $file "Modell $name"
  return $file
}

function Send-Json($path, $obj) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  Invoke-RestMethod -Uri "$Base$path" -Method Post -Headers $Headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 30 | Out-Null
}
$Gaming = @{ enabled = $true; gpuLoad = 25; games = @() }   # kommt von der Zentrale
$Caps = @('whisper')            # was dieser PC kann (analyse kommt dazu, sobald Python eingerichtet ist)
$WantAnalyse = $true

# ---------- Python + PyTorch (CUDA) für die PC-Analyse einrichten (einmalig, ohne Administratorrechte) ----------
# uv (Astral) lädt eine eigene Python-Version und die Pakete in den Ordner des Rechenhelfers – nichts wird systemweit installiert.
$PyDir = Join-Path $Home2 'py'
$PyExe = if ($env:VZ_PYTHON) { $env:VZ_PYTHON } else { Join-Path $PyDir 'Scripts\python.exe' }
$PyMarker = Join-Path $Home2 'py-bereit-1.txt'
$env:HF_HOME = Join-Path $Home2 'hf'; $env:TORCH_HOME = Join-Path $Home2 'torch'
$env:UV_CACHE_DIR = Join-Path $Home2 'uv-cache'; $env:UV_PYTHON_INSTALL_DIR = Join-Path $Home2 'python'
$env:PYTHONIOENCODING = 'utf-8'
function Ensure-Python {
  if ($env:VZ_PYTHON -or (Test-Path $PyMarker)) { return $true }
  try {
    $uvDir = Join-Path $Home2 'uv'
    $uv = Get-ChildItem -Path $uvDir -Recurse -Filter 'uv.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $uv) {
      Say-Hello 'lädt Python-Werkzeug (uv)'
      $zip = Join-Path $Home2 'uv.zip'
      Get-Download 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' $zip 'uv'
      Expand-Archive -Path $zip -DestinationPath $uvDir -Force; Remove-Item $zip -Force
      $uv = Get-ChildItem -Path $uvDir -Recurse -Filter 'uv.exe' | Select-Object -First 1
    }
    $uv = $uv.FullName
    Log 'Richte Python für die PC-Analyse ein (einmalig, ca. 5 GB, 15–60 Min.) …'
    Say-Hello 'lädt Python (einmalig)'
    & $uv venv --python 3.11 $PyDir 2>&1 | ForEach-Object { Log "uv: $_" }
    if ($LASTEXITCODE -ne 0) { throw 'Python-Umgebung konnte nicht angelegt werden.' }
    Say-Hello 'lädt PyTorch mit CUDA (einmalig, ca. 2,5 GB)'
    & $uv pip install --python $PyExe torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu124 2>&1 | ForEach-Object { Log "uv: $_" }
    if ($LASTEXITCODE -ne 0) { throw 'PyTorch konnte nicht installiert werden.' }
    Say-Hello 'lädt Demucs, Geräusch- und Texterkennung (einmalig)'
    & $uv pip install --python $PyExe demucs==4.0.1 transformers easyocr soundfile 2>&1 | ForEach-Object { Log "uv: $_" }
    if ($LASTEXITCODE -ne 0) { throw 'Analyse-Pakete konnten nicht installiert werden.' }
    $test = & $PyExe -c "import torch, demucs, transformers, easyocr, soundfile; print('CUDA' if torch.cuda.is_available() else 'CPU')" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Selbsttest fehlgeschlagen: $test" }
    Set-Content -Path $PyMarker -Value "eingerichtet $(Get-Date) – $test" -Encoding UTF8
    Log "Python für die PC-Analyse bereit ($test). Modelle (Demucs, AST, EasyOCR, zusammen ca. 600 MB) lädt der erste Auftrag."
    return $true
  } catch {
    Log "PC-Analyse nicht eingerichtet: $($_.Exception.Message) – Spracherkennung läuft weiter, neuer Versuch beim nächsten Start."
    return $false
  }
}
function Say-Hello($status, $paused = $false) {
  $script:Status = $status
  try {
    $r = Invoke-RestMethod -Uri "$Base/api/helper/hello" -Method Post -Headers $Headers -ContentType 'application/json; charset=utf-8' -TimeoutSec 30 `
      -Body ([Text.Encoding]::UTF8.GetBytes((@{ name = $Pc; gpu = $gpu; version = $Version; status = $status; paused = [bool]$paused; caps = $script:Caps } | ConvertTo-Json -Compress)))
    if ($r.gaming) { $script:Gaming = $r.gaming }
    if ($null -ne $r.analyse) { $script:WantAnalyse = [bool]$r.analyse }
  } catch { Log "Zentrale nicht erreichbar: $($_.Exception.Message)" }
}

# Wird gerade gezockt? OBS läuft, ein Spiel aus der Liste läuft oder die Grafikkarte ist (ohne uns) ausgelastet.
$Smi = @("$env:SystemRoot\System32\nvidia-smi.exe", "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
function Get-GpuLoad {
  if (-not $Smi) { return 0 }
  try { return [int](& $Smi --query-gpu=utilization.gpu --format=csv,noheader,nounits | Select-Object -First 1) } catch { return 0 }
}
function Get-GamingReason {
  if (-not $Gaming.enabled) { return $null }
  $obs = Get-Process -Name 'obs64', 'obs32', 'obs' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($obs) { return 'OBS läuft' }
  foreach ($g in @($Gaming.games)) { if ($g -and (Get-Process -Name $g -ErrorAction SilentlyContinue)) { return "$g läuft" } }
  $load = Get-GpuLoad
  if ($load -ge [int]$Gaming.gpuLoad) { return "Grafikkarte zu $load % ausgelastet" }
  return $null
}

$gpu = try { (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'NVIDIA' } | Select-Object -First 1).Name } catch { $null }
if (-not $gpu) { $gpu = 'keine NVIDIA-Grafikkarte gefunden (rechnet auf dem Prozessor)' }
Log "Rechenhelfer $Version startet · $Pc · $gpu"
Log "Protokoll: $LogFile"
Say-Hello 'lädt whisper.cpp'
$Exe = $null
while (-not $Exe) {
  try { $Exe = Get-WhisperExe }
  catch { Log "whisper.cpp konnte nicht geladen werden: $($_.Exception.Message) – neuer Versuch in 2 Minuten."; Say-Hello "Fehler: whisper.cpp fehlt ($($_.Exception.Message))"; Start-Sleep 120 }
}
$threads = [Math]::Max(2, [Math]::Min(8, [Environment]::ProcessorCount))


# Modell gleich beim Start laden (sonst wartet der erste Auftrag)
try {
  $hi = Invoke-RestMethod -Uri "$Base/api/helper/hello" -Method Post -Headers $Headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes('{"status":"startet"}')) -TimeoutSec 30
  if ($hi.model) { Say-Hello "lädt Modell $($hi.model)"; [void](Get-Model $hi.model) }
} catch { Log "Modell vorab laden ging nicht: $($_.Exception.Message)" }
if ($WantAnalyse -and (Ensure-Python)) { $Caps = @('whisper', 'analyse') }
Say-Hello 'bereit'
Log "Verbunden mit $Base – warte auf Aufträge (Fenster offen lassen bzw. minimieren)."
$Analyse = Join-Path $Here 'analyse.py'

# Läuft ein Prozess, prüft alle 3 s, ob gezockt wird (OBS/Spieleliste) → abbrechen und Grafikkarte freigeben
function Wait-Proc($proc, $onTick) {
  while (-not $proc.HasExited) {
    Start-Sleep 3
    if ($onTick) { & $onTick }
    $obs = Get-Process -Name 'obs64', 'obs32', 'obs' -ErrorAction SilentlyContinue | Select-Object -First 1
    $game = @($Gaming.games) | Where-Object { $_ -and (Get-Process -Name $_ -ErrorAction SilentlyContinue) } | Select-Object -First 1
    if ($Gaming.enabled -and ($obs -or $game)) { Stop-Process -Id $proc.Id -Force; return $(if ($obs) { 'OBS gestartet' } else { "$game gestartet" }) }
  }
  return $null
}

# PC-Analyse: Ton + Bilder holen, analyse.py rechnen lassen, Stimme hochladen, Ergebnis schicken
function Run-Analyse($job) {
  $tmp = Join-Path $Home2 'tmp'
  $dir = Join-Path $tmp $job.id
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  try {
    $audio = Join-Path $dir 'audio.flac'; $frames = Join-Path $dir 'bilder.zip'; $out = Join-Path $dir 'out'
    Invoke-WebRequest -Uri "$Base/api/helper/job/$($job.id)/file/audio" -Headers $Headers -OutFile $audio -UseBasicParsing
    if (@($job.files) -contains 'frames') { Invoke-WebRequest -Uri "$Base/api/helper/job/$($job.id)/file/frames" -Headers $Headers -OutFile $frames -UseBasicParsing }
    $p = $job.params
    $argsA = @("`"$Analyse`"", '--audio', "`"$audio`"", '--out', "`"$out`"", '--home', "`"$Home2`"",
      '--demucs', [int][bool]$p.demucs, '--events', [int][bool]$p.events, '--ocr', [int]([bool]$p.ocr -and (Test-Path $frames)))
    if (Test-Path $frames) { $argsA += @('--frames', "`"$frames`"") }
    $logOut = Join-Path $dir 'analyse.log'; $logErr = Join-Path $dir 'analyse-fehler.log'
    $sp = @{ FilePath = $PyExe; ArgumentList = $argsA; PassThru = $true; RedirectStandardOutput = $logOut; RedirectStandardError = $logErr }
    if (-not $IsLinux) { $sp.WindowStyle = 'Hidden' }
    $proc = Start-Process @sp
    $null = $proc.Handle
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $tick = {
      $last = Get-Content $logOut -Tail 5 -ErrorAction SilentlyContinue | Where-Object { $_ -like 'PROGRESS *' } | Select-Object -Last 1
      if ($last -and $last -ne $script:LastProg) { $script:LastProg = $last; $parts = $last -split ' ', 3; Say-Hello ("PC-Analyse {0} % – {1}" -f $parts[1], $parts[2]) }
    }
    $stopped = Wait-Proc $proc $tick
    if ($stopped) { throw "abgebrochen – $stopped (Grafikkarte freigegeben)" }
    $res = Join-Path $out 'result.json'
    if ($proc.ExitCode -ne 0 -or -not (Test-Path $res)) {
      $why = (Get-Content $logOut, $logErr -ErrorAction SilentlyContinue | Where-Object { $_ -match 'FEHLER|Error|error' } | Select-Object -Last 2) -join ' '
      throw "Analyse beendet mit Code $($proc.ExitCode) $why"
    }
    $voice = Join-Path $out 'voice.wav'
    if (Test-Path $voice) {
      Say-Hello 'PC-Analyse: lade Stimme hoch'
      Invoke-WebRequest -Uri "$Base/api/helper/job/$($job.id)/upload/voice.wav" -Method Post -Headers $Headers -InFile $voice -ContentType 'application/octet-stream' -UseBasicParsing -TimeoutSec 1800 | Out-Null
    }
    $json = [IO.File]::ReadAllText($res, [Text.Encoding]::UTF8)
    Invoke-RestMethod -Uri "$Base/api/helper/job/$($job.id)/result" -Method Post -Headers $Headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 120 | Out-Null
    Log ("PC-Analyse fertig in {0:N0} s." -f $sw.Elapsed.TotalSeconds)
  } finally {
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

while ($true) {
  try {
    $why = Get-GamingReason
    if ($why) {
      if ($Status -notlike 'pausiert*') { Log "Pause – $why. Die Zentrale rechnet solange selbst." }
      Say-Hello "pausiert ($why)" $true
      Start-Sleep 15
      continue
    }
    if ($Status -like 'pausiert*') { Log 'Weiter – Grafikkarte wieder frei.' }
    Say-Hello 'bereit'
    $job = Invoke-RestMethod -Uri "$Base/api/helper/next?caps=$($Caps -join ',')" -Headers $Headers -TimeoutSec 40
    if (-not $job -or -not $job.id) { continue }
    if ($job.kind -eq 'analyse') {
      Log "Auftrag $($job.id): PC-Analyse (Stimme trennen, Geräusche, Spieltexte) …"
      try { Run-Analyse $job }
      catch {
        Log "Fehler: $($_.Exception.Message)"
        try { Send-Json "/api/helper/job/$($job.id)/error" @{ message = $_.Exception.Message } } catch { }
      }
      continue
    }
    Log "Auftrag $($job.id): Spracherkennung mit Modell $($job.model) …"
    $tmp = Join-Path $Home2 'tmp'
    $wav = Join-Path $tmp "$($job.id).wav"
    $out = Join-Path $tmp $job.id
    try {
      $model = Get-Model $job.model
      Invoke-WebRequest -Uri "$Base/api/helper/job/$($job.id)/audio" -Headers $Headers -OutFile $wav -UseBasicParsing
      $sw = [Diagnostics.Stopwatch]::StartNew()
      $argsW = @('-m', "`"$model`"", '-f', "`"$wav`"", '-l', $job.lang, '-ml', '1', '-sow', '-oj', '-of', "`"$out`"", '-t', $threads)
      $sp = @{ FilePath = $Exe; ArgumentList = $argsW; PassThru = $true }
      if (-not $IsLinux) { $sp.WindowStyle = 'Hidden' }   # unter Windows ohne eigenes Fenster
      $proc = Start-Process @sp
      $null = $proc.Handle   # sonst liefert ExitCode in Windows PowerShell manchmal nichts
      $stopped = $null
      while (-not $proc.HasExited) {
        Start-Sleep 3
        # Während Whisper selbst rechnet, zählt nur OBS/Spieleliste (die Grafiklast kommt ja von uns)
        $obs = Get-Process -Name 'obs64', 'obs32', 'obs' -ErrorAction SilentlyContinue | Select-Object -First 1
        $game = @($Gaming.games) | Where-Object { $_ -and (Get-Process -Name $_ -ErrorAction SilentlyContinue) } | Select-Object -First 1
        if ($Gaming.enabled -and ($obs -or $game)) { $stopped = if ($obs) { 'OBS gestartet' } else { "$game gestartet" }; Stop-Process -Id $proc.Id -Force; break }
      }
      if ($stopped) { throw "abgebrochen – $stopped (Grafikkarte freigegeben)" }
      if ($proc.ExitCode -ne 0 -or -not (Test-Path "$out.json")) { throw "whisper-cli beendet mit Code $($proc.ExitCode)" }
      $result = Get-Content "$out.json" -Raw -Encoding UTF8 | ConvertFrom-Json
      Send-Json "/api/helper/job/$($job.id)/result" $result
      Log ("Fertig in {0:N0} s." -f $sw.Elapsed.TotalSeconds)
    } catch {
      Log "Fehler: $($_.Exception.Message)"
      try { Send-Json "/api/helper/job/$($job.id)/error" @{ message = $_.Exception.Message } } catch { }
    } finally {
      Remove-Item $wav, "$out.json" -Force -ErrorAction SilentlyContinue
    }
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 401) { Log 'Schlüssel ungültig oder Rechenhelfer in der Zentrale ausgeschaltet – prüfe in 60 s erneut.'; Start-Sleep 60 }
    else { Log "Zentrale nicht erreichbar ($($_.Exception.Message)) – neuer Versuch in 20 s."; Start-Sleep 20 }
  }
}
