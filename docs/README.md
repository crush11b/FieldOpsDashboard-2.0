# Project Documentation

The `architecture/` directory contains the project's design baseline and accepted Architecture Decision Records.

The `planning/` directory contains the development roadmap, engineering backlog, and approved project rebaseline material.

## Current governing direction

The active product strategy is defined by:

- [`planning/Version-3.0-Field-Operations-Assistant.md`](planning/Version-3.0-Field-Operations-Assistant.md) - authoritative V3.0 scope, architecture, migration, sequencing, and acceptance contract
- [`planning/Version-3.0-Integration-Decision-Closure.md`](planning/Version-3.0-Integration-Decision-Closure.md) - final V3.0 dispositions for SmartFrequency, Local/NVIS, communications, logbook, scoring, diagnostic, and equipment-enrichment decision tracks
- [`planning/FieldOpsDashboard_Project_Rebaseline_2026.md`](planning/FieldOpsDashboard_Project_Rebaseline_2026.md)
- [`architecture/decisions/ADR-007-Single-Operator-MVP-and-Proportionate-Engineering.md`](architecture/decisions/ADR-007-Single-Operator-MVP-and-Proportionate-Engineering.md)
- [`architecture/decisions/ADR-013-Operating-Context-and-Multi-Entity-QSO-Associations.md`](architecture/decisions/ADR-013-Operating-Context-and-Multi-Entity-QSO-Associations.md) - accepted V3.0 operating-context and QSO-association contract
- [`architecture/decisions/ADR-014-Equipment-Inventory-Loadouts-and-Historical-Snapshots.md`](architecture/decisions/ADR-014-Equipment-Inventory-Loadouts-and-Historical-Snapshots.md) - accepted V3.0 inventory/loadout contract
- [`architecture/decisions/ADR-015-V3-Persistence-Migration-and-Rollback-Data-Safety.md`](architecture/decisions/ADR-015-V3-Persistence-Migration-and-Rollback-Data-Safety.md) - accepted V3.0 migration and rollback-data contract

These documents preserve the existing architecture while reprioritizing delivery around a usable single-operator field product. Multi-user, enterprise, fleet, remote-administration, signing, and advanced hardening work remain documented future capabilities but do not block the current MVP.

The POTA document is a non-authoritative research and design input. It records upstream findings for future POTA/SOTA product design and does not approve sequencing, workflow, UI contents, caching, acceptance criteria, or implementation.

- [`planning/Version-2.4-POTA-Activation-Target-Decision.md`](planning/Version-2.4-POTA-Activation-Target-Decision.md) - non-authoritative research input; the approved Version 2.4 product boundary is recorded in the rebaseline
- [`planning/Version-2.9-Field-Product-Completion.md`](planning/Version-2.9-Field-Product-Completion.md) - authoritative completed V2.9 scope and deferred-work reconciliation

The historical roadmap and engineering backlogs remain inputs only after reconciliation with the approved rebaseline, accepted ADRs, completed V2.9 record, and the authoritative V3.0 contract. Historical entries do not reopen completed work.

The authoritative V2.9-08 closure record is [`validation/Version-2.9-08-Punch-List-Closure.md`](validation/Version-2.9-08-Punch-List-Closure.md). It records evidence and final dispositions for every inventoried punch-list item while preserving the historical V2.8 boundary.

The closed V3.0 workflow audit is [`validation/Version-3.0-11-Workflow-Punch-List-Audit.md`](validation/Version-3.0-11-Workflow-Punch-List-Audit.md). It records authoritative data homes, primary terminology corrections, completed/deferred/release-gated work, and field acceptance of production multi-entity logging and per-entity ADIF export. V3.0-12 integration and release gates remain open.

The V3.0-12 automated-integration evidence is [`validation/Version-3.0-12-Automated-Integration-Gate.md`](validation/Version-3.0-12-Automated-Integration-Gate.md). It records the complete supported Windows gate and exact totals. CF-20 migration, rollback, reboot/sign-in acceptance, final identity reconciliation, and release authorization remain open.

The authoritative V2.9-09 automated-integration evidence is [`validation/Version-2.9-09-Automated-Integration-Gate.md`](validation/Version-2.9-09-Automated-Integration-Gate.md). It records the passed automated gate and completed V2.9-09 evidence boundary.

The authoritative V2.9-09 live update and CF-20 acceptance evidence is [`validation/Version-2.9-09-Field-CF20-Acceptance.md`](validation/Version-2.9-09-Field-CF20-Acceptance.md). It records the updater correction, successful running-Dashboard update and reboot verification.

The V2.9.0 release-candidate record is [`validation/Version-2.9-Release-Closure.md`](validation/Version-2.9-Release-Closure.md). The accepted V2.9.1 patch baseline is recorded in [`validation/Version-2.9.1-Release-Closure.md`](validation/Version-2.9.1-Release-Closure.md). V3.0 begins from tag `v2.9.1` at commit `7e67ed7a1820ce5fa11b57b89cf33808fb07aa3c`.
