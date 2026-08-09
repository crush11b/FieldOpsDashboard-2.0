# FieldOps Local Agent

The FieldOps Local Agent is the isolated Windows service selected by ADR-001 and ADR-002. E2-001 provides only the service lifecycle and an authenticated, read-only health endpoint.

## Developer build and test

```powershell
dotnet build .\agent\FieldOps.Agent.sln
dotnet test .\agent\FieldOps.Agent.sln
```

Create the self-contained, version-synchronized Windows artifact bundles from the repository root:

```powershell
.\agent\scripts\Publish-FieldOpsArtifacts.ps1
```

The generated, ignored `agent\artifacts\publish\win-x64` root contains separate `agent` and `tray` bundles plus a deterministic `artifact-manifest.json`. The manifest records the canonical product version from `product-metadata.json`, the full source revision, and the sorted size and SHA-256 inventory without hashing itself. Release-style publishing requires a clean worktree. The bundles include the .NET runtime, so the ToughBook does not require the .NET SDK or runtime.

The production-named `FieldOps.Tray.exe` and `FieldOps.ServiceControl.exe` outputs are published beside the service bundle. The PowerShell installer copies the tray beside the installed agent and registers only the current installing user's HKCU Run value for tray startup. They are not packaged as MSI or signed, telemetry remains dormant, and Task 2.3-03 remains focused on the single-operator MVP.

## ToughBook install from the deployed package

After running `UpdateDashboard.ps1`, open PowerShell as Administrator in the deployed dashboard directory and run:

```powershell
.\agent\scripts\Install-FieldOpsAgent.ps1 -OperatorAccount '.\FieldOperator'
```

The installer registers `FieldOpsAgent` with automatic startup, configures restart-on-failure, creates a random health credential protected with Windows DPAPI, and starts the service. It also creates or safely adopts the local `FieldOps Operators` group, enrolls the explicitly named normal operator, and persists the resolved group SID in the SCM service environment as `Agent__NativeHealth__OperatorSid`. A newly enrolled operator must sign out and sign in once so the unelevated tray token contains the group SID.

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

## Tray Companion architecture

> **Deliberately unpackaged:** the source project and namespace names remain prototype-named for review continuity, while generated distributable executables use their approved production names. The tray and fixed helper are copied by the PowerShell deployment path; startup registration is per-user HKCU only. MSI packaging and signing remain deferred.

Task 2.3-03 is represented by two disposable projects:

- `src/FieldOps.TrayPrototype` is a .NET 8 Windows Forms `NotifyIcon` host. It reads real SCM state independently and uses the shared native-health client for sanitized read-only agent health.
- `src/FieldOps.ServiceControlPrototype` is a fixed-purpose helper launched with UAC. It can stop and start only the compiled-in `FieldOpsAgent` service and returns typed exit codes after bounded transitions and an authenticated health check.

The Tray prototype also contains an isolated Named Pipe authorization probe with an explicit Windows ACL. The probe does not restart the agent and is not registered in production.

The installed health-token ACL remains limited to SYSTEM, local Administrators, and LocalService. The agent-hosted native health gateway provides a separate fixed-purpose, sanitized, read-only path without exposing or broadening that credential. Its `Agent:NativeHealth:OperatorSid` setting is reconstructed from the persisted SCM service environment at every service start, so every replacement pipe grants the same narrow client rights to the provisioned operator group. Changing group membership requires a fresh operator logon token; changing the configured group SID requires an agent restart. The tray consumes this shared native client and never receives the HTTP credential.

The tray lifecycle is production-grade within this otherwise unpackaged prototype. Before creating `NotifyIcon`, SCM, native-health, refresh, or restart objects, the process atomically acquires `Local\FieldOps.Tray.Instance.v1`. This provides one primary tray per Windows session, with access restricted to the creating user and LocalSystem. The same identity in the same session receives duplicate exit code `10`; the same identity in another session uses a separate `Local\` object and can run an independent primary. A different identity in the same session normally cannot access the protected object and receives lifecycle failure `20`, not duplicate status or an independent primary. A different identity in another session can run an independent primary. LocalSystem in the same session/object namespace is authorized and contends for that session's mutex. Fast User Switching and RDP normally use distinct session-local namespaces and therefore allow one primary per session.

Tray process exit codes are stable: `0` is a normal primary-instance exit, `10` is a duplicate no-op exit, and `20` is a sanitized startup or lifecycle failure. The primary retains mutex ownership through host creation, startup, the Windows Forms message loop, and deterministic disposal. Startup or message-loop failure clears any visible icon, cancels refresh work, disposes lifecycle resources, and releases ownership. The installer registers only the current user's tray startup command and the uninstaller removes that value; packaging and signing remain deferred.

### Running the disposable prototypes

Build first, then run the tray directly from its build output in a normal interactive session:

```powershell
dotnet build .\agent\FieldOps.Agent.sln -c Release --no-restore
& .\agent\artifacts\publish\win-x64\tray\FieldOps.Tray.exe
$LASTEXITCODE
```

The tray resolves `FieldOps.ServiceControl.exe` only beside its own executable. It does not use the working directory, `PATH`, environment configuration, or tray-provided paths. Restart displays UAC because the helper relies on the elevated Windows token and SCM authorization, not an application credential.

The helper is fixed-purpose, accepts no arguments, and uses the ACL-protected `Global\FieldOpsAgent.RestartPrototype` mutex so restart attempts from separate Windows sessions cannot overlap. Direct invocation is useful only for bounded validation:

```powershell
& .\agent\artifacts\publish\win-x64\tray\FieldOps.ServiceControl.exe
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

ADR-003 documents the architecture decision and field-validation requirements. The production installer now provisions only the supported single operator for native-health access; it does not change the protected HTTP credential, protocol, product metadata, or dormant telemetry delivery.
## Operator updater

Developers build the native bundle with `powershell -ExecutionPolicy Bypass -File .\agent\scripts\Build-FieldOpsNativePackage.ps1`. This writes `agent\artifacts\packages\fieldops-native-win-x64.zip`; upload it to the configured `mvp-native` release asset. The ToughBook updater downloads it automatically and does not require the .NET SDK.

The repository-root `UpdateDashboard.bat` is the supported single-operator entry point. Copy
`UpdateDashboard.bat` and `UpdateDashboard.ps1` together to the Desktop once; when prompted for
`OperatorAccount`, enter the normal Windows account that runs the tray (for example, `.\FieldOperator`). Future runs update
`C:\FieldOpsDashboard`, publish the agent and tray, delegate installation/startup registration to
the existing installer, provision the protected dashboard telemetry credential, and launch the
production server with `npm start`. Do not use `npm run dev` for an installed deployment.
