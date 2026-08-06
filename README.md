# FieldOps Dashboard

> Rugged, offline-first operations dashboard for amateur-radio field operators, POTA/SOTA activators, EMCOMM teams, and Panasonic ToughBook/ToughPad deployments.

![Version](https://img.shields.io/badge/version-2.2.0-004B87?style=for-the-badge)
![Status](https://img.shields.io/badge/status-active_development-F9A825?style=for-the-badge)
![Platform](https://img.shields.io/badge/platform-Windows_10%2F11-0078D4?style=for-the-badge&logo=windows&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)

## Current release

**FieldOps Dashboard 2.2.0 — Trustworthy Dashboard**

Version 2.2 establishes the project’s reliability baseline. Operational data is now presented with explicit source, status, freshness, and provenance semantics instead of fabricated defaults or misleading success states.

Release tag: [`v2.2.0`](https://github.com/crush11b/FieldOpsDashboard-2.0/releases/tag/v2.2.0)

## Current product direction

The project is currently rebaselined around a **single-operator, locally operated field MVP**. The existing trustworthy telemetry, Windows service, authentication, and hardware-integration framework is preserved, but broader multi-user, enterprise, fleet, signing, remote-administration, and advanced hardening work is deferred until real deployment needs justify it.

Version 2.3 now prioritizes a usable ToughBook/ToughPad installation with dependable startup, practical tray behavior, real GNSS, real Windows system telemetry, and representative field validation. Operator-facing Field Tools follow immediately after the MVP.

See:

- [`docs/planning/FieldOpsDashboard_Project_Rebaseline_2026.md`](docs/planning/FieldOpsDashboard_Project_Rebaseline_2026.md)
- [`docs/architecture/decisions/ADR-007-Single-Operator-MVP-and-Proportionate-Engineering.md`](docs/architecture/decisions/ADR-007-Single-Operator-MVP-and-Proportionate-Engineering.md)

## What the project does

FieldOps Dashboard combines field-radio tools, local hardware integration, weather and propagation context, application launching, and logging into one touch-friendly interface designed for unreliable or unavailable internet connectivity.

Core capabilities include:

- GPS position, source, fix state, age, and Maidenhead grid presentation
- Weather and NOAA alert presentation with honest unavailable and stale states
- Modeled HF propagation guidance clearly distinguished from measured data
- ToughBook battery and system-status presentation
- Configurable launcher tiles for radio and field applications
- ADIF contact logging and export
- Offline-capable frontend and local Express backend
- A Windows Local Agent foundation for isolated hardware access

## Trustworthy telemetry semantics

FieldOps Dashboard does not substitute invented values when a source fails.

Telemetry can be represented as:

- **Live** — current data from an active source
- **Cached** — retained data that is still within an acceptable age
- **Stale** — retained data that has exceeded its freshness threshold
- **Unavailable** — no usable value is available
- **Error** — the source failed, optionally with previously retained data
- **Manual** — explicitly entered or overridden by the operator
- **Modeled** — calculated guidance, not a direct measurement

Valid zero values remain valid. A reading of `0` is not automatically treated as missing.

## Windows Local Agent

The repository includes the first Windows Local Agent foundation under [`agent/`](agent/README.md).

The agent is a Windows service that:

- runs under the `LocalService` account
- starts automatically with Windows
- uses restart-on-failure service recovery
- listens only on `127.0.0.1:43120`
- provides an authenticated, read-only health endpoint
- stores its local credential using Windows DPAPI

### Important v2.2 boundary

Telemetry transmission remains intentionally dormant in Version 2.2.

Only `AgentLifecycleService` is registered. `TelemetrySenderService` and `HttpTelemetryDestination` are present as foundation code but are not registered or active.

## Architecture

```text
Browser / touch UI
        │
        ▼
React + TypeScript frontend
        │
        ▼
Local Express backend
        │
        ├── weather and NOAA adapters
        ├── propagation modeling
        ├── configuration and ADIF export
        └── authenticated telemetry receiver foundation

Windows Local Agent
        ├── Windows service lifecycle
        ├── localhost-only health endpoint
        ├── credential protection
        └── dormant telemetry transport foundation
```

### Technology stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Lucide icons, Motion
- **Backend:** Express.js, bundled with esbuild
- **Testing:** Vitest, Testing Library, jsdom
- **Windows Agent:** .NET 8 Windows service
- **Deployment:** PowerShell-based offline and ToughBook deployment tooling

## Getting started

### Prerequisites

- Node.js 20 or newer recommended
- npm
- Windows 10/11 for ToughBook hardware integration and agent deployment
- .NET 8 SDK only when building or testing the Windows agent from source

### Clone and install

```powershell
git clone https://github.com/crush11b/FieldOpsDashboard-2.0.git
cd FieldOpsDashboard-2.0
npm install
```

### Run in development

```powershell
npm run dev
```

Open:

```text
http://localhost:3000
```

### Build and run production output

```powershell
npm run build
npm start
```

## Validation commands

### Frontend and Express

```powershell
npm run metadata:check
npm run typecheck
npm test
npm run build
```

The Version 2.2 release baseline passed:

- metadata synchronization
- TypeScript validation
- 180 automated tests across 18 files
- frontend production build
- Express production bundle
- `git diff --check`

### Windows agent

```powershell
dotnet build .\agent\FieldOps.Agent.sln
dotnet test .\agent\FieldOps.Agent.sln
```

Create the self-contained Windows agent and tray artifact bundles:

```powershell
.\agent\scripts\Publish-FieldOpsArtifacts.ps1
```

Generated output is written under the ignored `agent\artifacts\publish\win-x64` root and is not installed, signed, or registered for startup. Existing service deployment remains PowerShell-based.

## ToughBook deployment

The repository contains an offline deployment guide and transactional updater:

- [`README_OFFLINE_DEPLOYMENT.txt`](README_OFFLINE_DEPLOYMENT.txt)
- [`UpdateDashboard.ps1`](UpdateDashboard.ps1)

After deploying the dashboard package, install the Windows agent from an elevated PowerShell session:

```powershell
.\agent\scripts\Install-FieldOpsAgent.ps1 -OperatorAccount '.\FieldOperator'
```

Verify the service:

```powershell
.\agent\scripts\Test-FieldOpsAgentHealth.ps1
```

Uninstall it with:

```powershell
.\agent\scripts\Uninstall-FieldOpsAgent.ps1
```

## Repository layout

```text
.
├── agent/                     # .NET Windows Local Agent, tests, scripts, publish output
├── docs/                      # Architecture, telemetry, ADRs, roadmap, and backlog material
├── public/                    # PWA manifest and service worker
├── scripts/                   # Product-metadata synchronization
├── server/                    # Backend modules and server tests
├── src/
│   ├── components/            # Dashboard widgets and UI tests
│   ├── location/              # Coordinate and Maidenhead logic
│   ├── telemetry/             # Shared status, freshness, envelope, and display models
│   ├── test/                  # Shared test setup and telemetry factories
│   └── utils/                 # ADIF and numeric helpers
├── product-metadata.json      # Canonical product and release identity
├── server.ts                  # Express application entry point
└── README.md
```

## Product metadata

Canonical identity is stored in [`product-metadata.json`](product-metadata.json):

- **Product:** FieldOps Dashboard
- **Package:** `fieldops-dashboard`
- **Version:** `2.2.0`
- **Release:** Trustworthy Dashboard

Run the synchronization check with:

```powershell
npm run metadata:check
```

## Roadmap

Version 2.2 completed the Trustworthy Dashboard milestone.

Version 2.3 is redefined as **Single-Operator Field MVP**. It focuses on dependable startup and deployment, practical tray behavior, minimal local integration, serial-port enumeration, real NMEA GNSS, real Windows system telemetry, and representative ToughBook/ToughPad operational validation.

Multi-user, enterprise, fleet, remote-administration, signing, and generalized hardening work remain part of the long-term framework but are intentionally deferred from the current release path. Version 2.4 is expected to shift decisively toward operator-facing Field Tools.

Project architecture and roadmap documents are available under [`docs/`](docs/README.md).

## Project status

This project is under active development. It is suitable for controlled development and field evaluation, but individual integrations may still be incomplete or intentionally disabled.

Do not interpret unavailable, stale, cached, manual, or modeled values as live measurements.

## Development deployment

For controlled MVP development deployment on the primary ToughBook, run from an elevated PowerShell window at the repository root:

```powershell
.\Deploy-ToughBook.ps1
```

The helper publishes fresh Agent/Tray artifacts, overlays source files without renaming or mirroring `C:\FieldOpsDashboard`, installs the Agent for the normal `stick` account, and builds the dashboard. It does not launch the server, roll back, or delete user files; it prints `npm start` when ready. Use `-Force` only for controlled development when the machine-model check cannot identify the ToughBook. Production updating remains a separate workflow while updater hardening is deferred.

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for details.
