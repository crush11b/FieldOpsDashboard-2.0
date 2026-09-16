# Version 3.0 Integration Decision Closure

- Status: approved-scope proposal for V3.0-10A
- Baseline: V3.0-09B field-accepted at `6a4f7748413916f79a930dd87d47797c918e499a`
- Governing documents: V3.0 Field Operations Assistant contract, ADR-007, ADR-008, ADR-010, and ADR-012
- Scope: disposition only; this record authorizes no provider access, protocol integration, control path, deployment, or release

## 1. Decision standard

A candidate ships in V3.0 only when it has a concrete single-operator field workflow, supported and authorized data/protocol access, explicit ownership, truthful live/cached/stale/unavailable semantics, offline behavior, bounded persistence, and acceptance criteria that can be exercised on the CF-20. App Catalog launching is not direct integration. Historical roadmap placement is not implementation authorization.

The existing V3.0 workflow already supplies local planning, retained evidence, inventory/loadouts, Activation lifecycle, multi-entity logging, ADIF exchange, operational guidance, and review. A candidate must solve a remaining acceptance requirement or provide distinct field value proportionate to its risk and maintenance cost.

## 2. Final V3.0 dispositions

| Candidate | Concrete workflow considered | V3.0 disposition | Reason and reopening gate |
| --- | --- | --- | --- |
| Explainable SmartFrequency suggestions | Suggest a bounded band or activity area from modeled, observed, station-specific, and retained QSO evidence. | **Defer; evidence foundation only** | Current evidence can explain band context but cannot establish frequency occupancy, a clear frequency, or SSB usability. POTA machine access is unconfirmed and SOTA access remains blocked by ADR-012. Reopen only with a rule contract, operator-trust presentation, direct-occupancy semantics where applicable, and provider authorization. |
| Automatic frequency recommendations | Select or rank a specific operating frequency. | **Excluded from V3.0** | Absence of reports never proves a frequency clear. A separate safety/product approval and validated occupancy design are required. No tuning or radio control is implied. |
| Local/NVIS evaluator | Evaluate short-range/local mission suitability separately from regional P.533. | **Defer; unsupported state remains truthful** | The repository deliberately keeps local digital activity distinct from proof of NVIS. Reopen with a separately approved evaluator defining mechanism, bands, distance envelope, antenna/deployment inputs, validation data, confidence language, and offline behavior. |
| True path prediction | Predict a station-to-destination circuit continuously across the mission. | **Defer beyond V3.0** | Current P.533 work is discrete regional-path sampling, not validated true path or continuous prediction. Reopen only with a defined path model, input/data provenance, validation corpus, and acceptance thresholds. |
| Direct APRS | Read own-station position/status and nearby operational objects into FieldOps. | **Research candidate; no V3.0 implementation** | A read-only local workflow has plausible value, but source selection, privacy, packet age, deduplication, offline semantics, and authoritative-home rules are not approved. Existing PinPoint/APRS.fi/Direwolf entries remain launchers only. |
| Direwolf | Consume bounded local TNC status or decoded APRS packets from an operator-run Direwolf instance. | **Research candidate; no V3.0 implementation** | A future design must choose one supported local interface, remain loopback/read-only by default, define process ownership and failure states, and avoid packet/radio control. FieldOps will not install or configure Direwolf automatically. |
| Meshtastic | Display selected local node/message/status evidence relevant to an Activation. | **Research candidate; no V3.0 implementation** | No approved field question, supported interface, identity/privacy boundary, retention rule, or offline conflict policy is defined. No generalized mesh/provider abstraction is authorized. |
| Winlink | Show bounded local mailbox/message-status information for an operation. | **Research candidate; no V3.0 implementation** | Sending, account/credential handling, transport ownership, message retention, and failure semantics are unresolved. Reopen first as a read-only local status workflow; no automatic message creation or transmission. |
| DigiPi | Read a specific local service/status protocol from an operator-owned DigiPi. | **Research candidate; no V3.0 implementation** | App launching or arbitrary SSH/shell access is not integration. Reopen only with one documented local protocol, authentication boundary, read-only data contract, and CF-20 acceptance case. |
| WSPR evidence | Run or ingest a bounded pre-operation propagation survey using source-reported WSPR evidence. | **Defer pending provider experiment** | The evidence model preserves WSPR as distinct from PSKReporter, but no provider, authorization/terms review, sampling interval, retention policy, or operator-burden acceptance is approved. Reopen through a go/no-go experiment; never attribute source-reported power to operator context without evidence. |
| LoTW, Club Log, and eQSL synchronization | Upload/download or reconcile external logbook records. | **Defer beyond V3.0** | Authentication, service terms, duplicate identity, conflict resolution, submission confirmation, retention, and operator approval require service-specific designs. V3.0 retains local canonical QSOs and manual ADIF exchange. |
| Contest scoring | Calculate contest-specific scores from FieldOps QSOs. | **Does not belong in V3.0** | Contest rules and scoring are a separate product domain. External contest applications may remain App Catalog entries without an integration claim. |
| Award tracking | Track award progress across retained or external logs. | **Does not belong in V3.0** | Award definitions, authoritative confirmation, external synchronization, and long-term cross-operation aggregation exceed the field-operations release boundary. |
| Diagnostic history/export | Retain or export bounded evidence needed to diagnose the current local operation and release acceptance. | **Current bounded capability only; no expansion** | V3.0 may retain existing local logs, source/native identity, updater artifacts, and scoped evidence required by acceptance. A broad event warehouse, indefinite history, or generalized export platform is deferred. |
| External equipment-data enrichment | Query characteristics by manufacturer/model and offer operator-confirmed facts. | **Research and defer** | Source authority, terms, model matching, units, provenance, caching, conflicts, and safe operator confirmation are unresolved. Inventory remains operator-managed; imported data must never silently replace operator facts. |

## 3. SmartFrequency release decision

V3.0 ships the existing evidence vocabulary and the implemented deterministic mission/operating guidance. It does **not** ship a SmartFrequency recommendation engine. Modeled propagation, general observed RF, station-specific reception, activity spots, QSO results, activity references, and direct observations remain separate evidence families with separate limitations.

No FieldOps surface may claim that a frequency is clear, choose a transmit frequency, tune a radio, spot an operator, submit an activation, or convert missing evidence into a recommendation. A later proposal must demonstrate why a band-context explanation is insufficient before introducing another recommendation surface.

## 4. Local/NVIS release decision

Local/NVIS remains visible only as a recognized unsupported/deferred capability. P.533 regional sampling is not relabeled as NVIS. Local PSKReporter activity remains evidence of local-area digital reception with an unknown propagation mechanism. This is a deliberate truthful state, not an incomplete V3.0 acceptance item.

## 5. Integration architecture boundary

Any future approved integration must be capability-specific. It must not create a generalized provider/plugin framework merely to host one integration. Express continues to own browser-facing external/local data integration and constrained access; the Agent continues to own Windows hardware/OS telemetry; the browser receives no reusable Agent credential. Radio transmission/control and arbitrary shell execution remain excluded.

Where an external application already solves the operator workflow, the App Catalog remains the proportionate boundary until direct structured data produces distinct field value. FieldOps must not claim integration merely because it can launch that application.

## 6. Closure effect

Every V2.9 handoff and V3.0 decision-track candidate now has a terminal V3.0 disposition: shipped foundation, research candidate, deferred, bounded-current-only, or excluded. None is an unresolved V3.0 release blocker. Reopening an item requires a new bounded proposal and explicit approval; historical backlog text alone cannot reopen it.

V3.0-11 may now perform workflow/punch-list closure against the product that actually ships. V3.0-12 remains responsible for the complete automated gate, migration/update/rollback evidence, CF-20 acceptance, release closure, and separately authorized publication.
