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

Create the self-contained Windows deployment bundle:

```powershell
dotnet publish .\agent\src\FieldOps.Agent\FieldOps.Agent.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:RestoreLockedMode=true `
  -o .\agent\publish\win-x64
```

## ToughBook deployment

The repository contains an offline deployment guide and transactional updater:

- [`README_OFFLINE_DEPLOYMENT.txt`](README_OFFLINE_DEPLOYMENT.txt)
- [`UpdateDashboard.ps1`](UpdateDashboard.ps1)

After deploying the dashboard package, install the Windows agent from an elevated PowerShell session:

```powershell
.\agent\scripts\Install-FieldOpsAgent.ps1
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

The next roadmap phase advances the secure local-agent architecture and hardware-integration foundation. Telemetry delivery should remain dormant until its planned activation task is implemented and reviewed.

Project architecture and roadmap documents are available under [`docs/`](docs/README.md).

## Project status

This project is under active development. It is suitable for controlled development and field evaluation, but individual integrations may still be incomplete or intentionally disabled.

Do not interpret unavailable, stale, cached, manual, or modeled values as live measurements.

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for details.
