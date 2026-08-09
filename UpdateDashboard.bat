@echo off
TITLE FieldOps Dashboard - Safe Auto-Updater
REM Authoritative operator entry point. Keep this file beside UpdateDashboard.ps1 on the Desktop.
REM UpdateDashboard.ps1 requires OperatorAccount; PowerShell prompts for it when omitted. Enter the normal tray account (for example .\stick).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0UpdateDashboard.ps1"
pause
