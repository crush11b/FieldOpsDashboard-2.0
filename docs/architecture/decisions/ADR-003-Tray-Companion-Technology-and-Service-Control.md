# ADR-003: Tray Companion Technology and Service Control

- Status: Proposed by architecture spike
- Date: 2026-07-29
- Decision owners: FieldOps Dashboard maintainers
- Related work: 2.3-03 Tray Companion
- Supersedes: None
- Superseded by: —

## Context

FieldOps Dashboard requires an interactive Windows tray companion that reports the real state of the `FieldOpsAgent` Windows service, reads its authenticated health response, and helps an operator request a narrowly scoped restart. The tray is a separate interactive process. It is not part of the LocalService-hosted agent and must not make the agent attempt to restart itself.

ADR-001 selected a self-contained .NET 8 Windows service. ADR-002 selected authenticated loopback HTTP for read-only browser/gateway interoperability and identified Windows Named Pipes as the preferred candidate for future native privileged control. ADR-006 keeps Express as the browser-facing backend. None of those decisions authorizes an HTTP restart endpoint or credential reuse.

The repository already contains dormant telemetry transport infrastructure. Task 2.3-03 does not activate, extend, or depend on that delivery pipeline.

## Decision drivers

- Native notification-area behavior on supported Windows ToughPad and ToughBook systems.
- Compatibility with the existing .NET 8 Windows implementation.
- Honest SCM state and authenticated health reporting.
- Explicit UAC behavior for privileged service restart.
- No general command execution, arbitrary service selection, or reusable restart bearer token.
- Testable state, health, restart-result, timeout, and authorization boundaries.
- Small offline deployment footprint and low idle resource use.
- A disposable prototype that does not change production installation or startup.

## UI technology options

### Windows Forms with `ApplicationContext` and `NotifyIcon`

Windows Forms provides a first-party `NotifyIcon`, context menus, message-loop ownership through `ApplicationContext`, and straightforward compatibility with `net8.0-windows`. A tray-only process does not require a visible main form. It can later open focused settings, logs, or diagnostics windows without forcing a new UI framework into the Windows service.

This is the smallest technology addition and uses the installed Windows Desktop runtime already included in a self-contained .NET publish.

### WPF

WPF provides stronger XAML composition for a future settings application but has no first-party WPF notification-area component. It would require Windows Forms interop, direct Win32 integration, or a third-party package. That adds complexity without improving this spike's service-state workflow.

### WinUI 3 / Windows App SDK

WinUI 3 offers modern Windows presentation and supports Windows 10 1809 and later. It adds Windows App SDK lifecycle and deployment choices, and notification-area integration still requires lower-level interop. Those costs are not justified for a small field tray utility.

### Cross-platform frameworks

Avalonia, .NET MAUI, Electron, and similar frameworks add dependencies or runtime surface while providing portability that cannot apply to Windows SCM, Windows identities, UAC, and the Windows-only agent.

## Service interaction options

### Windows-ACL-protected Named Pipe

A Named Pipe can authenticate native callers through Windows identity and a narrow DACL without introducing a reusable bearer credential or privileged TCP endpoint. The server must use explicit `PipeSecurity`; `CurrentUserOnly` is invalid for a LocalService server and interactive-user client. Requests must be length-bounded, time-bounded, single-operation, correlated, and discriminated by an allowlisted command type.

Risks include pipe-name squatting if the legitimate server is absent, incorrect ownership or DACL construction, accidentally granting the broad local Users group, cross-session identity assumptions, and inability to provision a specific operator SID without installer work. A dedicated local `FieldOps Operators` group is the preferred production authorization model because membership is explicit and revocable. Installing-user-only authorization is fragile after account changes; all local Users is too broad; Administrators-only forces elevation for every pipe operation.

The spike validates only an authorization probe. It does not send a restart command to the agent.

### Separately scoped authenticated loopback HTTP control

A privileged HTTP endpoint is easy to test and consistent with the read-only health transport, but it is reachable by unrelated local processes and webpages. It requires a new independently provisioned control credential, origin handling, rate limiting, schema validation, rotation, revocation, and audit behavior. Reusing the health, dashboard, or telemetry credential would collapse authorization boundaries.

This option adds avoidable privileged network surface and permanent credential lifecycle work. It remains a fallback only if representative hardware disproves the Named Pipe approach for future agent commands.

### Direct SCM control from an elevated helper

A separate fixed-purpose executable can use `ServiceController` to stop and start only the compiled-in `FieldOpsAgent` service. The tray launches it with the Windows `runas` verb, making UAC consent explicit. The helper accepts no service name, executable path, command, or general-purpose argument.

This avoids self-restart semantics. The helper returns a bounded exit-code contract that distinguishes access denial, missing service, stop/start failures, transition timeouts, post-start health failure, overlap, and success. Restart authorization is the elevated Windows token and SCM security descriptor—not the health credential. The existing health credential is used only for the final read-only health check.

## Decision

Use **Windows Forms on .NET 8** with `ApplicationContext` and `NotifyIcon` for the Tray Companion.

For the disposable spike:

1. Read service state directly from SCM through `ServiceController`.
2. Read application health from the existing authenticated loopback health endpoint.
3. Launch a separate fixed-purpose restart helper through UAC.
4. Let the elevated helper stop and start only `FieldOpsAgent`, wait for bounded SCM transitions, and require authenticated healthy status before reporting success.
5. Prototype an explicit-ACL Named Pipe authorization probe separately. Do not use the agent's pipe for self-restart.
6. Do not add an HTTP restart endpoint.

For future native agent commands, prefer an ACL-protected Named Pipe using a dedicated `FieldOps Operators` local group, subject to installer design and representative hardware validation. Keep the existing loopback HTTP endpoint read-only.

## Native health-access decision

### Option A: dedicated operators group with credential-file access

The installer could create a local `FieldOps Operators` group, enroll approved users, and grant that group read access to the existing health credential or another credential file. This gives Windows administrators a familiar membership and ACL mechanism, but it exposes reusable bearer material to every authorized interactive process. Adding or removing group membership normally requires a new logon token, so already-running tray processes and user sessions may require restart or sign-out. ACL inheritance must remain disabled. Rotation must update every authorized client atomically, and uninstall must remove product-owned ACLs, membership, and the group only after verifying it is the product-owned group.

Administrators are not implicitly treated as enrolled non-elevated operators: a filtered administrator token may not carry an enabled Administrators SID. An administrator can be explicitly added to `FieldOps Operators` for normal use or elevate a diagnostic tool. Granting all local Users access is rejected.

This option is not selected because the tray needs sanitized health data, not possession of a reusable secret.

### Option B: separate native-health credential

A second random credential could authorize only the health route. It would be stored under `%ProgramData%\FieldOpsDashboard\Tray`, protected with DPAPI machine scope and a non-inheriting ACL for SYSTEM, LocalService, Administrators, and `FieldOps Operators`. The agent would validate it independently from dashboard, telemetry, restart, configuration, and administrative credentials.

Compromise would expose only sanitized health reads, but the design still adds generation, storage, ACL, rotation, revocation, dual-client transition, uninstall cleanup, synchronization, and server-side multi-credential logic. It is safer than broadening the existing credential but more complex than the information being protected warrants.

This option remains a fallback if native IPC proves unreliable on supported hardware.

### Option C: constrained native health gateway

The agent can expose a read-only Named Pipe command that returns only sanitized health fields already available from the authenticated HTTP response: status, service identity, version, start/check timestamps, and uptime. The caller receives no credential and cannot select a route, method, service, file, or command. SCM status remains independently readable when the agent or pipe is unavailable, so pipe failure is itself an honest `health unavailable` result rather than a circular success dependency.

The pipe DACL should authorize LocalService, elevated local Administrators, and a dedicated `FieldOps Operators` group. Installer work must create the group, optionally enroll the installing operator through explicit confirmation, disable ACL inheritance on related resources, and record ownership for safe uninstall. Group membership changes take effect only in newly created user tokens; documentation must require tray restart and, when Windows does not refresh membership, sign-out/sign-in. No token rotation is required because Windows account/group lifecycle provides authorization.

Choose **Option C** for production native health access, subject to real LocalService, administrator, alternate-user, and ToughPad/ToughBook validation. This is a follow-up production implementation decision: the disposable spike validates protocol and ACL mechanics but does not register a pipe in `FieldOpsAgent`, create a group, or change installers.

### Native channel trust boundary clarification

The Named Pipe security boundary authenticates and authorizes callers to the FieldOps Agent through Windows identities and a narrow DACL. LocalService, elevated local Administrators, and the explicitly configured `FieldOps Operators` group are trusted identities within this boundary. Defending against a malicious process already running as LocalService, or against an elevated local administrator impersonating `FieldOpsAgent` by hosting the expected pipe, is outside the Task 2.3-03 threat model.

`FirstPipeInstance` provides fail-closed detection when another process pre-creates the pipe name; it is not mutual authentication. Correlation IDs and acknowledgements provide protocol association and integrity only. They do not authenticate the pipe server.

For this native channel, **authenticated health** means health delivered through the authorized native-agent boundary selected here. Task 2.3-03 does not require SCM server-PID matching, executable-path validation, signature validation, or cryptographic mutual authentication. Stronger server-identity verification may be considered later as defense in depth if the documented threat model changes.

The optional operator-group SID configuration is evaluated when the agent starts. Changing that configuration requires an agent restart; this implementation does not mutate the live pipe DACL in response to configuration reload.

## Restart result contract

The prototype distinguishes:

- UAC canceled before helper launch.
- Access denied by Windows or SCM.
- `FieldOpsAgent` not installed.
- Stop transition timeout.
- Start request rejected.
- Start transition timeout.
- Running with authenticated health unavailable.
- Running with an unhealthy response.
- Restart already in progress.
- Successful stop, start, `Running` transition, and authenticated healthy response.

The UI must not claim success before all required transitions pass. A process-launch success or SCM `Running` state alone is insufficient.

## Security model

### Protected assets and threats

Service availability and the future privileged command boundary must be protected from malicious webpages, untrusted local processes, unauthorized standard users, repeated restart denial-of-service, message replay, command/path injection, broad DACLs, and pipe-name squatting.

### Controls

- The helper contains the service name and accepts no arbitrary target or command.
- UAC and SCM authorize restart; no application bearer token authorizes restart.
- Health authentication remains read-only and is evaluated only after SCM reaches `Running`.
- The Named Pipe spike uses explicit SIDs, not `CurrentUserOnly`, World, or the broad local Users group; Anonymous and Network receive explicit deny ACEs.
- Pipe messages are length-prefixed, capped at 4096 bytes, time-bounded, single-operation, and correlation-ID based.
- Empty or malformed correlation IDs and unknown command types are rejected before command execution.
- The native client rejects empty, malformed, or mismatched response correlation IDs. Correlation IDs associate a response with a request; they do not authenticate the pipe server.
- `FirstPipeInstance` makes a pre-created pipe name fail closed; production must report and audit this condition.
- Restart overlap is guarded across Windows sessions by `Global\FieldOpsAgent.RestartPrototype`. Its protected DACL grants full control only to LocalSystem, Builtin Administrators, and the specific elevated identity that creates it; representative multi-session behavior remains part of field validation.
- Production implementation must add auditable Windows Event Log outcomes without secrets or exact sensitive paths.

## Elevation and UAC

The tray runs as the interactive operator without elevation. Reading SCM state and authenticated health should not prompt for elevation. Restart launches the fixed helper with `runas`; cancellation is a normal, distinct result. The tray must never disable UAC, cache administrative credentials, or silently retry elevation.

The current installer ACL authorizes only SYSTEM, local Administrators, and LocalService to read the protected health credential. Therefore a normal standard-user tray correctly reports health as unavailable in this disposable prototype. Production read-only health requires an explicitly approved native-client provisioning design or a constrained gateway; broadening the credential ACL is not authorized by this spike. The elevated restart helper can perform the required post-restart health check under the existing administrator authorization without using that credential to authorize restart.

The selected production resolution is the constrained Named Pipe health gateway described above. Until that follow-up is implemented and validated, the prototype's standard-user health result remains unavailable by design.

The production design may instead grant a dedicated operators group narrowly scoped SCM restart rights, but that requires a separate installer and threat-model review. It is not part of this spike.

## Process lifecycle and startup

The tray is a separate per-user process, not a Windows service and not hosted inside `FieldOpsAgent`. Production startup registration, single-instance behavior across sessions, Explorer restart behavior, sleep/resume refresh, and sign-out cleanup remain implementation work. The prototype owns a notification icon for its message-loop lifetime and removes it on exit.

## Failure reporting

Operator results state the observed failure category. They do not translate UAC launch, process exit, or SCM `Running` into success. Health-unavailable and health-unhealthy are distinct. Timeouts are bounded and do not trigger indefinite waits or automatic retry loops.

## Testability

SCM, health, and restart behavior are behind interfaces. Deterministic unit tests use fakes for transition and health outcomes. The Named Pipe policy is tested against LocalService, Administrators, the explicit operator SID, another local-user SID, Users, Anonymous, Network, and World identities. A Windows integration test exercises an actual pipe connection under the current operator identity.

Actual UAC prompts, alternate-user tokens, LocalService tokens, SCM transitions, and post-restart health require representative Windows integration testing and cannot be proven by a single developer-session unit test.

## Supported platform

The prototype targets `net8.0-windows` and `win-x64`, matching the existing agent. Representative ToughPad and ToughBook Windows builds must be recorded during field validation. .NET 8 support lifetime and the product's eventual runtime-upgrade plan must be reviewed before production release.

### SDK reproducibility

The repository has no CI workflow that declares a .NET SDK and the current workstation has .NET 8 runtimes but only a .NET 9 SDK. Adding `global.json` pinned to an unavailable .NET 8 SDK would make this workstation unable to build without first changing its toolchain, while pinning .NET 9 would contradict the intended .NET 8 build baseline. .NET 8 reaches end of support in November 2026, making a new long-lived 8.x pin poor timing immediately before a likely .NET 10 LTS migration.

Do not add `global.json` in Task 2.3-03. Before the production tray increment, establish Windows CI with an explicit supported SDK and choose one of two deliberate paths: temporarily pin the exact installed .NET 8 feature band while scheduling migration, or migrate the solution and then pin .NET 10 in a separate runtime task. Do not perform that migration inside the Tray Companion work.

## ToughPad and ToughBook considerations

- Validate notification-area visibility, touch hit targets, DPI scaling, and Explorer restarts.
- Validate UAC interaction in the deployed operator account and field kiosk policy.
- Measure idle memory/CPU and resume behavior.
- Confirm LocalService, administrator, dedicated-group, and interactive-user SID behavior.
- Validate service transition and health timeouts on slower storage and hardware.
- Confirm the protected health credential is readable only by intended identities.

## Packaging implications

Production packaging must decide self-contained versus shared-runtime deployment, helper co-location and integrity verification, startup registration, code signing, icon assets, uninstall cleanup, operators-group provisioning, and update/rollback behavior. All are deferred. This spike does not modify installers, updater scripts, publish output, product metadata, or startup registration.

## Consequences

### Positive

- Small first-party tray technology aligned with the existing service runtime.
- Honest separation between SCM state and application health.
- Explicit elevation for restart with no general command surface.
- No privileged HTTP endpoint or restart bearer credential.
- A testable result contract and authorization policy.

### Negative

- The tray uses the shared native-health client and does not read or duplicate the protected HTTP health credential.
- Standard-user native health remains unavailable until the separately reviewed operator identity is provisioned and the user obtains a refreshed Windows token.
- UAC is disruptive but honest.
- A dedicated operators group cannot be completed without future installer changes.
- Windows Forms is less suitable than WPF or WinUI for a large future desktop application.
- Actual multi-user ACL behavior requires hardware or VM test accounts.

## Explicit non-goals

- Complete production tray UI.
- Agent self-restart.
- HTTP restart endpoint.
- Telemetry activation or producer integration.
- Installer, uninstaller, packaging, updater, startup, credential-provisioning, or metadata changes.
- General process execution or arbitrary Windows service control.
- Persistence, batching, retry loops, history, metrics, SSE, or WebSockets.

## Validation required before acceptance

- Run the tray under the intended non-admin operator account.
- Exercise UAC accept and cancel paths.
- Restart an installed healthy and unhealthy agent.
- Exercise access denial, missing service, stop/start timeout, and concurrent restart behavior.
- Run ACL tests with distinct standard-user, administrator, LocalService, and dedicated-group tokens.
- Attempt unauthorized pipe access and pipe-name pre-creation.
- Validate ToughPad and ToughBook DPI, touch, sleep/resume, and resource behavior.
