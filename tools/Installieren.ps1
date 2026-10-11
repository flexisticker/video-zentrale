# Richtet die Windows-Aufgabe "OBS-Sortierer" ein: alle 5 Minuten, solange du angemeldet bist.
# Ausführen: Rechtsklick -> "Mit PowerShell ausführen" (Datei muss neben OBS-Sortierer.ps1 liegen).
# Entfernen: dieses Skript mit dem Schalter -Entfernen starten.
param([switch]$Entfernen, [int]$Minuten = 5)

$name = 'OBS-Sortierer'
if ($Entfernen) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host 'Aufgabe entfernt.'
    Read-Host 'Enter zum Schließen'
    exit
}

$skript = Join-Path $PSScriptRoot 'OBS-Sortierer.ps1'
if (-not (Test-Path -LiteralPath $skript)) { Write-Host "Nicht gefunden: $skript"; Read-Host 'Enter'; exit 1 }

$aktion = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $skript)
$ausloeser = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $Minuten) -RepetitionDuration (New-TimeSpan -Days 3650)
$optionen = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $name -Action $aktion -Trigger $ausloeser -Settings $optionen `
    -Description 'Verschiebt fertige OBS-Aufnahmen in den Eingang der Video-Zentrale' -Force | Out-Null

Write-Host "Fertig: Die Aufgabe '$name' prüft jetzt alle $Minuten Minuten den Aufnahmeordner."
Write-Host 'Protokoll: F:\OBS - VIDEO Aufnahmen\OBS-Sortierer.log'
Read-Host 'Enter zum Schließen'
