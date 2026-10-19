@echo off
rem Grafikkarte sperren - die Zentrale rechnet wieder selbst
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Rechenhelfer.ps1" -Release 0
