# FieldOps Dashboard

> A locally operated, field-first amateur-radio operations platform for portable and rugged deployments.

[![Version 2.7.0](https://img.shields.io/badge/version-2.7.0-005B96?style=for-the-badge)](https://github.com/crush11b/FieldOpsDashboard-2.0/releases/tag/v2.7.0)
[![Status](https://img.shields.io/badge/status-2.7%20release%20closure-C47F00?style=for-the-badge)](#current-release)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-1F6FEB?style=for-the-badge&logo=windows&logoColor=white)](#supported-environment)

## What it is

FieldOps Dashboard brings the operational picture for a field radio station into one touch-friendly local application. It combines location, weather, propagation, system status, application launching, logging, and operator-facing Field Tools so an operator does not have to assemble the essentials across many disconnected tools.

It is designed for portable amateur-radio work, ToughBook/ToughPad computers, camping and travel, and other situations where connectivity may be slow, intermittent, or unavailable.

## Why it exists

Field operations need useful information even when individual data sources fail. FieldOps keeps the local dashboard usable, identifies where information came from, and distinguishes live, cached, stale, unavailable, manual, and modeled values instead of filling gaps with fabricated defaults.

The project prioritizes practical single-operator field usefulness, trustworthy information, local operation, and graceful degradation over speculative enterprise infrastructure.

## Current release

**Version 2.7.0 - Connected Operations release closure**

This release completes Connected Operations on top of the dependable Windows Local Agent and Tray baseline. It is designed for single-operator ToughBook use with local and offline operation, honest source and freshness states, retained activation evidence, and source-aware live operating context.

Operations Assistant includes:

- **Coordinate Workspace**: GNSS or manual coordinates, Maidenhead grid, distance, bearing, and source-aware location states.
- **Offline P.533 guidance**: Bundled and verified P.533 assets provide modeled HF propagation guidance when connectivity is unavailable; modeled results remain clearly distinct from observed RF evidence.
- **Retained SmartDeploy briefs**: Bounded POTA/SOTA planning briefs retain propagation, path, mission-window, and operational context locally for later field use.
- **Activation Notes**: Local notes connect mission context and operator observations to an activation without requiring a live service.
- **Field Readiness Checklist**: A persistent pre-deployment checklist supports repeatable ToughBook field preparation.
- **Local/offline persistence**: Configuration, planning briefs, notes, and readiness state are retained locally for intermittent or unavailable connectivity.
- **Updater and native runtime improvements**: Exact-revision deployment checks, native artifact publication, transactional updater behavior, and runtime-readiness validation support the Windows Agent and Tray companion.
- **Operations Readiness**: Brief-anchored operation context includes station, antenna, mode, checklist, Activation Notes, planned/current location separation, day-of live weather and alerts, collapsible Findings, and Print / Save PDF.
- **Mission-window evidence**: Retained terrestrial forecasts, brief-scoped space-weather evidence, and an offline P.533 band outlook remain available across restart and offline use; forecasts and propagation are not guarantees.
- **Activation lifecycle**: PLAN, PREPARE, OPERATE, and REVIEW support activation start, QSO logging, Activation Notes, completion, and retained evidence review.
- **QSO Logger and ADIF**: Activation-owned contacts support manual logging, bounded ADIF import, and ADIF export.
- **WSJT-X Connected Operations**: Current Station consumes read-only WSJT-X state, and type 5/type 12 logged-QSO events share one provenance-aware ingestion path with conservative duplicate suppression.
- **CF-20 field acceptance**: Sustained WSJT-X multicast, Current Station tracking, simultaneous FieldOps plus Otto consumption, and real over-the-air QSO ingestion passed on the Panasonic ToughBook CF-20 Mk2.
- **ToughBook runtime semantics**: GNSS clock readiness, Dashboard runtime replacement, revision/runtime parity, and interactive Tray restoration are validated for deployment.

See the [Version 2.7 changelog](CHANGELOG.md) and the [Version 2.7 activation plan](docs/planning/Version-2.7-Connected-Operations.md).

## What works today

- Operating-location workspace with GNSS, manual, stale, unavailable, and source-aware location states
- Latitude/longitude and Maidenhead grid presentation
- Distance and bearing calculations
- Sunrise, sunset, and civil/nautical/astronomical twilight calculations
- Current weather, short-range weather context, and NOAA/NWS alerts
- P.533 HF propagation modeling and guidance, clearly identified as modeled information
- Recent PSKReporter observed-RF evidence, with source and freshness context
- Windows battery, power, CPU, memory, storage, network, and service-status telemetry
- Configurable launching of field applications and approved web destinations through the Tray companion
- Contact logging and ADIF export, including POTA/SOTA reference fields where supported by the log model
- Offline-capable frontend assets and a local Express backend
- Touch-oriented dashboard presentation with operator-selected display themes

Availability depends on the connected hardware and external source. The application preserves honest unavailable and stale states when a source cannot provide current information.

## Trustworthy data by design

FieldOps uses explicit source, freshness, and status semantics throughout the dashboard:

- **Live**: current data from an active source
- **Cached**: retained data within an accepted age
- **Stale**: retained data beyond its freshness threshold
- **Unavailable**: no usable value is available
- **Error**: the source failed, possibly with retained data
- **Manual**: explicitly entered or overridden by the operator
- **Modeled**: calculated guidance rather than a direct measurement

An unavailable Internet source does not make a modeled result a measurement, and a valid zero is not silently treated as missing.

## Version 2.7 boundary

Version 2.7.0 is scoped to a trustworthy, locally operated Connected Operations workspace. Live providers still require connectivity, and modeled, observed, retained, manual, and WSJT-X application evidence remain distinct.

Radio/CAT integration, direct WSJT-X integration, spotting, equipment/loadout profiles, and additional QSO Logger frequency usability remain deferred.

## SmartDeploy and activation-support scope

Version 2.4 recovers the original SmartDeploy concept as bounded POTA/SOTA activation planning. The released Field Tools scope supports retained offline planning briefs with propagation, path, and mission-time context, plus associated Activation Notes. It does not include Version 2.5 Field Operations Assistant behavior.

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

Future SmartDeploy work may synthesize POTA/SOTA mission context, an operating window, selected equipment and loadout, weather forecasts and hazards, space-weather outlooks, propagation modeling, antenna deployment considerations, power/endurance considerations, contingencies, and evidence-grounded operational recommendations.

The retained brief workflow is available in the bounded Field Tools scope. Inventory, loadouts, activation sequencing, and broader Operations Brief automation remain future product direction.

## Architecture at a glance

```text
Touch-friendly React dashboard
              |
              v
      Local Express backend
        |              |
        |              +-- Weather, alerts, space weather,
        |                  propagation, and observed RF adapters
        |
        +-- Local configuration and ADIF export

Windows Local Agent + Tray companion
        +-- GNSS and Windows system telemetry
        +-- Local service lifecycle and application launching
        +-- Loopback-only authenticated health boundary
```

The browser-facing backend owns external-data integration. The .NET 8 Windows Local Agent isolates local hardware and service concerns, while the Tray companion provides the interactive operator-session boundary for startup and launching.

## Supported environment

- Windows 10/11 for the primary field deployment
- Panasonic ToughBook/ToughPad supported as the primary rugged hardware target
- Node.js 20 or newer for dashboard development and local execution
- npm for JavaScript dependencies
- .NET 8 SDK only when building or testing the Windows Agent from source
- Internet access is useful for live external data, but the local dashboard and bundled P.533 assets support offline-capable operation

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
dotnet build .\agent\FieldOps.Agent.sln
dotnet test .\agent\FieldOps.Agent.sln
```

## ToughBook deployment

Deployment and update procedures are kept separate from the public product overview:

- [Offline and local deployment guide](README_OFFLINE_DEPLOYMENT.txt)
- [Transactional dashboard updater](UpdateDashboard.ps1)
- [Windows Local Agent documentation](agent/README.md)
- [ToughBook and Windows validation records](docs/validation/)

The supported native artifact publisher and release mechanics are documented with the Agent scripts and [native artifact workflow](.github/workflows/native-artifacts.yml).

## Documentation

- [Documentation index](docs/README.md)
- [Approved project rebaseline](docs/planning/FieldOpsDashboard_Project_Rebaseline_2026.md)
- [Version 2.4 POTA research and product-definition decision](docs/planning/Version-2.4-POTA-Activation-Target-Decision.md)
- [Architecture decisions](docs/architecture/decisions/)
- [Propagation guidance orchestration](docs/architecture/Propagation-Guidance-Orchestration.md)
- [Offline P.533 assets](docs/architecture/P533-Offline-Assets.md)
- [Telemetry model and status semantics](docs/Telemetry.md)

## Project status

FieldOps Dashboard is actively developed for controlled local deployment and field evaluation. Version 2.4 is the current Field Tools release, while broader POTA/SOTA activation-support workflows and the Local/NVIS evaluator remain deferred.

Some integrations require local hardware, installed radio applications, configured credentials, or live external services. Modeled, cached, stale, unavailable, and manual values should be interpreted according to their displayed status.

## License status

No license file is currently tracked in this repository. Licensing is intentionally left unresolved here until the project authority adds an explicit license.