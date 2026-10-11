# Rechenhelfer für Micha's Video-Zentrale
# Läuft auf einem Windows-PC mit NVIDIA-Grafikkarte und übernimmt die Spracherkennung (Whisper, großes Modell),
# solange der PC an ist. Ist er aus, rechnet die Zentrale wie bisher selbst.
#
#   Rechenhelfer.ps1             -> läuft im Fenster (Strg+C beendet)
#   Rechenhelfer.ps1 -Install    -> startet künftig automatisch bei der Anmeldung (Aufgabenplanung)
#   Rechenhelfer.ps1 -Uninstall  -> Autostart entfernen
param([switch]$Install, [switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # macht Downloads in Windows PowerShell deutlich schneller
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Version = '1.0'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigFile = Join-Path $Here 'rechenhelfer.json'
$Home2 = if ($env:VZ_HELPER_HOME) { $env:VZ_HELPER_HOME } else { Join-Path $env:LOCALAPPDATA 'VideoZentrale-Rechenhelfer' }
$TaskName = 'Video-Zentrale Rechenhelfer'
New-Item -ItemType Directory -Force -Path $Home2, (Join-Path $Home2 'modelle'), (Join-Path $Home2 'tmp') | Out-Null

function Log($t) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $t) }

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
  exit 0
}

# ---------- Einstellungen ----------
if (-not (Test-Path $ConfigFile)) { throw "rechenhelfer.json fehlt – bitte das ZIP aus der Zentrale (Einstellungen → Rechenhelfer) verwenden." }
$cfg = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
$Base = $cfg.url.TrimEnd('/')
$Headers = @{ 'X-Helper-Token' = $cfg.token }
$Pc = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { [Environment]::MachineName }

# ---------- whisper.cpp mit CUDA besorgen ----------
function Get-WhisperExe {
  if ($env:VZ_WHISPER_EXE) { return $env:VZ_WHISPER_EXE }   # nur für Tests
  $exe = Get-ChildItem -Path (Join-Path $Home2 'whisper') -Recurse -Filter 'whisper-cli.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) { return $exe.FullName }
  Log 'Lade whisper.cpp (CUDA) von GitHub …'
  $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest' -Headers @{ 'User-Agent' = 'video-zentrale' }
  $asset = $rel.assets | Where-Object { $_.name -match '^whisper-cublas-12.*-bin-x64\.zip$' } | Sort-Object name -Descending | Select-Object -First 1
  if (-not $asset) { $asset = $rel.assets | Where-Object { $_.name -match '^whisper-bin-x64\.zip$' } | Select-Object -First 1; Log 'Keine CUDA-Version gefunden – nehme CPU-Version.' }
  if (-not $asset) { throw 'Keine passende whisper.cpp-Datei im aktuellen Release gefunden.' }
  $zip = Join-Path $Home2 'whisper.zip'
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath (Join-Path $Home2 'whisper') -Force
  Remove-Item $zip -Force
  Log "whisper.cpp $($rel.tag_name) ($($asset.name)) installiert."
  $exe = Get-ChildItem -Path (Join-Path $Home2 'whisper') -Recurse -Filter 'whisper-cli.exe' | Select-Object -First 1
  if (-not $exe) { throw 'whisper-cli.exe nicht im Archiv gefunden.' }
  return $exe.FullName
}

function Get-Model($name) {
  $file = Join-Path $Home2 "modelle\ggml-$name.bin"
  if (Test-Path $file) { return $file }
  Log "Lade Whisper-Modell „$name“ (einmalig, ca. 1,5–3 GB) …"
  $part = "$file.part"
  Invoke-WebRequest -Uri "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$name.bin" -OutFile $part -UseBasicParsing
  Move-Item $part $file -Force
  Log 'Modell geladen.'
  return $file
}

$gpu = try { (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'NVIDIA' } | Select-Object -First 1).Name } catch { $null }
if (-not $gpu) { $gpu = 'keine NVIDIA-Grafikkarte gefunden (rechnet auf dem Prozessor)' }
$Exe = Get-WhisperExe
$threads = [Math]::Max(2, [Math]::Min(8, [Environment]::ProcessorCount))

function Send-Json($path, $obj) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  Invoke-RestMethod -Uri "$Base$path" -Method Post -Headers $Headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) | Out-Null
}

Log "Rechenhelfer $Version · $Pc · $gpu"
Log "Verbunden mit $Base – warte auf Aufträge (Fenster offen lassen bzw. minimieren)."

while ($true) {
  try {
    Send-Json '/api/helper/hello' @{ name = $Pc; gpu = $gpu; version = $Version }
    $job = Invoke-RestMethod -Uri "$Base/api/helper/next" -Headers $Headers -TimeoutSec 40
    if (-not $job -or -not $job.id) { continue }
    Log "Auftrag $($job.id): Spracherkennung mit Modell $($job.model) …"
    $tmp = Join-Path $Home2 'tmp'
    $wav = Join-Path $tmp "$($job.id).wav"
    $out = Join-Path $tmp $job.id
    try {
      $model = Get-Model $job.model
      Invoke-WebRequest -Uri "$Base/api/helper/job/$($job.id)/audio" -Headers $Headers -OutFile $wav -UseBasicParsing
      $sw = [Diagnostics.Stopwatch]::StartNew()
      & $Exe -m $model -f $wav -l $job.lang -ml 1 -sow -oj -of $out -t $threads 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$out.json")) { throw "whisper-cli beendet mit Code $LASTEXITCODE" }
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
