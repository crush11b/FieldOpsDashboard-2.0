@echo off
setlocal
TITLE FieldOps Development Update - Exact Revision

REM One-click CF-20 development launcher. Elevate once, preserve the optional SHA argument, then exit.
if /i "%~1"=="--fieldops-elevation-probe" (
	if defined FIELDOPS_UPDATER_PROBE_OUTPUT (
		>"%FIELDOPS_UPDATER_PROBE_OUTPUT%" echo ELEVATION_PROBE_PATH=%~f0
		>>"%FIELDOPS_UPDATER_PROBE_OUTPUT%" echo ELEVATION_PROBE_ARGS=%*
	) else (
		echo ELEVATION_PROBE_PATH=%~f0
		echo ELEVATION_PROBE_ARGS=%*
	)
	exit /b 0
)
if /i "%FIELDOPS_UPDATER_ELEVATED_PROBE%"=="1" goto fieldops_elevated_probe
if /i "%FIELDOPS_UPDATER_ELEVATION_TEST%"=="1" (
	powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$child = '%~f0'; if ([string]::IsNullOrWhiteSpace($child) -or -not [IO.Path]::IsPathRooted($child)) { exit 1 }; $arguments = if ([string]::IsNullOrWhiteSpace('%*')) { '--fieldops-elevation-probe' } else { '--fieldops-elevation-probe %*' }; $process = Start-Process -FilePath $child -ArgumentList $arguments -PassThru -Wait; exit $process.ExitCode"
	exit /b %ERRORLEVEL%
)
fltmc >nul 2>&1
if errorlevel 1 (
	powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if ([string]::IsNullOrWhiteSpace('%~f0')) { exit 1 }; if ([string]::IsNullOrWhiteSpace('%*')) { Start-Process -FilePath '%~f0' -Verb RunAs | Out-Null } else { Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs | Out-Null }"
	exit /b
)
if /i "%FIELDOPS_UPDATER_ELEVATED_PROBE%"=="1" (
	if defined FIELDOPS_UPDATER_PROBE_OUTPUT echo ELEVATED_PATH=%~f0>"%FIELDOPS_UPDATER_PROBE_OUTPUT%"
	exit /b 0
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

:fieldops_elevated_probe
if defined FIELDOPS_UPDATER_PROBE_OUTPUT echo ELEVATED_PATH=%~f0>"%FIELDOPS_UPDATER_PROBE_OUTPUT%"
exit /b 0
