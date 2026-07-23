@echo off
TITLE FieldOps Dashboard - Local Server Launcher
cd /d "%~dp0"

echo ==========================================================
echo  FIELDOPS DASHBOARD - LOCAL TACTICAL SERVER LAUNCHER
echo ==========================================================

if not exist "node_modules" (
    echo [!] First time startup detected. Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [X] Error installing packages. Please ensure Node.js is installed.
        pause
        exit /b
    )
)

echo.
echo [+] Starting FieldOps Dashboard local web server...
echo [+] Access URL: http://localhost:3000
echo [+] Press Ctrl+C in this window to stop the server.
echo.

call npm run dev
pause
