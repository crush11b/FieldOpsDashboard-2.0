# ADR-006: Dashboard Backend Ownership

- Status: Proposed
- Proposed: 2026-07-28
- Supersedes: None
- Superseded by: —
- Decision owners: FieldOps Dashboard maintainers
- Related work: E2-003 Telemetry Receiver, ADR-001 Windows Service Runtime, ADR-002 Agent Transport and Authentication

## Context

FieldOps Dashboard currently has two runtime boundaries. The browser-facing application is a React frontend served by an Express server in `server.ts`. A separate .NET 8 Windows service, `FieldOps.Agent`, owns the trusted local-agent boundary and exposes an authenticated health API on loopback port 43120.

The Express server is not merely a development host. It owns the dashboard's same-origin API, proxies or adapts external services, accepts existing GPS and battery producer input, creates current telemetry responses, invokes operating-system integrations, generates update archives, and serves the compiled React application in production. React calls these routes through relative `/api/...` URLs and therefore already treats Express as its backend owner.

E2-002 added a dormant outbound pipeline to the Windows agent: a bounded queue, sender worker, canonical serializer, HTTP destination, authentication boundary, and typed delivery failures. No destination or sender is registered in production. E2-003 proposes a first receiver for `POST /api/v1/telemetry`, but its initial assessment assumed an ASP.NET Core dashboard backend that does not currently exist in the repository.

Adding the receiver to the Windows agent would cause the agent to post telemetry back to itself and would not create a browser-facing same-origin boundary. Adding a separate ASP.NET Core receiver would introduce a third runtime process and leave Express in front of the browser. Replacing Express with ASP.NET Core would require migrating every current backend responsibility before the dashboard could retain existing behavior.

This ADR determines which process owns the browser-facing backend and future telemetry receiver. It does not define the receiver's detailed wire contract, persistence, freshness rules, or browser update mechanism.

The roadmap reserves ADR-003 for the tray-companion decision, ADR-004 for SQLite, and ADR-005 for browser launch and installation. This decision therefore uses the next unreserved number, ADR-006. Existing ADR-002 references to ADR-003 continue to refer to the future tray-companion decision.

## Decision drivers

- One process must clearly own browser-facing routes and static application hosting.
- Browser APIs should remain same-origin and must not expose agent write credentials to React.
- The telemetry sender must deliver to a process other than the agent itself.
- Production should not add a redundant gateway, reverse proxy, runtime, port, or service without a demonstrated need.
- Existing GPS, battery, weather, solar, ionosonde, AI, application-detection, installation, update, and download behavior must remain available during migration.
- The dashboard must continue to work offline after its dependencies are installed and deployed.
- The receiver boundary must be testable independently from the React UI and native agent.
- Local deployment must remain practical on ToughPad and ToughBook systems.
- Authentication must conform to ADR-002: no browser-held agent token, no wildcard CORS, explicit origin policy, and separate authorization for telemetry and privileged operations.
- The architecture should permit future multiple-agent and remote modes without forcing a near-term backend rewrite.
- Migration risk is more important than achieving a single implementation language.

## Options considered

### Option A: Keep Express as the dashboard backend

Express remains the single browser-facing backend. It serves React, owns the dashboard's same-origin APIs, and receives telemetry posted by the .NET agent. The server is hardened and incrementally modularized before the telemetry receiver is activated.

#### Current responsibilities

`server.ts` currently owns:

- Development hosting through Vite middleware.
- Production hosting of `dist` and the SPA fallback route.
- Solar and space-weather retrieval and fallback behavior.
- Ionosonde retrieval and modeled fallback behavior.
- Weather proxying.
- Application detection and installer-script generation.
- Server-side Gemini integration.
- Legacy GPS producer routes and telemetry-envelope reads.
- Legacy battery producer routes, WMI/sysfs acquisition, and telemetry-envelope reads.
- Project/update archive generation and downloads.
- Native filesystem and PowerShell integration.

The React application calls these APIs with relative URLs, including `/api/solar-data`, `/api/weather`, `/api/ionosonde`, `/api/apps/detect`, `/api/ai-advisor`, `/api/telemetry/gps`, `/api/telemetry/battery`, and update-download routes. Keeping Express preserves these contracts and same-origin behavior.

#### Hosting, security, and authentication

Express can host `POST /api/v1/telemetry` and an in-memory latest-value projection without introducing another process. It can authenticate a dedicated telemetry-write bearer credential, associate that credential with an agent identity, and expose separate browser-readable endpoints without returning the write credential to React.

The current server is not production-safe for that receiver yet. It binds to `0.0.0.0`, emits `Access-Control-Allow-Origin: *`, broadly advertises methods and headers, has no general authentication boundary, and combines unrelated responsibilities in one large startup function. These are required hardening and testability tasks, not reasons to create another backend owner.

The local default must move to loopback binding. Wildcard CORS must be removed; same-origin React requests do not require it. Any deliberately enabled LAN mode must have a separate authenticated configuration and threat review. Telemetry ingestion must reject browser-origin requests and use a credential distinct from browser sessions, agent-health access, and future privileged operations.

#### Testability

Express and Vitest are already repository dependencies, but `server.ts` currently starts listening as a side effect and has no focused backend integration-test harness. Before adding the receiver, application construction should be extracted from process startup so tests can instantiate the Express application with controlled dependencies and a custom HTTP client or an ephemeral test server. Receiver validation, authentication, size limits, cache replacement, and response behavior can then be tested without starting the production process.

#### Windows deployment and maintenance

This option retains the existing runtime topology: the dashboard's Node process plus the independently installed `FieldOpsAgent` Windows service. The updater already deploys the repository package, preserves `node_modules`, launches the dashboard with npm, and separately includes the self-contained agent bundle.

The dashboard process still needs a production lifecycle decision. It is currently started interactively by `UpdateDashboard.ps1` with `npm run dev`, while the agent is managed by Windows Service Control Manager. Hardening dashboard startup and packaging remains future work and should align with the roadmap's browser launch and installation ADR. It does not require making the agent own the dashboard backend.

Long-term maintenance retains TypeScript on both sides of the browser/backend boundary and C# for the agent. This is a deliberate tradeoff: it avoids a large migration and keeps current domain types and route behavior close to their existing consumers.

#### Advantages

- Preserves the existing, proven browser/backend boundary.
- Requires no third process, reverse proxy, or additional port.
- Keeps every current route working while telemetry ingestion is introduced incrementally.
- Maintains same-origin browser APIs naturally.
- Reuses the current TypeScript telemetry contract and frontend test toolchain.
- Makes Node a justified runtime rather than a temporary proxy in front of another backend.
- Has the smallest migration and field-deployment risk.

#### Disadvantages

- The current Express host requires significant security hardening before receiver activation.
- Node and .NET remain separate deployed runtimes.
- The monolithic `server.ts` must be modularized to support reliable backend tests.
- Production Node lifecycle and packaging are less mature than the Windows agent service.
- Cross-language wire-contract parity remains necessary between TypeScript and C#.

### Option B: Replace Express with ASP.NET Core

An ASP.NET Core dashboard backend would serve the React build, own every browser-facing API, and receive agent telemetry. Express would be removed after a staged migration.

#### Migration scope

The replacement would have to reproduce all existing Express behavior before Node could leave the runtime:

- Static React hosting and SPA fallback.
- Development proxy or an equivalent Vite development workflow.
- Weather, solar, space-weather, and ionosonde adapters and their existing fallbacks.
- Gemini server integration.
- GPS and battery legacy ingestion aliases and response compatibility.
- WMI, PowerShell, sysfs, filesystem, and application-detection behavior.
- Installer-script and update-archive generation.
- Download routes and updater compatibility.
- Every error shape, polling assumption, and relative frontend API route.

ASP.NET Core provides strong typed configuration, middleware, request limits, authentication, logging, health checks, integration testing, static-file hosting, and Windows service support. A self-contained build could eventually eliminate Node from production while retaining Node only for frontend development and compilation.

However, the new dashboard backend must not be merged into `FieldOps.Agent`. They have different trust and lifecycle responsibilities, and the agent's outbound sender must not target its own process. The ASP.NET dashboard would therefore still be a second process alongside the agent, requiring its own service or launch lifecycle, installation path, port, logs, health monitoring, update coordination, and rollback behavior.

#### Advantages

- One server runtime and framework could eventually cover the dashboard and agent ecosystem.
- ASP.NET Core has mature authentication, configuration, lifecycle, and integration-test facilities.
- A self-contained dashboard publish could remove the Node runtime from production.
- C# receiver types could share conventions with the agent, though not the same trust boundary.

#### Disadvantages

- Requires a broad backend rewrite unrelated to the first telemetry receiver.
- Creates substantial compatibility risk across all current routes and fallbacks.
- Temporarily requires both Express and ASP.NET during migration, increasing rather than reducing complexity.
- Does not eliminate the need for a separate dashboard process alongside the agent.
- Duplicates TypeScript domain behavior in C# and increases contract-migration work.
- Delays receiver delivery until static hosting, API parity, installer, updater, and lifecycle work are complete.

This option may become reasonable if a separately approved migration demonstrates that Node production packaging is untenable. The repository does not currently provide that evidence.

### Option C: Add a separate ASP.NET Core gateway

A new ASP.NET Core process would receive telemetry while Express continued serving React and existing APIs.

The browser would either call the new port directly or Express would reverse-proxy it. Direct browser calls would break the existing same-origin model and require carefully restricted CORS and a browser authentication design. Reverse proxying would keep same-origin behavior but leave Express as the actual browser gateway, making the ASP.NET process an internal receiver rather than the backend owner.

The installation would gain another executable, port, credential store, process lifecycle, startup dependency, health endpoint, recovery policy, log destination, updater action, and rollback path. Express would need to wait for, monitor, or tolerate the gateway. Agent credentials would have to be provisioned to the new service identity, and the browser-facing read path would span two backend processes.

#### Advantages

- Isolates telemetry ingestion from the existing monolithic Express server.
- Allows receiver work to use ASP.NET Core immediately.
- Could be independently tested and restarted.

#### Disadvantages

- Produces two browser-backend layers with unclear ownership.
- Requires a reverse proxy or a new cross-origin browser boundary.
- Adds a third runtime process and port to field machines.
- Increases credential, installer, startup-order, monitoring, and update complexity.
- Isolation provides little value for an in-memory latest-value receiver with no database or heavy processing.
- Express remains necessary for all current routes, so no runtime is removed.

## Decision

Choose **Option A: keep Express as the dashboard backend**.

The Express process is the single owner of browser-facing backend behavior, static React hosting, same-origin read APIs, and the future `POST /api/v1/telemetry` receiver. The .NET `FieldOpsAgent` remains a separate trusted producer and privileged-service boundary. Its dormant sender will eventually post canonical envelopes to the Express receiver; it will not post to its own ASP.NET health host.

This decision favors the architecture that actually exists in the repository. It avoids a rewrite or third process while preserving a clear trust boundary:

```text
React browser
    |
    | same-origin browser API; no telemetry-write credential
    v
Express dashboard backend
    ^
    | authenticated canonical telemetry POST
    |
.NET FieldOpsAgent
```

Express must not receive production telemetry until its binding, CORS, authentication, request validation, and testability findings are corrected. Keeping Express is not an approval of its current security posture.

## Repository evidence

- `README.md` identifies `server.ts` as the Express backend and documents `npm run dev`, `npm run build`, and `npm start` as the dashboard lifecycle.
- `package.json` starts `tsx server.ts` in development, bundles `server.ts` to `dist/server.cjs`, and starts that bundle with Node in production.
- `server.ts` creates the Express application, enables Vite middleware in development, serves `dist` in production, and supplies the SPA fallback.
- `server.ts` binds port 3000 to `0.0.0.0` and currently emits wildcard CORS headers. Those behaviors conflict with ADR-002 and must be hardened before receiver activation.
- `server.ts` owns all current browser APIs, external adapters, local GPS and battery telemetry, native PowerShell/filesystem integration, AI integration, and update-archive generation.
- React components use relative `/api/...` URLs, proving that the browser expects the static host and API owner to share one origin.
- `agent/src/FieldOps.Agent/Program.cs` creates the separate Windows service, binds only to `127.0.0.1:43120`, authenticates its health endpoint, and does not serve React or current dashboard APIs.
- `agent/scripts/Install-FieldOpsAgent.ps1` installs only `FieldOpsAgent` under Windows Service Control Manager using the self-contained publish bundle.
- `UpdateDashboard.ps1` validates and deploys both the Node dashboard package and agent publish output, preserves `node_modules`, and starts the dashboard through npm.
- ADR-001 deliberately separates the trusted .NET agent from the current dashboard server.
- ADR-002 requires a same-origin browser gateway, forbids browser-held agent credentials and wildcard CORS, and explicitly states that the current Express server must be secured before it can fulfill that role.
- The Architecture & Design Specification keeps React unprivileged, places hardware and privileged work behind the local agent, and allows the compiled UI to be served locally while preserving the trust boundary; it does not require ASP.NET Core to own the dashboard.
- The Development Roadmap says the current browser/Express application must remain usable while the agent is absent and recommends incremental agent integration rather than a big-bang UI/agent rewrite.

## Consequences

### Positive consequences

- Backend ownership now matches deployed repository behavior.
- React retains one same-origin backend.
- The telemetry sender has a destination outside its own process.
- No additional process, gateway port, or reverse proxy is introduced.
- Current APIs and offline behavior can be preserved during receiver development.
- The first receiver can be built as a narrow TypeScript/Express slice.
- Existing TypeScript telemetry contracts can be reused at the receiver boundary while C# parity remains explicitly tested.
- ASP.NET receiver assumptions no longer block E2-003.

### Negative consequences

- Express must be hardened before it can be considered a production security boundary.
- Node remains a production dependency alongside the self-contained .NET agent.
- `server.ts` requires structural extraction before backend integration tests are dependable.
- The dashboard process still lacks the Windows service lifecycle and operational maturity of `FieldOpsAgent`.
- Installer work must safely provision a telemetry-write credential to two different process identities.
- TypeScript/C# schema parity remains a cross-language responsibility.

### Migration implications

- The E2-003 receiver design should be translated from ASP.NET-specific mechanics to framework-neutral behavior implemented in Express.
- Receiver DTO validation must use an explicit runtime schema or equivalent strict validator; TypeScript types alone are insufficient at an HTTP boundary.
- Existing routes must remain compatible while the server is modularized.
- Browser-readable telemetry APIs remain same-origin and must never disclose or reuse the agent's write credential.
- The agent sender remains dormant until the secured receiver, credential provisioning, and failure behavior are validated end to end.
- A future Express-to-ASP.NET migration requires a separate ADR and compatibility plan. It is not an implied consequence of E2-003.
- The roadmap's reserved ADR-003, ADR-004, and ADR-005 identifiers remain available for their documented decisions.

## Implementation sequence

1. Accept this ADR without changing production behavior.
2. Extract Express application construction from process startup so tests can instantiate the app without binding port 3000.
3. Add backend integration-test conventions using the existing TypeScript test toolchain and controlled dependencies.
4. Change the default dashboard binding to loopback and remove wildcard CORS. Define any future LAN mode as explicit, disabled-by-default, and separately authenticated.
5. Separate current route groups and native adapters from the monolithic `server.ts` without changing their public behavior.
6. Design and implement a dedicated telemetry-write credential provider for Express and the agent. Do not reuse browser, health, or privileged-operation credentials.
7. Implement the validated in-memory telemetry receiver in Express under the versioned route.
8. Prove authentication, origin rejection, request limits, schema validation, replacement behavior, safe errors, and absence of CORS leakage with integration tests.
9. Add same-origin browser read APIs and migrate one narrow consumer without exposing the write credential.
10. Update the installer and updater to provision credentials and manage the dashboard lifecycle transactionally.
11. Register the existing agent destination and sender only after the receiver and credential lifecycle pass representative ToughPad/ToughBook validation.

## Explicit non-goals

- This ADR does not define the detailed telemetry request or response schema.
- It does not implement the telemetry receiver.
- It does not activate `HttpTelemetryDestination` or `TelemetrySenderService`.
- It does not design retries, persistence, batching, history, metrics, or browser streaming.
- It does not redesign current GPS or battery endpoints.
- It does not migrate Express routes to ASP.NET Core.
- It does not decide tray-companion technology.
- It does not change the current installer, updater, host binding, CORS policy, or production runtime.

## Final answer

> The Express process in `server.ts` owns the FieldOps Dashboard browser-facing backend and `POST /api/v1/telemetry`. The .NET `FieldOpsAgent` remains the separate telemetry producer and privileged local-service boundary.
