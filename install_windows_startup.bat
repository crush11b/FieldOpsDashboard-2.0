@echo off
TITLE FieldOps Dashboard - Windows Auto-Start Installer
cd /d "%~dp0"

echo ==========================================================
echo  FIELDOPS DASHBOARD - WINDOWS STARTUP CONFIGURATOR
echo ==========================================================

set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set VBS_SCRIPT=%~dp0start_background.vbs
set SHORTCUT_PATH=%STARTUP_FOLDER%\FieldOpsDashboard.lnk

echo [+] Creating auto-start shortcut in Windows Startup folder...

powershell -Command "$s = (New-Object -COM WScript.Shell).CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%VBS_SCRIPT%'; $s.WorkingDirectory = '%~dp0'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo.
    echo [✓] SUCCESS! FieldOps Dashboard will now automatically start in the background when your Toughbook boots up!
    echo [✓] Startup shortcut saved to: %SHORTCUT_PATH%
) else (
    echo [X] Failed to create startup shortcut.
)

echo.
pause
