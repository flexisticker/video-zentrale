@echo off
rem Grafikkarte fuer die Video-Zentrale freigeben (bis gesperrt oder ein Spiel/OBS startet)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Rechenhelfer.ps1" -Release stop
