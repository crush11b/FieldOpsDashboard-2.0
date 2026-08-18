# FieldOps Dashboard

> A locally operated, field-first amateur-radio operations platform for portable and rugged deployments.

[![Version 2.3.0](https://img.shields.io/badge/version-2.3.0-005B96?style=for-the-badge)](https://github.com/crush11b/FieldOpsDashboard-2.0/releases/tag/v2.3.0)
[![Status](https://img.shields.io/badge/status-2.4%20Field%20Tools%20in%20development-C47F00?style=for-the-badge)](#version-24-direction)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-1F6FEB?style=for-the-badge&logo=windows&logoColor=white)](#supported-environment)

## What it is

FieldOps Dashboard brings the operational picture for a field radio station into one touch-friendly local application. It combines location, weather, system status, application launching, logging, and field-oriented controls so an operator does not have to assemble the essentials across many disconnected tools.

It is designed for portable amateur-radio work, Panasonic ToughBook/ToughPad computers, camping and travel, and other situations where connectivity may be slow, intermittent, or unavailable.

## Why it exists

Field operations need useful information even when individual data sources fail. FieldOps identifies the source and condition of operational data and distinguishes live, cached, stale, unavailable, manual, and modeled values instead of filling gaps with fabricated defaults.

The project prioritizes practical single-operator field usefulness, trustworthy information, local operation, and graceful degradation over speculative enterprise infrastructure.

## Current release

**Version 2.3 - Single-Operator Field MVP**

The current release establishes a dependable Windows field baseline with local startup, a Windows Local Agent and Tray companion, real GNSS and system telemetry paths, application launching, persistent operator configuration, and deployment tooling.

See the [Version 2.3 changelog](CHANGELOG.md) and [MVP acceptance record](docs/validation/Version-2.3-Single-Operator-Field-MVP-Acceptance-2026-08-14.md).

## What works today

- Real GNSS location with Maidenhead/grid presentation and source-aware status
- Weather and NOAA alert context from the local dashboard backend
- Windows battery, power, CPU, memory, storage, and network telemetry
- Configurable launching of field applications and approved web destinations through the Tray companion
- Contact logging and ADIF export
- Modeled HF band guidance, clearly distinguished from measured propagation data
- Local operator configuration that persists across browser-origin changes and reboot
- A touch-oriented dashboard with configurable launcher tiles and field display themes
- A local Express backend with a React and TypeScript frontend
- A Windows Local Agent that isolates local hardware and service concerns

Availability depends on connected hardware, local application configuration, and external data sources. When a source cannot provide current information, the dashboard preserves an honest unavailable or stale state.

## Trustworthy data by design

FieldOps uses explicit source, freshness, and status semantics throughout the dashboard:

- **Live**: current data from an active source
- **Cached**: retained data within an accepted age
- **Stale**: retained data beyond its freshness threshold
- **Unavailable**: no usable value is available
- **Error**: the source failed, possibly with retained data
- **Manual**: explicitly entered or overridden by the operator
- **Modeled**: calculated guidance rather than a direct measurement

A modeled band condition is not presented as a measurement, and a valid zero is not silently treated as missing.

## Version 2.4 direction

**Version 2.4 - Field Tools** is active development on the separate `feature/2.4-field-tools-coordinate-workspace` branch. Those changes are not part of the current `main` release baseline.

The development direction includes richer operating-location and coordinate tools, distance and bearing workspaces, solar and twilight calculations, propagation improvements, observed-RF evidence, and product definition for future POTA/SOTA activation support. These are development areas and should not be read as current Version 2.3 capabilities.

The approved [project rebaseline](docs/planning/FieldOpsDashboard_Project_Rebaseline_2026.md) describes the release sequencing and the operator-value focus for this work.

## SmartDeploy and activation-support direction

Version 2.4 product-definition work has recovered the original SmartDeploy concept around POTA/SOTA mission planning. **SmartDeploy 2.0 is not implemented, and Operations Brief generation is not available in the current release.**

The future concept is:

```text
Equipment Inventory
        -> Reusable Loadout
        -> Mission
        -> Online Planning Intelligence
        -> Equipment / Deployment Analysis
        -> SmartDeploy Operations Brief / Risk Assessment
        -> Active Mission
```

Future work may eventually synthesize an operating window, selected equipment and loadout, weather forecasts and hazards, space-weather outlooks, propagation modeling, antenna deployment considerations, power and endurance, contingencies, and evidence-grounded operational recommendations.

This is product direction and design work. Inventory, reusable loadouts, mission planning, activation sequencing, and Operations Brief generation are not current `main` features.

## Architecture at a glance

```text
Touch-friendly React dashboard
              |
              v
      Local Express backend
        |              |
        |              +-- Weather, NOAA alerts, and local data adapters
        |
        +-- Local configuration and ADIF export

Windows Local Agent + Tray companion
        +-- GNSS and Windows system telemetry
        +-- Local service lifecycle and application launching
        +-- Loopback-only authenticated health boundary
```

The browser-facing backend owns dashboard integration. The .NET 8 Windows Local Agent isolates local hardware and service concerns, while the Tray companion provides the interactive operator-session boundary for startup and launching.

## Supported environment

- Windows 10/11 for the primary field deployment
- Panasonic ToughBook/ToughPad as the primary rugged hardware target
- Node.js 20 or newer for dashboard development and local execution
- npm for JavaScript dependencies
- .NET 8 SDK when building or testing the Windows Agent from source
- Internet access for live external data; local dashboard assets remain useful when sources are unavailable

## Getting started

Install dependencies and run the local development server:

```powershell
git clone https://github.com/crush11b/FieldOpsDashboard-2.0.git
cd FieldOpsDashboard-2.0
npm install
npm run dev
```

Open `http://localhost:3000`.

Build and run the production bundle:

```powershell
npm run build
npm start
```

## Build and test

```powershell
npm run metadata:check
npm run typecheck
npm test
npm run build
```

For the Windows Agent and Tray companion:

```powershell
dotnet build .\\agent\\FieldOps.Agent.sln
dotnet test .\\agent\\FieldOps.Agent.sln
```

## ToughBook deployment

Detailed installation and update mechanics are kept outside the public product overview:

- [Offline and local deployment guide](README_OFFLINE_DEPLOYMENT.txt)
- [Transactional dashboard updater](UpdateDashboard.ps1)
- [Windows Local Agent documentation](agent/README.md)
- [ToughBook and Windows validation records](docs/validation/)
- [Approved deployment and architecture direction](docs/README.md)

## Documentation

- [Documentation index](docs/README.md)
- [Project rebaseline](docs/planning/FieldOpsDashboard_Project_Rebaseline_2026.md)
- [Architecture decisions](docs/architecture/decisions/)
- [Serial-port enumeration](docs/architecture/Serial-Port-Enumeration.md)
- [Windows system telemetry](docs/architecture/Windows-System-Telemetry.md)
- [Telemetry model and status semantics](docs/Telemetry.md)
- [Telemetry credential provisioning](docs/TelemetryCredentialProvisioning.md)

## Project status

FieldOps Dashboard is actively developed for controlled local deployment and field evaluation. Version 2.3 is the released single-operator baseline. Version 2.4 Field Tools work remains on a separate development branch and is not being merged into `main` by this targeted documentation update.

Some integrations require local hardware, installed radio applications, configured credentials, or live external services. Modeled, cached, stale, unavailable, and manual values should be interpreted according to their displayed status.

## License status

No license file is currently tracked in this repository. Licensing is intentionally left unresolved until the project authority adds an explicit license.
