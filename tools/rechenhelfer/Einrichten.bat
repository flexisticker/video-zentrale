@echo off
rem Rechenhelfer einrichten: Autostart bei der Anmeldung + sofort starten
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Rechenhelfer.ps1" -Install
pause
