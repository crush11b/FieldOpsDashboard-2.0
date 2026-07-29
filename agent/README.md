# FieldOps Local Agent

The FieldOps Local Agent is the isolated Windows service selected by ADR-001 and ADR-002. E2-001 provides only the service lifecycle and an authenticated, read-only health endpoint.

## Developer build and test

```powershell
dotnet build .\agent\FieldOps.Agent.sln
dotnet test .\agent\FieldOps.Agent.sln
```

Create the self-contained Windows deployment bundle from the repository root:

```powershell
dotnet publish .\agent\src\FieldOps.Agent\FieldOps.Agent.csproj -c Release -r win-x64 --self-contained true -p:RestoreLockedMode=true -o .\agent\publish\win-x64
```

The packaged `agent\publish\win-x64` directory includes the .NET runtime and is copied to the ToughBook by the dashboard updater. The ToughBook does not require the .NET SDK or runtime.

## ToughBook install from the deployed package

After running `UpdateDashboard.ps1`, open PowerShell as Administrator in the deployed dashboard directory and run:

```powershell
.\agent\scripts\Install-FieldOpsAgent.ps1
```

The installer registers `FieldOpsAgent` with automatic startup, configures restart-on-failure, creates a random health credential protected with Windows DPAPI, and starts the service.

Windows service lifecycle commands remain standard:

```powershell
Start-Service FieldOpsAgent
Stop-Service FieldOpsAgent
Restart-Service FieldOpsAgent
Get-Service FieldOpsAgent
```

Verify authenticated health from an elevated PowerShell session:

```powershell
.\agent\scripts\Test-FieldOpsAgentHealth.ps1
```

Remove the service and its credential:

```powershell
.\agent\scripts\Uninstall-FieldOpsAgent.ps1
```

The service listens only on `http://127.0.0.1:43120`. It does not enable CORS and exposes no telemetry, storage, tray, browser-gateway, or privileged-action endpoints.
