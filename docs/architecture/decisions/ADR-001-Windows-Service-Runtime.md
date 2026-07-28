# ADR-001: Windows Service Runtime

- Status: Accepted
- Accepted: 2026-07-27
- Supersedes: None
- Superseded by: —
- Decision owners: FieldOps Dashboard maintainers
- Related work: E2-001 Windows Service

## Context

FieldOps Dashboard requires a trusted Local FieldOps Agent that runs as a Windows service on the supported Panasonic ToughPad and ToughBook systems. The agent will form the privileged boundary beneath the browser-based React UI. E2-001 is limited to a service skeleton that can be installed, started, stopped, restarted, logged, versioned, and queried through an authenticated localhost health endpoint.

The Architecture & Design Specification requires loopback-only binding by default, per-installation authentication or OS-authenticated IPC, restricted CORS, protected secret storage, and a separation between read-only telemetry and privileged actions. The Development Roadmap also requires the Windows service runtime to be selected through an architecture decision before the agent is implemented.

The current application uses TypeScript, React, Node.js, Express, Vite, esbuild, npm/Bun, and Vitest. Its existing Windows startup scripts launch the dashboard in an interactive user session and are not Windows Service Control Manager integrations. The deployment guide mentions PM2 and NSSM as possible background-service tools, but neither is currently configured or shipped by the repository.

## Decision drivers

- First-class Windows Service Control Manager integration.
- Deterministic install, automatic start, stop, restart, recovery, and shutdown behavior.
- A small authenticated health API bound only to localhost.
- Safe handling of credentials and future privileged operations.
- Useful lifecycle logging and reliable version reporting.
- Predictable packaging for field systems that may operate offline.
- Low operational burden on ToughPad and ToughBook deployments.
- A maintainable foundation for later serial GNSS, system telemetry, SQLite, diagnostics, and controlled application launching.
- Clear separation from the unprivileged React UI and the current dashboard server.

## Options considered

### Option 1: .NET 8 Worker Service

A dedicated .NET 8 Worker Service can run under the Windows Service lifetime and host a small ASP.NET Core API in the same process.

| Area | Evaluation |
| --- | --- |
| Windows Service Control Manager integration | First-class support through the .NET Worker Service hosting model. Service start, stop, shutdown, cancellation, and SCM status integrate directly without a third-party wrapper. |
| Install/start/stop/restart | Can be published as a fixed executable and registered with `sc.exe`, PowerShell service cmdlets, or an installer. Automatic startup and SCM recovery actions can be configured during installation. |
| Logging | Integrates with Microsoft logging abstractions and Windows Event Log. E2-001 can log lifecycle events to Event Log while later E2 logging work adds structured files, retention, and diagnostics. |
| Version reporting | Assembly and informational version metadata provide a build-time source that can be returned by the health endpoint and written to startup logs. |
| Localhost authenticated health endpoint | ASP.NET Core can bind explicitly to `127.0.0.1` and `[::1]`, enforce authentication middleware, restrict origins, limit request size, and expose a narrowly scoped health route. |
| Security | Strong Windows APIs are available for ACLs, service identities, DPAPI, Credential Manager, Event Log, cryptography, and constant-time credential comparison. The runtime supports a clear boundary for future privileged operations. |
| Packaging/deployment | A self-contained or framework-dependent publish can produce a deterministic deployment directory. Self-contained publishing increases artifact size but removes the need to preinstall .NET on offline field systems. |
| Operational complexity | Requires a .NET build toolchain in addition to Node. Once published, it has low runtime complexity and does not require a globally installed process manager or service wrapper. |
| Long-term maintenance | .NET has long-term Windows service support, mature diagnostics, strong typing, and well-supported libraries for future Windows hardware and SQLite integration. Major runtime upgrades must be planned and tested. |
| Existing TypeScript/React compatibility | It cannot directly import TypeScript domain types. Compatibility is maintained through versioned HTTP/JSON contracts or generated schemas. This reinforces the intended process and privilege boundary but introduces a second implementation language. |

Advantages:

- Best native fit for a Windows service and Windows security facilities.
- No third-party service wrapper is required at runtime.
- Strong foundation for later hardware, storage, diagnostics, and security work.
- The agent can be packaged independently from the browser UI and dashboard server.

Disadvantages:

- Introduces a second language, build system, and dependency ecosystem.
- Shared contracts require deliberate schema management rather than direct TypeScript imports.
- Self-contained packages are larger than a small Node application bundle.

### Option 2: Node.js service with a Windows service wrapper

The agent can be implemented in TypeScript/Node.js and hosted by a wrapper such as WinSW or NSSM. PM2 is also mentioned by the existing deployment guide, but PM2 startup management is not itself a native service implementation and normally adds another global runtime dependency.

| Area | Evaluation |
| --- | --- |
| Windows Service Control Manager integration | WinSW and NSSM register and supervise a Node process through SCM. Integration is supplied by the wrapper rather than the Node application itself. Wrapper configuration and version become part of the trusted deployment. |
| Install/start/stop/restart | SCM commands work after wrapper registration. Graceful stop behavior depends on correct wrapper configuration and Node signal handling. Recovery can be configured through SCM or wrapper settings. |
| Logging | Node provides console and application logging libraries; wrappers can redirect stdout and stderr. Rotation requires wrapper-specific settings or another logging dependency and must avoid duplicated retention policies. |
| Version reporting | The agent can report a package or build version, but the repository's current root package is `react-example` version `0.0.0`. A separate authoritative agent package version would be required. |
| Localhost authenticated health endpoint | Express or a smaller Node HTTP server can bind to loopback and enforce token authentication. Security controls such as origin restrictions, rate limits, schema validation, and request limits require explicit configuration. |
| Security | Node supports cryptography and HTTP controls, but Windows credential, ACL, Event Log, service-account, and DPAPI integration generally requires careful process execution, native modules, or additional packages. The wrapper executable and configuration expand the trusted surface. |
| Packaging/deployment | Requires Node on the target or a packaged Node executable, plus the selected service wrapper and its configuration. Offline installation must pin and ship every runtime artifact. Wrapper licensing, provenance, checksums, and upgrades must be managed. |
| Operational complexity | Reuses the repository language but adds a wrapper lifecycle and potentially a global process manager. Troubleshooting spans Node, the wrapper, SCM, and redirected logs. |
| Long-term maintenance | TypeScript skills and some contracts can be reused. Long-term maintenance also includes Node runtime updates, native-module compatibility, wrapper updates, and wrapper configuration behavior. |
| Existing TypeScript/React compatibility | Highest source-level compatibility. Telemetry types and validation code can potentially be shared, although browser and privileged agent packages must still remain cleanly separated. |

Advantages:

- Reuses TypeScript, Node tooling, and existing team knowledge.
- Can share transport types and pure validation utilities with the dashboard.
- Express-style health endpoints would resemble the current backend.

Disadvantages:

- Depends on a separate wrapper or process manager for SCM behavior.
- Windows-native security and credential integration is less direct.
- Packaging must coordinate Node, the wrapper, application code, and configuration.
- Reusing the current `server.ts` would preserve unsafe wildcard CORS and broad responsibilities; a separate agent process would still be required.

If this option were selected, WinSW would be preferable to PM2 for a packaged Windows service because it directly integrates with SCM and can be shipped with pinned configuration. NSSM is viable and already referenced in the deployment guide, but it is primarily a generic process wrapper rather than an application-specific service host. Neither wrapper is currently part of the repository baseline.

### Option 3: PowerShell-hosted Windows service or scheduled startup task

The repository already uses PowerShell for GPS and battery producers and mentions startup shortcuts, PM2, and NSSM. A PowerShell loop hosted by a wrapper, scheduled task, or startup shortcut is therefore a viable Windows-oriented alternative for a prototype.

| Area | Evaluation |
| --- | --- |
| Windows Service Control Manager integration | PowerShell scripts are not services by themselves. They require a wrapper such as NSSM/WinSW or a custom service host. Scheduled tasks and Startup-folder shortcuts do not provide equivalent SCM lifecycle semantics. |
| Install/start/stop/restart | Script installation is familiar, but reliable graceful stop, restart, recovery, and status reporting require wrapper-specific coordination. Existing startup scripts only run in a user session. |
| Logging | Transcript, Event Log, or file logging is possible. Structured logging and rotation require custom conventions and careful concurrent file handling. |
| Version reporting | A script constant or manifest can report a version, but enforcement and build-time provenance are weaker unless additional packaging rules are introduced. |
| Localhost authenticated health endpoint | PowerShell can host HTTP, but implementing a robust authenticated server, request limits, origin policy, cancellation, and error handling would create substantial custom infrastructure. |
| Security | PowerShell can use DPAPI, credentials, ACLs, and Windows APIs, but script execution policy, mutable scripts, quoting, child processes, and broad service-account privileges increase risk for a privileged long-running boundary. |
| Packaging/deployment | PowerShell 5.1 is already present on supported Windows systems, making initial deployment small. A wrapper is still needed for a true service, and scripts and modules must be protected against modification. |
| Operational complexity | Simple for existing one-purpose producers, but complexity rises sharply when one process owns HTTP, serial devices, storage, authentication, recovery, and privileged actions. |
| Long-term maintenance | Suitable for installation and diagnostic scripts, but not preferred as the core runtime for the planned agent platform. Testing, dependency boundaries, concurrency, and API maintenance would become increasingly difficult. |
| Existing TypeScript/React compatibility | Communication would still occur through HTTP/JSON. No source-level type sharing is available. Existing PowerShell producers could remain compatible clients during migration. |

Advantages:

- Uses Windows tooling already present on target machines.
- Existing maintainers and field workflows already use PowerShell scripts.
- Appropriate for installation, repair, and focused producer utilities.

Disadvantages:

- Not a true SCM service without another wrapper or host.
- Poor fit for a growing authenticated local API and concurrent adapter platform.
- Higher risk of fragile error handling, mutable deployment, and security mistakes.

The current Startup-folder shortcut is not an acceptable substitute because it requires an interactive user session, does not provide service recovery or authoritative service status, and cannot satisfy the documented Windows service acceptance criteria.

## Decision

Use a **.NET 8 Worker Service** for the Local FieldOps Agent runtime.

The service will use the Windows Service hosting lifetime and host only the minimal ASP.NET Core surface required for the authenticated loopback health endpoint in E2-001. It will be developed and packaged as a separate agent project, not folded into the existing Express dashboard server.

For field deployment, prefer a self-contained Windows x64 publish initially so the service does not depend on a separately installed .NET runtime. The implementation must keep runtime identifiers and packaging choices explicit so Windows ARM64 or framework-dependent packages can be evaluated later if supported hardware requires them.

Windows Event Log will provide service lifecycle logging for E2-001. Custom rolling structured log files, diagnostic bundles, and broader observability remain within the later logging and diagnostics backlog items.

HTTP transport details, browser credential provisioning, and the choice between localhost HTTP/HTTPS and OS-authenticated IPC must be finalized in ADR-002. This ADR selects the service runtime but does not authorize an unauthenticated endpoint, wildcard CORS, LAN binding, or privileged action API.

## Rationale

.NET 8 adds a second development stack, but it most directly satisfies the Windows-native lifecycle and security requirements with the fewest runtime moving parts. A Node implementation would reduce language diversity while adding a service wrapper and more custom Windows integration. PowerShell remains valuable for installation and focused telemetry producers, but it is not a maintainable foundation for the planned authenticated agent platform.

The process boundary is intentional. The React UI stays portable and unprivileged, while the agent exposes explicit, versioned contracts. Sharing code is less important than preserving the security boundary and making service behavior deterministic on supported field hardware.

## Consequences

Positive consequences:

- Native SCM lifecycle behavior and predictable graceful shutdown.
- Direct access to Windows security, credential, Event Log, and service APIs.
- Independent versioning and packaging for the trusted agent.
- A durable foundation for later agent capabilities without expanding the React application's privileges.

Negative consequences:

- CI and contributor environments must eventually support the .NET SDK in addition to Node tooling.
- Agent and UI contracts cannot rely on TypeScript-only compile-time sharing.
- Offline releases will contain a larger self-contained service artifact.
- Maintainers must patch and test both Node and .NET dependencies.

Required follow-up decisions and work:

- ADR-002 must decide transport, authentication, and browser credential provisioning.
- E2-001 must prove install, automatic start, stop, restart, logging, version reporting, and authenticated loopback health on representative Windows systems.
- E2-002 and later tasks must not be folded into the E2-001 skeleton.
- API contracts shared with TypeScript consumers should use an explicit versioned schema or generated contract rather than duplicated informal shapes.

## Rejected approaches

- Reusing the current Express `server.ts` as the privileged agent: rejected because it binds to all interfaces, enables wildcard CORS, combines unrelated dashboard responsibilities, and has no authentication boundary.
- Startup-folder shortcut: rejected because it is tied to an interactive user session and is not managed as a Windows service.
- PM2 as the service architecture: rejected because it adds a global process manager and does not remove the need for a deliberate Windows service, security, packaging, and credential design.
- NSSM alone as the architecture: rejected because it supervises an executable but does not define the application runtime, API security model, or long-term agent structure.

## Validation criteria for this decision

ADR-001 should be reconsidered if a proof of architecture demonstrates that:

- required Panasonic hardware access is materially less reliable from .NET than another supported runtime;
- self-contained deployment cannot operate within target storage or update constraints;
- the selected browser-agent transport cannot be implemented safely with ASP.NET Core; or
- the project cannot sustainably build, test, and patch the additional runtime.

Absent such evidence, E2-001 should proceed using the selected .NET 8 Worker Service runtime after ADR-002 is approved.
