========================================================================
  FIELDOPS DASHBOARD v2.0 - LOCAL / OFFLINE TOUGHBOOK DEPLOYMENT GUIDE
========================================================================

HOW TO RUN THE DASHBOARD LOCALLY ON WINDOWS:

Option 1: Quick 1-Click Launch (Visible Command Prompt Window)
---------------------------------------------------------------
1. Double-click "start.bat" in this folder.
2. It will automatically run `npm install` (if needed) and launch the app.
3. Open your browser to: http://localhost:3000

Option 2: Run in Background (No Visible Command Prompt Window)
--------------------------------------------------------------
1. Double-click "start_background.vbs".
2. The server will launch silently in the background.
3. Open your browser to: http://localhost:3000

Option 3: Auto-Start Every Time Windows Boots Up (Persistent Service)
---------------------------------------------------------------------
1. Right-click "install_windows_startup.bat" and run it.
2. FieldOps Dashboard will now automatically run in the background whenever
   your computer turns on or reboots!

Option 4: Run as a Full Windows Background Service (PM2 / NSSM)
-----------------------------------------------------------------
To keep the server alive 24/7 as a background service:
1. Open PowerShell or Command Prompt.
2. Run: npm install -g pm2
3. Run: pm2 start server.ts --name fieldops
4. Run: pm2 save
5. To check status: pm2 status
6. To stop: pm2 stop fieldops

========================================================================
