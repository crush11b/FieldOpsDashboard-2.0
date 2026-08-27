@echo off
setlocal
TITLE FieldOps Development Update - Exact Revision

REM One-click CF-20 development launcher. Elevate once, preserve the optional SHA argument, then exit.
fltmc >nul 2>&1
if errorlevel 1 (
	powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$bat=$args[0]; $arguments=$args[1]; if ([string]::IsNullOrWhiteSpace($arguments)) { Start-Process -FilePath $bat -Verb RunAs | Out-Null } else { Start-Process -FilePath $bat -ArgumentList $arguments -Verb RunAs | Out-Null }" "%~f0" "%*"
	exit /b
)

cd /d "%~dp0"
if not exist "%~dp0FieldOpsDevelopmentUpdater.ps1" (
	echo [X] FieldOpsDevelopmentUpdater.ps1 is missing beside this BAT.
	pause
	exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0FieldOpsDevelopmentUpdater.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
pause
exit /b %EXIT_CODE%
