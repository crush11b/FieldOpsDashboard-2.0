@echo off
TITLE FieldOps Dashboard - Safe Auto-Updater
REM Authoritative operator entry point. Keep this file beside UpdateDashboard.ps1 on the Desktop.
REM UpdateDashboard.ps1 resolves the active interactive operator when omitted; pass -OperatorAccount for an explicit override.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0UpdateDashboard.ps1"
pause
