# Project Documentation

The `architecture/` directory contains the project's design baseline and accepted Architecture Decision Records.

The `planning/` directory contains the development roadmap, engineering backlog, and approved project rebaseline material.

## Current governing direction

The active product strategy is defined by:

- [`planning/FieldOpsDashboard_Project_Rebaseline_2026.md`](planning/FieldOpsDashboard_Project_Rebaseline_2026.md)
- [`architecture/decisions/ADR-007-Single-Operator-MVP-and-Proportionate-Engineering.md`](architecture/decisions/ADR-007-Single-Operator-MVP-and-Proportionate-Engineering.md)

These documents preserve the existing architecture while reprioritizing delivery around a usable single-operator field product. Multi-user, enterprise, fleet, remote-administration, signing, and advanced hardening work remain documented future capabilities but do not block the current MVP.

The POTA document is a non-authoritative research and design input. It records upstream findings for future POTA/SOTA product design and does not approve sequencing, workflow, UI contents, caching, acceptance criteria, or implementation.

- [`planning/Version-2.4-POTA-Activation-Target-Decision.md`](planning/Version-2.4-POTA-Activation-Target-Decision.md) - non-authoritative research input; the approved Version 2.4 product boundary is recorded in the rebaseline
- [`planning/Version-2.9-Field-Product-Completion.md`](planning/Version-2.9-Field-Product-Completion.md) - authoritative completed V2.9 scope and deferred-work reconciliation

The roadmap and engineering backlog remain authoritative for implementation sequencing after they are reconciled with the approved rebaseline.

The authoritative V2.9-08 closure record is [`validation/Version-2.9-08-Punch-List-Closure.md`](validation/Version-2.9-08-Punch-List-Closure.md). It records evidence and final dispositions for every inventoried punch-list item while preserving the historical V2.8 boundary.

The authoritative V2.9-09 automated-integration evidence is [`validation/Version-2.9-09-Automated-Integration-Gate.md`](validation/Version-2.9-09-Automated-Integration-Gate.md). It records the passed automated gate and completed V2.9-09 evidence boundary.

The authoritative V2.9-09 live update and CF-20 acceptance evidence is [`validation/Version-2.9-09-Field-CF20-Acceptance.md`](validation/Version-2.9-09-Field-CF20-Acceptance.md). It records the updater correction, successful running-Dashboard update and reboot verification.

The final V2.9.0 release-candidate record is [`validation/Version-2.9-Release-Closure.md`](validation/Version-2.9-Release-Closure.md). It records the completed release gates and the separate authorization boundary for publication.
