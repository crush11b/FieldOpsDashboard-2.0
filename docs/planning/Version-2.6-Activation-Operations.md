# Version 2.6 - Activation Operations

- Status: Approved slice structure
- Baseline: Version 2.5.0
- Supported deployment: single operator on one locally operated Windows field computer

## Release objective

Evolve the Version 2.5 Operations Assistant into a practical activation workspace that prepares field context, retains mission context, records contacts, and preserves an activation as a coherent operational record.

## Approved slices

1. **2.6-01 - Activation Foundation**: durable Activation identity, local persistence, SmartDeploy and Activation Notes association, and minimal lifecycle UI.
2. **2.6-02 - GPS Time & Offline Readiness**: GPS/Windows time evidence and offline preparation workflow.
3. **2.6-03 - QSO Logging & ADIF**: durable contact records and ADIF import/export workflow.
4. **2.6-04 - Activation Review**: post-activation review and analysis of retained activation artifacts.

## 2.6-01 status

Implemented on the consolidated `feature/2.6-activation-operations` branch. Activation is a first-class typed domain concept backed by a local JSON store. It references retained SmartDeploy briefs and Activation Notes rather than copying their evidence payloads.

The slice supports POTA, SOTA, and General activations; optional planned coordinates, Maidenhead grid, mission window, title, and reference; planned, active, and completed lifecycle states; corrupt-data diagnostics; and a minimal SmartDeploy-integrated operator panel.

## Explicit exclusions

The following are not part of 2.6-01: GPS or Windows clock synchronization, Offline Preparation, QSO logging, ADIF workflow, Activation Review, PSKReporter, spotting, equipment/loadout profiles, direct WSJT-X or radio integration, APRS, Meshtastic, Direwolf, Winlink, DigiPi, Local/NVIS, and AI features.