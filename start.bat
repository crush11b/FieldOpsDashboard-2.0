@echo off
TITLE FieldOps Dashboard - Local Server Launcher
cd /d "%~dp0"

echo ==========================================================
echo  FIELDOPS DASHBOARD - LOCAL TACTICAL SERVER LAUNCHER
echo ==========================================================

if not exist "node_modules\tsx\package.json" goto missing_dependencies
if not exist "node_modules\express\package.json" goto missing_dependencies
if not exist "node_modules\vite\package.json" goto missing_dependencies

echo.
echo [+] Starting FieldOps Dashboard local web server...
echo [+] Access URL: http://localhost:3000
echo [+] Press Ctrl+C in this window to stop the server.
echo.

set "NODE_ENV=production"
node dist\server.cjs
pause
exit /b %errorlevel%

:missing_dependencies
    echo [X] FieldOps installation is incomplete: required dependencies are missing.
    echo [!] Repair or update the FieldOps installation, then try again.
    exit /b 1
