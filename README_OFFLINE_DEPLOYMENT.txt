Dashboard application launching is handled by the interactive FieldOps Tray companion through the local named pipe `\\.\pipe\FieldOps.Tray.Launcher.v2` using the version-2 launcher protocol. The Tray must be running in the signed-in operator session before dashboard launch buttons can work. The dashboard never accepts an executable path or URI from the browser and never starts processes itself.

========================================================================
  FIELDOPS DASHBOARD 2.8.0 - LOCAL / OFFLINE TOUGHBOOK DEPLOYMENT GUIDE
========================================================================

HOW TO RUN THE DASHBOARD LOCALLY ON WINDOWS:

Option 1: Quick 1-Click Launch (Visible Command Prompt Window)
---------------------------------------------------------------
1. Ensure the installed release contains the built `dist` output and required dependencies.
2. Double-click "start.bat" in this folder.
3. Open your browser to: http://localhost:3000

For a repository checkout during development, use `npm install`, then `npm run dev` from
PowerShell. The production `start.bat` launcher does not install dependencies or build the
application.

Option 2: Run in Background (No Visible Command Prompt Window)
--------------------------------------------------------------
1. Double-click "start_background.vbs".
2. The server will launch silently in the background.
3. Open your browser to: http://localhost:3000

Option 3: Auto-Start When the Operator Signs In (Windows Startup Folder)
------------------------------------------------------------------------
1. Right-click "install_windows_startup.bat" and run it.
2. FieldOps Dashboard will now start in the background when the operator signs
  in to Windows.

Option 4: Unsupported Third-Party Service Wrappers
---------------------------------------------------
The repository does not define PM2 as a supported runtime or deployment mechanism. Use the
provided startup shortcut or the supported installed-service/deployment procedures instead.

========================================================================

TOUGHBOOK UPDATE / DEPLOYMENT:

`UpdateDashboard.bat` is the one-click CF-20 development updater bootstrap. It may be stored
outside `C:\FieldOpsDashboard`, including on the operator's Desktop. It requests elevation
automatically when required.

Run it with no argument to resolve the current commit on the development branch `main` and
ask the operator to confirm the revision. To explicitly pin a requested revision, pass the
full 40-character commit SHA:

    UpdateDashboard.bat <full-40-character-commit-sha>

The bootstrap downloads and validates the exact-revision updater/bootstrap files and matching
native artifact, performs transactional deployment, and verifies source/native revision
parity. This is the CF-20 development updater path, not a published-release deployment path.
Do not copy files into the installation directory manually.
