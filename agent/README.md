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

## Tray Companion architecture spike

> **Prototype only:** neither project is installed, packaged, registered for startup, referenced by deployment scripts, or approved as a production component.

Task 2.3-03 is represented by two disposable projects:

- `src/FieldOps.TrayPrototype` is a .NET 8 Windows Forms `NotifyIcon` host. It reads real SCM state and the existing authenticated read-only health endpoint.
- `src/FieldOps.ServiceControlPrototype` is a fixed-purpose helper launched with UAC. It can stop and start only the compiled-in `FieldOpsAgent` service and returns typed exit codes after bounded transitions and an authenticated health check.

The Tray prototype also contains an isolated Named Pipe authorization probe with an explicit Windows ACL. The probe does not restart the agent and is not registered in production.

The installed health-token ACL currently permits SYSTEM, local Administrators, and LocalService. A standard-user tray therefore reports health as unavailable until the selected constrained Named Pipe health gateway is implemented in a future reviewed increment; this spike deliberately does not broaden that ACL or register a pipe in the agent.

### Running the disposable prototypes

Build first, then run the tray directly from its build output in a normal interactive session:

```powershell
dotnet build .\agent\FieldOps.Agent.sln -c Release --no-restore
& .\agent\src\FieldOps.TrayPrototype\bin\Release\net8.0-windows\win-x64\FieldOps.TrayPrototype.exe
```

The tray resolves `FieldOps.ServiceControlPrototype.exe` only beside its own executable. It does not use the working directory, `PATH`, environment configuration, or tray-provided paths. Restart displays UAC because the helper relies on the elevated Windows token and SCM authorization, not an application credential.

The helper is fixed-purpose and accepts no arguments. Direct invocation is useful only for bounded validation:

```powershell
& .\agent\src\FieldOps.ServiceControlPrototype\bin\Release\net8.0-windows\win-x64\FieldOps.ServiceControlPrototype.exe
$LASTEXITCODE
```

Exit codes:

| Code | Result |
| ---: | --- |
| 0 | Stop/start transitions completed and authenticated health reported healthy. |
| 10 | SCM access denied. |
| 11 | `FieldOpsAgent` is not installed. |
| 12 | Stop transition timed out. |
| 13 | Start request rejected. |
| 14 | Start transition timed out. |
| 15 | Running, but authenticated health unavailable. |
| 16 | Running, but authenticated health unhealthy. |
| 17 | Another restart is in progress. |
| 18 | Unexpected bounded prototype failure. |
| 19 | Helper invoked with unsupported arguments. |
| 20 | Stop request rejected. |

The helper contains the service name, health URL, and protected health-token location. It accepts none of them from the tray or caller. Its health token is used only for the final read-only health proof and never authorizes restart.

Build and test the spike with the rest of the solution:

```powershell
dotnet restore .\agent\FieldOps.Agent.sln --locked-mode
dotnet build .\agent\FieldOps.Agent.sln -c Release --no-restore
dotnet test .\agent\FieldOps.Agent.sln -c Release --no-build
```

Run the Windows pipe integration category explicitly:

```powershell
dotnet test .\agent\tests\FieldOps.TrayPrototype.Tests\FieldOps.TrayPrototype.Tests.csproj `
  -c Release --no-build --filter 'Category=WindowsIntegration'
```

Current-user allow/deny behavior, framing, size, timeout, concurrency, unsupported command, malformed correlation, and pipe-squatting behavior run on Windows without elevation. Tests using genuinely distinct administrator, alternate-user, LocalService, anonymous, or network tokens require the documented field procedure in `docs/validation/Tray-Companion-Windows-Identity-Validation.md`.

ADR-003 documents the architecture decision and field-validation requirements. The spike does not change installers, packaging, startup registration, credential provisioning, product metadata, or dormant telemetry delivery.
