# ADR-002: Agent Transport and Authentication

- Status: Accepted
- Accepted: 2026-07-27
- Supersedes: None
- Superseded by: —
- Decision owners: FieldOps Dashboard maintainers
- Related work: E2-001 Windows Service, E2-007 Security, E2-008 IPC
- Depends on: ADR-001 Windows Service Runtime

## Context

FieldOps Dashboard requires communication between its browser-based React UI and a privileged Local FieldOps Agent. ADR-001 selects a .NET 8 Worker Service as the agent runtime. This ADR selects the transport and authentication model that can support the E2-001 authenticated health endpoint without weakening the future security boundary.

The Architecture & Design Specification requires the agent to bind to localhost by default, authenticate UI-agent calls with a per-installation token or OS-authenticated IPC, prohibit wildcard CORS, protect secrets with Windows DPAPI, Credential Manager, or equivalent storage, and separate read-only telemetry from launch, update, and configuration actions. The roadmap requires a browser to authenticate to localhost while preventing unrelated webpages from invoking privileged endpoints.

The browser is the difficult client in this decision. It cannot call Windows Named Pipes directly, cannot safely read a machine credential from DPAPI or Credential Manager, and should not retain a long-lived agent bearer token in `localStorage`, IndexedDB, source code, generated JavaScript, or dashboard configuration. Native tray and administrative tools have access to stronger Windows-native credential and IPC mechanisms.

## Decision drivers

- The browser UI remains unprivileged and does not possess a reusable agent secret.
- The agent is reachable only through loopback unless a separately designed remote mode is introduced.
- Unrelated websites cannot call agent endpoints successfully.
- Health and telemetry reads are separated from privileged actions.
- Credentials have a defined provisioning, storage, rotation, and revocation lifecycle.
- The initial E2-001 health prototype remains small and diagnosable.
- Future tray and command-line tools can authenticate without weakening browser controls.
- Offline installation on ToughPad and ToughBook systems remains practical.
- The design can evolve without replacing all agent contracts or clients.

## Options considered

### Option 1: HTTP on localhost with a per-install bearer token

The agent exposes versioned HTTP endpoints on an explicit loopback address. Trusted local clients authenticate with an opaque, randomly generated bearer token.

| Area | Evaluation |
| --- | --- |
| Authentication | Straightforward bearer authentication with constant-time token verification. Separate credentials or scopes can distinguish read-only and privileged clients. A bearer token must never be exposed to browser storage or logs. |
| Browser compatibility | Excellent for HTTP and JSON, but unsafe if the browser must hold the long-lived bearer token. A same-origin local dashboard gateway can call the agent on the browser's behalf and keep the token outside the browser. |
| CSRF/CORS | A direct cross-origin browser API requires exact origin allowlisting and preflight handling. Disabling browser CORS entirely at the agent and routing browser calls through a same-origin gateway provides a smaller boundary. Origin validation remains defense in depth and privileged requests must not use ambient browser credentials. |
| Secret storage and provisioning | An installer generates a high-entropy token and stores it with machine-local ACLs and DPAPI protection. The agent and approved local gateway/native tools obtain it through protected local configuration or a controlled provisioning step. |
| Performance | More than adequate for telemetry, health, configuration, and action requests. Loopback overhead is negligible relative to hardware and external-data operations. |
| Operational complexity | Uses familiar HTTP diagnostics and ASP.NET Core middleware. It requires a secure credential lifecycle and a browser gateway, but no certificate authority or platform-specific transport library. |
| Debuggability | Strong. Status codes, JSON responses, correlation IDs, and authenticated PowerShell or CLI requests are easy to inspect. Tokens must be redacted from diagnostics and command history. |
| Deployment | No certificate installation is required. The listener must bind only to `127.0.0.1` and optionally `[::1]`. Installation must create protected credential material before service startup. |
| Long-term maintainability | Versioned HTTP contracts work across React, .NET, PowerShell, and future desktop clients. Authentication and authorization middleware can evolve without changing domain payloads. |

Advantages:

- Broad client compatibility and straightforward testing.
- No local certificate trust or renewal burden.
- Fits the architecture's expressly permitted per-installation token model.
- Supports a same-origin browser gateway while allowing authenticated native clients.

Disadvantages:

- Bearer credentials are replayable if disclosed.
- Plain loopback HTTP does not encrypt traffic from other software on the same host.
- The browser cannot safely be given the long-lived token directly.
- The existing dashboard server is not yet a suitable gateway because it binds broadly and enables wildcard CORS; those behaviors must not be copied into the agent boundary.

### Option 2: HTTPS on localhost with a self-signed certificate

The agent exposes HTTPS using a certificate created or installed for the local machine.

| Area | Evaluation |
| --- | --- |
| Authentication | TLS authenticates the service only when the certificate is trusted and its name matches. Client authentication still requires a bearer token, client certificate, Windows authentication, or session mechanism. HTTPS does not by itself authorize the caller. |
| Browser compatibility | Browsers support HTTPS, but self-signed certificates produce blocking warnings unless a local root or leaf certificate is installed correctly. Browser and OS trust behavior varies and hostname validation must be maintained. |
| CSRF/CORS | HTTPS does not prevent malicious webpages from sending cross-site requests. Exact origin checks, restricted CORS, authorization, and CSRF controls are still required. |
| Secret storage and provisioning | Certificate private keys must be generated, installed, ACL-protected, renewed, and removed. Any bearer or client credential still needs its own protected lifecycle. |
| Performance | TLS overhead is insignificant for this workload. |
| Operational complexity | High relative to loopback HTTP. Certificate trust, subject alternative names, browser warnings, expiry, renewal, repair, and rollback add operational failure modes. |
| Debuggability | Standard HTTPS tooling works after trust is correct. Certificate errors can obscure otherwise simple health failures and complicate field repair. |
| Deployment | Requires elevated certificate-store changes or a trusted local certificate mechanism. Offline deployment and renewal must be deterministic on both target systems. |
| Long-term maintainability | Viable if a mature installer and certificate lifecycle are established. It duplicates some protection already supplied by loopback-only binding while leaving caller authorization unsolved. |

Advantages:

- Encrypts loopback traffic and authenticates the service when trust is configured correctly.
- Uses standard browser and HTTP APIs after certificate provisioning succeeds.

Disadvantages:

- Adds certificate trust and renewal complexity to field machines.
- Does not eliminate bearer-token, CORS, CSRF, or authorization requirements.
- A self-signed leaf certificate without trusted installation provides warnings rather than meaningful assurance.

### Option 3: Windows Named Pipes

The agent exposes a versioned protocol over a Named Pipe secured by Windows access-control lists and client identity.

| Area | Evaluation |
| --- | --- |
| Authentication | Strong for native clients. Pipe ACLs restrict connection by Windows identity, and the server can inspect or impersonate the authenticated client where appropriate. No reusable bearer secret is required for those clients. |
| Browser compatibility | Standard browser JavaScript cannot open Named Pipes. A tray application, desktop shell, native bridge, or local HTTP gateway is required. |
| CSRF/CORS | Web-origin attacks cannot directly reach a pipe. If an HTTP bridge is introduced, that bridge still needs origin, CSRF, authentication, and authorization controls. |
| Secret storage and provisioning | Native authentication uses Windows identities and ACLs rather than a shared secret. Installer logic must configure the pipe and service identities correctly. |
| Performance | Excellent for local request/response and streaming workloads. Performance is not a deciding factor for current telemetry cadence. |
| Operational complexity | Requires a custom protocol or RPC framework, connection lifecycle handling, framing, version negotiation, and a browser bridge. Service/session identity boundaries must be tested carefully. |
| Debuggability | Less accessible than HTTP. Generic browser tools and `curl` cannot inspect traffic; dedicated clients and diagnostics are required. |
| Deployment | No certificates or listening TCP port are required. Correct service account, user-session access, and ACL provisioning are essential. |
| Long-term maintainability | Strong for tray/service communication and privileged native administration. Less attractive as the only API because browser access always needs another component. |

Advantages:

- Windows-native identity and ACL enforcement.
- No network listener and no browser-origin attack surface directly on the pipe.
- Good future fit for tray-to-service control.

Disadvantages:

- Cannot serve the browser directly.
- Requires additional protocol and bridge infrastructure.
- Harder to inspect and test with existing web tooling.

### Option 4: Windows Integrated Authentication over loopback HTTP

The agent uses an HTTP server capable of Windows Negotiate authentication, such as HTTP.sys or a suitably configured ASP.NET Core host, and authorizes callers by Windows identity.

| Area | Evaluation |
| --- | --- |
| Authentication | Uses the logged-on Windows identity rather than a shared bearer token. Authorization can use local users or groups. Correct SPN, loopback, service-account, and browser behavior must be proven. |
| Browser compatibility | Chromium-based and other browsers can support Negotiate authentication, but automatic localhost credential behavior can depend on browser, zone, enterprise policy, and hosting configuration. |
| CSRF/CORS | Windows credentials are ambient, so CSRF remains a serious concern. Strict origin validation, anti-forgery protection for mutations, restricted CORS, and endpoint authorization are mandatory. |
| Secret storage and provisioning | No browser bearer token is stored. Service identity and Windows group membership become the provisioning mechanism. Any service credentials must remain OS-managed. |
| Performance | Appropriate for local APIs; handshake overhead is immaterial. |
| Operational complexity | Higher than bearer authentication. Service identities, URL reservations, browser policies, Windows groups, and authentication negotiation complicate support. |
| Debuggability | Windows identity is visible server-side, but failures can arise from browser policy, account context, URL ACLs, or negotiation and are harder to reproduce. |
| Deployment | Requires administrative URL reservations, service-account configuration, and potentially browser or machine policy. |
| Long-term maintainability | Attractive for managed Windows environments and native administration, but the supported field machines may not be domain-managed and browser behavior must be validated before adoption. |

Advantages:

- No long-lived browser secret.
- Uses Windows identity and centralized authorization concepts.
- Can support native and browser clients through one HTTP contract where configuration permits.

Disadvantages:

- Ambient credentials increase CSRF importance.
- Workgroup/offline machines and browser policies make behavior less predictable.
- More difficult deployment and troubleshooting than an explicit agent token.

Other Windows-native mechanisms such as COM, local RPC, or AppService-style brokers have the same fundamental limitation as Named Pipes: ordinary browser JavaScript needs a trusted native bridge. They provide no clear advantage over Named Pipes for this repository's planned tray/service boundary.

## Decision

Use **versioned HTTP on loopback with per-install bearer credentials**, with different client paths for browsers and trusted native tools.

The Local FieldOps Agent will bind only to `127.0.0.1` and, when explicitly tested, `[::1]`. It will not listen on LAN interfaces. HTTPS with a self-signed certificate is not required for the initial local transport because its certificate lifecycle adds substantial deployment complexity without replacing caller authentication or cross-site protections.

The browser will not receive or store the long-lived agent bearer token. Browser requests will go to a same-origin local dashboard gateway. The gateway will retrieve the protected agent credential and authenticate its server-to-agent request. The agent will not enable CORS for arbitrary browser origins. Direct browser-to-agent access is therefore not part of the selected production model.

E2-001 may validate authenticated health with an approved local CLI or test client before the dashboard gateway is secured and integrated. It must not expose an unauthenticated temporary browser endpoint.

Windows Named Pipes remain the preferred candidate for future tray-to-service privileged control because they provide Windows identity and ACL enforcement. Adopting a pipe for tray operations later does not replace or invalidate the versioned loopback HTTP read API selected here.

## Authentication and credential lifecycle

### How the browser authenticates

The browser authenticates only to the locally served dashboard origin using the dashboard's eventual local session/bootstrap mechanism. It does not attach the agent bearer token and does not call privileged agent routes directly. The same-origin dashboard gateway authenticates to the agent on the browser's behalf.

Until the secure local dashboard gateway and its bootstrap mechanism are implemented, the browser is not an authorized E2-001 health client. E2-001 health verification uses an approved administrative or test client.

### Initial credential provisioning

The elevated agent installer generates at least 256 bits of cryptographically secure random material. The credential is created locally and is never compiled into source, copied from a repository file, or derived from a device identifier.

The installer provisions the credential to the service's protected machine configuration. It separately authorizes the local dashboard gateway or native administrative client through a controlled installation or pairing step. Provisioning must not print the credential by default or place it in shell history.

### Protection at rest

The canonical credential is protected with Windows DPAPI machine protection or an equivalent Windows-protected store and restrictive ACLs under `%ProgramData%`. Only the service identity and explicitly approved gateway or administrative identity may read the material.

The credential must never be stored in browser `localStorage`, IndexedDB, cookies, exported dashboard configuration, logs, diagnostic bundles, command-line arguments, source files, or environment files committed to the repository.

### Rotation and regeneration

An elevated administrative operation generates a new credential, writes it atomically to protected storage, updates authorized clients through the controlled provisioning path, and restarts or reloads the service as required. Rotation records a redacted audit event but never the credential.

If compromise is suspected or client synchronization fails, regeneration revokes the previous credential. A short dual-key transition may be supported later for safe rotation, but it must be bounded and must not become permanent fallback behavior. Uninstall removes the protected credential and any client grants created by the installer.

## Cross-site request protections

- The agent exposes no wildcard CORS policy.
- The default agent API does not grant CORS access to browser origins; browser calls use the same-origin dashboard gateway.
- The agent verifies that the TCP connection is loopback and rejects unexpected host binding or forwarding assumptions.
- Requests with an `Origin` header are rejected unless the endpoint has an explicit documented origin policy.
- Authentication is required even on loopback because unrelated webpages and local processes can target localhost.
- State-changing gateway routes require explicit methods, schema validation, anti-forgery protection, and exact origin checks.
- Authentication tokens are accepted only in the `Authorization` header, never in URLs or query strings.
- Health and telemetry endpoints remain read-only and do not trigger acquisition side effects or privileged actions.

## Privileged endpoint protections

Privileged launch, update, configuration, service-control, and secret-management endpoints are not authorized merely because a caller has read-health access. They require separate authorization scopes or client credentials, explicit request validation, rate limits, confirmation policy where applicable, and audit records.

The browser gateway must expose only an allowlisted set of agent operations. It must not become a generic URL, method, header, or body proxy. Native execution and update endpoints remain disabled until their later security and registry requirements are implemented.

## Future tray application authentication

The future tray application should use a Windows-identity-protected Named Pipe for privileged service control if the ADR-003 prototype confirms it. Pipe ACLs should authorize the interactive user and service identities explicitly.

If the tray calls the HTTP API, it receives its own scoped credential through protected Windows storage rather than reusing the dashboard gateway credential. Tray credentials can authorize health and narrowly defined service-control operations without authorizing unrelated future capabilities.

## Local CLI and administrative authentication

Packaged CLI and PowerShell administration tools use one of two controlled paths:

- a scoped bearer credential obtained from Windows-protected storage under an authorized identity; or
- a future administrative Named Pipe protected by Windows ACLs.

Credentials are not passed as command-line arguments. Diagnostic examples should accept secure input or use an authenticated packaged tool so secrets do not enter command history. Elevated operations also require an administrator context and are audited independently of possession of a read-only credential.

## Rationale

Loopback HTTP preserves the simplest interoperable and diagnosable contract for the React/Node gateway, .NET agent, PowerShell tools, tests, and future clients. Keeping the bearer credential out of browser storage addresses the largest weakness of direct browser token authentication. A same-origin gateway also gives browser-facing CSRF and origin policy a single controlled boundary.

Self-signed HTTPS adds certificate trust, renewal, and recovery work but does not solve authorization or CSRF. Named Pipes provide stronger native-client identity but cannot be called by an ordinary browser. Windows Integrated Authentication avoids a browser secret but introduces ambient-credential CSRF risks and deployment behavior that is not yet proven on offline, non-domain field systems.

The selected model can be implemented incrementally: E2-001 proves loopback binding and authenticated health with a local test client; later secure-API and dashboard packaging work introduces the constrained same-origin gateway; ADR-003 can select Named Pipes for tray control without replacing the HTTP data contract.

## Consequences

Positive consequences:

- The browser never stores a reusable privileged agent credential.
- No local certificate authority, browser warning, or renewal lifecycle is required initially.
- HTTP contracts remain easy to test and consume across repository technologies.
- Native clients can receive separately scoped credentials or use Windows-authenticated pipes.
- Browser cross-site exposure is reduced by withholding agent CORS and using a same-origin gateway.

Negative consequences:

- A secure local dashboard gateway becomes a required component before browser-agent integration is complete.
- The existing Express server cannot fill that role without correcting its broad bind, wildcard CORS, and lack of authentication.
- Loopback HTTP is not encrypted against sufficiently privileged or hostile local software.
- Credential rotation must coordinate the agent and each authorized non-browser client.
- Supporting both HTTP and a future tray pipe creates two transports to test and version.

## Rejected approaches

- Long-lived bearer token in browser `localStorage` or IndexedDB: rejected because script execution in the dashboard origin could exfiltrate it and exported or corrupted browser state could expose it.
- Bearer token embedded in compiled JavaScript, HTML, URLs, or source-controlled configuration: rejected because it is not a secret and cannot be safely rotated per installation.
- Authentication by localhost address alone: rejected because malicious webpages and untrusted local processes can target loopback services.
- Wildcard CORS with bearer authentication: rejected because it unnecessarily exposes the API surface and magnifies credential mistakes.
- Self-signed HTTPS as the only security control: rejected because encryption does not authenticate or authorize the calling application.
- Named Pipes as the sole transport: rejected because the browser requires another trusted bridge.
- Reusing one credential for browser, gateway, tray, CLI, telemetry, and privileged actions: rejected because compromise would grant excessive authority and prevent meaningful revocation.

## Validation criteria

The decision is validated when a proof of architecture demonstrates that:

- the agent listens only on tested loopback addresses;
- an authenticated health request succeeds and missing, malformed, expired, or incorrect credentials fail without revealing sensitive detail;
- no wildcard CORS headers are emitted;
- an unrelated webpage cannot read health data or invoke a privileged operation;
- the browser path does not expose the agent credential through browser storage, page source, network responses, logs, or exported configuration;
- credential provisioning and regeneration work on representative ToughPad and ToughBook installations;
- credentials remain protected at rest and are redacted from logs and diagnostics;
- read-only and privileged authorization are demonstrably separate; and
- CLI and future tray clients can be provisioned and revoked independently.

This ADR should be reconsidered if the same-origin gateway cannot be deployed without creating a broader local attack surface, if browser packaging changes to a desktop shell with safe OS-authenticated IPC, or if field validation proves that certificate-managed HTTPS or Windows Integrated Authentication is operationally simpler and equally secure on all supported systems.
