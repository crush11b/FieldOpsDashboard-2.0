# FieldOps Local Agent

The FieldOps Local Agent is the isolated Windows service selected by ADR-001 and ADR-002. E2-001 provides only the service lifecycle and an authenticated, read-only health endpoint.

## Build and publish

```powershell
dotnet build .\agent\FieldOps.Agent.sln
dotnet test .\agent\FieldOps.Agent.sln
dotnet publish .\agent\src\FieldOps.Agent\FieldOps.Agent.csproj -c Release -r win-x64 --self-contained true -p:RestoreLockedMode=true
```

## Install

Run PowerShell as Administrator after publishing:

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
