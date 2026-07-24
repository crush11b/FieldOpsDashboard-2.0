@echo off
TITLE FieldOps Dashboard - Safe Auto-Updater
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0UpdateDashboard.ps1"
pause
