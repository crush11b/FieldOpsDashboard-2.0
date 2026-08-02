@echo off
TITLE FieldOps Dashboard - Safe Auto-Updater
REM Authoritative operator entry point. Keep this file beside UpdateDashboard.ps1 on the Desktop.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0UpdateDashboard.ps1"
pause
