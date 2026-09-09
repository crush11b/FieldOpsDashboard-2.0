# Version 2.9 - Field Product Completion

- Status: **Authoritative scope contract for 2.9-00; later slices require separate approval**
- Baseline: **V2.8.0**, tag `v2.8.0`, peeled commit `a92b3a5e58201a8622ebab138fc7832ca7758b71`
- Supported deployment: one operator on one locally operated Windows ToughBook/ToughPad
- Entry branch: `planning/2.9-00-scope-contract`

## 1. Purpose and product boundary

V2.9 is the final organization, extensibility, and punch-list release before V3.0. It turns the existing application-launching surface into a truthful, manageable App Catalog and closes the highest-value reliability and usability observations that remain after V2.8. It is not only an Apps release: the release also reconciles the operational punch list and establishes the evidence boundary for future SmartFrequency work.

V2.9 remains a locally operated, offline-capable field product. It does not turn FieldOps into a radio controller, installer marketplace, fleet platform, or generalized AI assistant. V3.0 remains the milestone for the cohesive Field Operations Assistant originally envisioned.

## 2. Accepted baseline and entry gate

V2.8.0 completed Operational Intelligence for the supported single-operator ToughBook deployment and passed CF-20 field acceptance on 2026-09-08. Its accepted behavior includes PLAN -> PREPARE -> OPERATE -> REVIEW, retained mission context, GNSS-backed clock synchronization, QSO evidence retention, separated modeled/environmental/observed/station-specific evidence, truthful MY SIGNAL semantics, and read-only completed Review.

The V2.9 entry gate is cleared only from the exact V2.8 baseline above. The current 2.9-00 branch was created from `origin/main` at that commit. The external planning workbook `C:\FieldOpsDev\Inputs\App catalog.xlsx` is not repository content and must remain outside version control.

## 3. Architectural findings

The source review confirms:

- Native and HTTP/HTTPS launching already crosses the Tray named-pipe boundary. The browser calls the local Express route; the route resolves an approved configured ID; the Tray receives the bounded pipe request.
- The current launcher accepts absolute local `.exe` paths and HTTP/HTTPS URIs only. UNC, relative, non-`.exe`, malformed, and unsupported URI targets are rejected.
- Outcomes distinguish successful executable handoff, successful URI opening, missing executable, invalid request, launch failure, busy state, and unavailable Tray.
- `args` and `workingDir` exist in `AppLauncherItem` and configuration normalization, but `TrayLaunchRequest` currently carries only launch type and target. They are not currently executed.
- JAR, shortcut, PDF/document, directory, shell/protocol, and other target types require explicit security and UX decisions. They are not implied by the current `.exe`/HTTP contract.
- Configured, detected, installed, enabled, available, and successfully launched are different states. No one may be used as a synonym for another.
- Default entries are restored when their IDs are absent. Delete semantics must therefore distinguish hiding/removal from restoring a built-in default.
- Existing local per-operator dashboard configuration persistence is the default persistence boundary for catalog settings unless a reviewed slice proves it insufficient.
- Browser requests resolve only approved catalog IDs; arbitrary browser-supplied launch targets remain forbidden.
- The Auto App Installer surface is legacy/prototype behavior. Detection, generated scripts, and package suggestions must not silently become authorization for third-party installation.

## 4. Deferred-work inventory and disposition

| Deferred item or observation | Disposition | Contract |
| --- | --- | --- |
| App Library/catalog and launcher management | **V2.9 committed** | Slices 2.9-01 through 2.9-06, subject to their individual gates. |
| Reliable Tray launcher protocol | **V2.9 committed** | Preserve the named-pipe boundary and typed outcomes while adding only approved request capabilities. |
| Discovery and availability semantics | **V2.9 committed** | Separate configured, detected, installed, enabled, available, and launch result states. |
| Catalog persistence and default restore/delete behavior | **V2.9 committed** | Reuse local operator persistence and define built-in identity semantics. |
| Curated catalog migration | **V2.9 committed** | Migrate the approved workbook rows without adding production records in 2.9-00. |
| Capability-aware application records | **V2.9 committed** | Model target type, capability, dependency, and evidence without claiming FieldOps integration. |
| SmartFrequency evidence foundation | **V2.9 committed** | Evidence contract only; no recommendation engine or radio control. |
| Remaining pre-V3.0 punch list | **V2.9 committed** | Resolve or disposition high-value items in 2.9-08. |
| Integration, update survival, CF-20 acceptance | **V2.9 committed** | 2.9-09 must prove persistence, update survival, and field behavior. |
| Automatic PLAN forecast and space-weather refresh | **Conditional V2.9/go-no-go** | Admit only after an explicit refresh policy, provider behavior, retained-evidence semantics, and offline review. |
| Duration-aware propagation forecast | **V2.9 review committed; implementation conditional** | Review mission-duration coverage and presentation; do not imply continuous prediction from sparse samples. |
| Weather and Alerts `Unknown` investigation | **Conditional V2.9/go-no-go** | Reproduce first; fix only if the defect remains present and the owner and acceptance evidence are identified. |
| JS8 conventional-frequency default correction | **V2.9 review committed; implementation conditional** | Correct only where a defensible conventional default exists; preserve editable operator override and unknown semantics. |
| QSO Logger frequency-entry usability | **V2.9 review committed; implementation conditional** | Review controlled band/mode/frequency entry and remove misleading defaults without requiring radio integration. |
| Non-elevated updater behavior | **V2.9 review committed; implementation conditional** | Admit bounded updater corrections only with explicit operator-token and elevation validation. |
| Installation-file locks and backup cleanup | **V2.9 review committed; implementation conditional** | Bound lock handling, rollback, and historical-backup cleanup without weakening update safety. |
| Installed-launcher cleanup | **V2.9 review committed; implementation conditional** | Remove stale launcher processes and prove the supported installed operator path remains available. |
| Legacy Auto App Installer presentation | **V2.9 review committed; implementation conditional** | Reclassify as legacy/prototype UI; detection and generated scripts never authorize third-party installation. |
| BktTimeSync disposition | **V2.9 review committed; implementation conditional** | Reevaluate or disable as a default because native GNSS-backed clock synchronization exists. |
| Stale README and setup wording | **V2.9 review committed; implementation conditional** | Correct release/setup presentation without claiming unimplemented V2.9 behavior. |
| SSB occupied-frequency and nearby-interference evidence | **V2.9 committed** | Define attributable evidence inputs; do not claim a recommendation. |
| Digital established calling/activity frequencies | **V2.9 committed** | Preserve the distinction between useful activity frequencies and empty-spectrum seeking. |
| POTA/SOTA spots as activity input | **Conditional V2.9/go-no-go** | Provider use, freshness, rate, cache, and offline feasibility require review; this is separate from valid manual web launchers. Spots are not propagation proof. |
| POTA Spots and SOTA Spots manual web launchers | **V2.9 committed** | Preserve as approved manual web targets; possible future attributed activity-data providers require a separate decision. |
| POTA Log Upload and SOTA Log Upload manual web launchers | **V2.9 committed** | Preserve as approved manual web targets; direct/API/automatic FieldOps submission remains excluded. |
| Modeled propagation, general observed RF, station-specific reception, spots, actual QSOs | **V2.9 committed** | Keep each evidence family separately attributable. |
| Automatic frequency recommendations | **V3.0 handoff** | Requires product, evidence, and operator-trust decisions beyond this foundation. |
| CAT, PTT, tuning, and transmit control | **Future separately authorized** | Future safety/product work; not committed to V3.0 by this contract. |
| Automatic spotting and direct/API/automatic log submission | **Future separately authorized** | Future safety/product work; not committed to V3.0. Manual web launch remains allowed. |
| Persistent equipment inventory and reusable loadouts | **V3.0 handoff** | Remains the V3.0 Field Operations Assistant boundary. |
| Equipment selection/optimization and endurance strategy | **V3.0 handoff** | No V2.9 recommendation or optimization claim. |
| Multi-user, fleet, remote administration, centralized policy | **Later enterprise/hardening** | Not current single-operator release gates. |
| Code signing and enterprise installer hardening | **Later enterprise/hardening** | Revisit when distribution requires it. |
| Alternate-user, Fast User Switching, RDP validation | **Later enterprise/hardening** | Preserve the existing proportionate-engineering boundary. |
| General credential rotation/revocation UX and broad privileged APIs | **Later enterprise/hardening** | No speculative platform expansion. |
| Advanced audit/support-bundle framework | **Later enterprise/hardening** | Retain only the diagnostics needed for current operation. |
| Local/NVIS evaluation | **V3.0 handoff** | Not implemented by V2.9; no prediction or recommendation claim. |
| Direct APRS integration | **V3.0 handoff** | App launching is not integration; no FieldOps-owned APRS protocol or control is committed. |
| Direct Meshtastic integration | **V3.0 handoff** | App launching is not integration; no FieldOps-owned Meshtastic protocol or control is committed. |
| Direct Direwolf integration | **V3.0 handoff** | App launching is not integration; no FieldOps-owned TNC or packet-control path is committed. |
| Direct Winlink integration | **V3.0 handoff** | App launching is not integration; no FieldOps-owned message or transport path is committed. |
| Direct DigiPi integration | **V3.0 handoff** | App launching is not integration; no FieldOps-owned DigiPi protocol or control is committed. |
| QSL, LoTW, Club Log, and eQSL integration | **V3.0 handoff** | No external logbook synchronization or submission is committed. |
| Contest scoring | **V3.0 handoff** | Not part of the V2.9 catalog or logging contract. |
| Award tracking | **V3.0 handoff** | Not part of the V2.9 catalog or logging contract. |
| WSPR survey and evidence work | **Deferred beyond V2.9** | No WSPR implementation is authorized here. |
| Continuous NTP/PPS/clock steering | **Future separately authorized** | Native GNSS-backed synchronization remains bounded and operator-authorized; no continuous steering is committed. |
| True path prediction | **V3.0 handoff** | Modeled P.533 guidance is not true path prediction. |
| Generalized provider platforms | **Future separately authorized** | Provider support requires concrete use cases and feasibility review; no provider framework is authorized. |
| Completed mission lifecycle work | **Retired or superseded** | V2.6-V2.8 activation lifecycle and Review work is accepted; do not reopen it as a V2.9 backlog item. |
| PSKReporter MY SIGNAL work | **Retired or superseded** | V2.8 station-specific evidence and truthful zero semantics are accepted; future enhancements require a new decision. |
| Layered operational guidance work | **Retired or superseded** | V2.8 layered evidence and deterministic guidance are accepted; V2.9 preserves the contract rather than reopening it. |
| FX-4CR issue | **External/non-FieldOps** | Do not absorb third-party defects into FieldOps scope. |
| WSJT-X transmit problem | **External/non-FieldOps** | FieldOps remains read-only with respect to WSJT-X. |
| FT8CN/FT8TW Bluetooth problem | **External/non-FieldOps** | No FieldOps ownership established. |
| V2.3 SQLite/capability-registry framework work | **Retired or superseded** | No generalized abstraction without multiple real consumers. |
| Obsolete V2.3 enterprise release blockers | **Retired or superseded** | Rebaseline and ADR-007 supersede them for the supported deployment. |
| V2.4 research-only POTA provider contract | **Retired or superseded** | Research remains evidence, not authorization; use the reviewed 2.9/3.0 contract. |
| V2.8 WSPR experiment/no-go | **Later enterprise/hardening** | Deferred beyond committed V2.9 scope; no automatic revival or implementation is authorized. |
| Old statements that V2.8 remained pending | **Retired or superseded** | The 2026-09-08 acceptance record is authoritative. |

### Legacy DOCX reconciliation

The legacy planning sources were read, not merely inventoried: `FieldOpsDashboard_Development_Roadmap_v1.0.docx`, `Engineering_Backlog_v1.0_Part_1_Project_Foundation.docx`, `Engineering_Backlog_v1.0_Part_2_Core_Platform.docx`, `Engineering_Backlog_v1.0_Part_3_Advanced_Capabilities.docx`, and `Engineering_Backlog_v1.0_Part_4_Project_Management.docx`. Their material findings are reconciled here: the roadmap and foundation backlog establish the original platform, launcher, deployment, and enterprise ambitions; the core-platform backlog supplies the local persistence, service, Tray, updater, and reliability history; the advanced-capabilities backlog supplies radio control, recommendations, equipment/loadout, spotting, and integration candidates; and the project-management backlog supplies release sequencing, validation, documentation, and deferred-work governance. Completed V2.3-V2.8 behavior is not retained as active backlog merely because the DOCX records are historical. Enterprise expansion, radio control, generalized recommendations, and unsupported third-party integration remain later or excluded work under this contract.

## 5. App Catalog reconciliation

The external workbook was read by preserving columns. Actual records are rows with a nonempty column B (`App`); category-heading rows have column B blank. Excluding the row-2 header produces exactly 40 entries. The workbook is not committed.

The authoritative operator-facing categories are exactly:

1. **Digital Comms**
2. **APRS**
3. **Satellite Ops**
4. **Network Voice**
5. **POTA/SOTA**
6. **Web Apps**
7. **Utilities**

Logging, mapping, radio control, remote operation, and time synchronization are capability labels or declared capabilities, not replacement categories. They must remain metadata on records assigned to one of the seven categories above. No alternate taxonomy is authoritative for the App Catalog.

The following table accounts for every workbook record. “Disposition” describes the planning decision, not current runtime integration.

| Workbook row | Workbook application | Authoritative category | Disposition |
| ---: | --- | --- | --- |
| 4 | WSJT-X | Digital Comms | Curated existing optional application; read-only evidence only, no control claim. |
| 5 | WinLink Express | Digital Comms | Curated optional entry; no FieldOps integration or message submission claim. |
| 6 | Vara HF | Digital Comms | Curated optional dependency/tool entry; availability must be detected separately. |
| 7 | Vara FM | Digital Comms | Curated optional dependency/tool entry; availability must be detected separately. |
| 8 | JS8Call | Digital Comms | Curated optional entry; conventional-frequency defaults remain a punch-list decision. |
| 9 | GridTracker | Digital Comms | Curated optional entry; no live integration claim. |
| 10 | JTAlert | Digital Comms | Curated optional entry; executable path and arguments are separate fields. |
| 11 | MSHV | Digital Comms | Curated optional entry; no integration claim. |
| 12 | FlDigi | Digital Comms | Curated optional entry; no integration claim. |
| 13 | FlRig | Utilities | Curated optional entry; no CAT/control authorization follows from listing it. |
| 16 | YAAC | APRS | Reevaluate and likely deprioritize or disable; do not make it a default dependency. |
| 17 | Direwolf | APRS | Curated optional entry; no FieldOps-owned TNC or packet-control claim. |
| 18 | PinPoint | APRS | Keep and prioritize as a curated optional entry. |
| 22 | GPredict | Satellite Ops | Curated optional entry; no automatic radio/rotor control claim. |
| 23 | UISS | Satellite Ops | Curated optional entry; no integration claim. |
| 27 | Wires-X | Network Voice | Curated optional entry; no network-voice control claim. |
| 28 | D-Star Doozy | Network Voice | Curated optional entry; no integration claim. |
| 29 | QSO One | Network Voice | Add/retain as curated entry; accurately describe DMR/Fusion operation without a radio. |
| 32 | HamClock | Web Apps | Curated configurable LAN URL; never ship a fixed personal address. |
| 33 | HamDashboard | Web Apps | Curated configurable URL; availability is not FieldOps integration. |
| 34 | PSKReporter | Web Apps | Curated web destination; observed-RF evidence remains separately owned and attributed. |
| 35 | APRS.fi | Web Apps | Remove fixed personal coordinates from defaults; use operator-configurable URL/query. |
| 36 | FieldSpotter | Web Apps | Curated optional web entry; no automatic spotting/submission claim. |
| 37 | QRZ Lookup | Web Apps | Curated optional web entry; no lookup integration or credential handling claim. |
| 38 | WebSDR | Web Apps | Curated configurable web entry; no receiver-control claim. |
| 39 | SOTLAS | Web Apps | Remove fixed personal coordinates from defaults; use operator-configurable URL/query. |
| 42 | HamRS | POTA/SOTA | Curated optional entry; no direct log synchronization claim. |
| 43 | N1mm Logger | POTA/SOTA | Curated optional logging entry; no contest integration claim. |
| 44 | Ham2K | POTA/SOTA | Confirm and use the proper product name, likely Ham2K/PoLo; do not encode the uncertain name as settled. |
| 45 | POTA Spots | POTA/SOTA | Valid manual web launcher; possible future attributed activity-data provider use requires a separate conditional decision. |
| 46 | POTA Log Upload | POTA/SOTA | Valid manual web launcher; direct/API/automatic FieldOps submission is excluded. |
| 47 | SOTA Spots | POTA/SOTA | Valid manual web launcher; possible future attributed activity-data provider use requires a separate conditional decision. |
| 48 | SOTA Log Upload | POTA/SOTA | Valid manual web launcher; direct/API/automatic FieldOps submission is excluded. |
| 52 | WireGuard | Utilities | Curated optional utility; no FieldOps network administration claim. |
| 53 | BktTimeSync | Utilities | Reevaluate or disable as a default because FieldOps now has native GNSS-backed clock synchronization; listing or manually launching it is not integration. |
| 54 | Otto | Utilities | Support only through an explicitly approved shortcut or executable target; no dependency or integration claim. |
| 55 | AntScope | Utilities | Curated optional utility; no antenna-measurement integration claim. |
| 56 | Band Chart | Utilities | Document target only if document launching is separately approved; otherwise disable. |
| 58 | HT Commander | Utilities | Add as curated optional entry. |
| 59 | POTACAT | POTA/SOTA | Add as curated optional entry; accurately describe HF, digital, and remote-phone capabilities. |

### Catalog domain and target boundaries

The catalog domain should distinguish an operator-facing record from a launch target and from runtime evidence. A record may contain identity, display name, one or more explicitly approved target descriptors, category, description, capabilities, dependencies, configuration fields, and evidence state. Target types require explicit allowlisted contracts for:

- local executable (`.exe` absolute path);
- HTTP/HTTPS URI;
- explicitly approved shortcut or executable target for Otto-like cases;
- document target only after document launching is approved;
- directory, JAR, shell protocol, and other targets only after separate threat, UX, and validation decisions.

A target being configured does not mean it is detected, installed, enabled, available, or successfully launched. A catalog record does not mean FieldOps is integrated with the application. Browser launch continues to accept only a catalog ID and never an arbitrary path or URI.

## 6. V2.9 slices and acceptance criteria

The authoritative V2.9 plan contains exactly ten slices: 2.9-00, 2.9-01, 2.9-02, 2.9-03, 2.9-04, 2.9-05, 2.9-06, 2.9-07, 2.9-08, and 2.9-09.

### 2.9-00 - Scope and deferred-work reconciliation

Produce this contract from repository and workbook evidence. Acceptance: baseline, scope boundary, all deferred dispositions, all 40 catalog rows, seven categories, architectural findings, SmartFrequency boundary, ten-slice plan, exclusions, V3.0 handoff, and validation strategy are present; no implementation begins.

### 2.9-01 - App Catalog domain and migration contract

Define stable IDs, category vocabulary, target types, capabilities, dependency semantics, configuration state, availability evidence, default provenance, delete/restore behavior, and migration rules. Acceptance: schema and migration tests prove backward compatibility, unknown/invalid records are rejected or safely retained, and no integration is implied by catalog membership.

### 2.9-02 - Reliable launcher protocol

Carry only approved target data through the existing Tray boundary, including separately validated arguments and working directory where approved. Acceptance: bounded framing, allowlisted target types, path/URI validation, argument handling, working-directory handling, busy/unavailable/failure/not-found outcomes, and injection-resistant tests pass on Windows.

### 2.9-03 - Discovery and availability

Implement truthful detection and availability evidence without treating detection as installation or launch success. Acceptance: missing, configured, detected, installed, disabled, unavailable, and launch-result states are independently testable; detection is bounded and does not install software.

### 2.9-04 - Catalog management and persistence

Provide operator management, favorites, enable/disable, configuration, and persistence using the existing local per-operator store. Acceptance: restart persistence, invalid-input handling, default restore/delete semantics, bounded text, and update survival pass.

### 2.9-05 - Curated catalog migration

Migrate the approved 40-row reconciliation into curated records only after 2.9-01 through 2.9-04 are accepted. Acceptance: every row maps to one stable ID and one authoritative category; uncertain products are labeled for review; personal coordinates are absent; no spreadsheet binary or unauthorized production record is added by 2.9-00.

### 2.9-06 - Capability-aware applications

Represent capabilities and dependencies without overstating integration. Acceptance: UI and API distinguish catalog membership, capability declaration, dependency state, and actual FieldOps evidence; read-only WSJT-X remains read-only; no CAT/PTT or submission path appears.

### 2.9-07 - SmartFrequency evidence foundation

Define evidence records and feasibility review only. Acceptance: SSB interference avoidance, digital activity-frequency semantics, attributed POTA/SOTA spots, provider/rate/freshness/cache/offline fields, and separate evidence families are covered by contracts and tests. No recommendation or control is implemented.

### 2.9-08 - Remaining pre-V3.0 punch list

Review and either fix or explicitly defer the individually inventoried stale README/setup wording, automatic PLAN forecast/space-weather refresh, duration-aware propagation forecast, Weather and Alerts Unknown behavior, JS8 defaults, QSO Logger frequency usability, non-elevated updater behavior, installation-file locks and backup cleanup, installed-launcher cleanup, legacy Auto App Installer presentation, and remaining high-value usability/presentation issues. Acceptance: every item has evidence, owner/disposition, and focused validation or a recorded blocker.

### 2.9-09 - Integration, update survival, and CF-20 acceptance

Integrate accepted slices, prove configuration and catalog survival through update/rollback/restart, and repeat focused CF-20 validation. Acceptance: no unauthorized launch target is accepted, catalog state survives the supported update path, Tray and Dashboard remain usable, offline/unavailable states remain truthful, and the complete 2.9 release gate passes on hardware.

## 7. Dependencies and sequencing

2.9-01 is the contract prerequisite for 2.9-02 through 2.9-06. 2.9-02 must precede launch-dependent discovery and catalog migration. 2.9-03 and 2.9-04 must precede 2.9-05. 2.9-06 depends on the stable catalog and launcher contracts. 2.9-07 is independent of launcher implementation but must reuse the existing evidence/provenance vocabulary. 2.9-08 may run as focused parallel punch-list work after its individual decisions are approved. 2.9-09 follows the accepted implementation slices and is the release integration gate.

## 8. Explicit V2.9 exclusions

V2.9 does not authorize CAT, Hamlib/rigctld, PTT, tuning, transmit control, automatic radio-hardware detection, automatic spotting, direct/API/automatic FieldOps log submission, QSO provider synchronization, third-party installation, arbitrary shell execution, arbitrary browser targets, radio/equipment selection, persistent inventory/loadouts, generalized AI recommendations, enterprise/multi-user/fleet behavior, code signing, or remote administration. Manually opening an approved upload website remains allowed.

No application records are added to production defaults by 2.9-00. This slice authorizes no deployment or version changes. Bounded updater corrections may be admitted by 2.9-08, and release/version metadata belongs only to an independently approved 2.9-09 release-closure step. No source, Agent, Tray, launcher protocol, configuration schema, deployment script, provider, or runtime file is changed by 2.9-00.

## 9. SmartFrequency evidence boundary

SSB evidence must be suitable for avoiding occupied frequencies and nearby interference. Digital operation normally favors established calling/activity frequencies rather than empty spectrum. POTA/SOTA spots may be an attributed activity input, but spots are not propagation proof.

Modeled propagation, general observed RF, station-specific reception, spots, and actual QSO results remain separately attributable. Any provider feasibility review must define permitted use, fields, rate limits, freshness, caching, provider support, and offline behavior. No CAT, tuning, PTT, transmit control, automatic spotting, or submission is authorized.

## 10. V3.0 handoff

V3.0 handoff means consideration during V3.0 planning; it is not an implementation commitment unless separately approved.

V3.0 owns the cohesive Field Operations Assistant: persistent equipment inventory, reusable loadouts, resource-aware recommendations, richer mission reasoning, and any future control or automation only after explicit safety and product approval. V2.9 supplies organized catalog and evidence foundations but must not smuggle V3.0 behavior into launcher metadata or SmartFrequency labels.

## 11. Validation strategy and model guidance

Automated validation should include focused TypeScript/domain/store/API/UI tests, launcher protocol and Windows named-pipe tests, path/URI/argument/working-directory security cases, migration and persistence tests, offline and unavailable-state tests, update-survival tests, `npm run metadata:check`, and `git diff --check`. A full broad suite is appropriate for integration slices, not for this documentation-only slice.

CF-20 acceptance should cover touch-readable catalog management, configured-versus-available truthfulness, launch success/failure/unavailable states, approved URI and executable behavior, update/restart persistence, offline operation, no arbitrary target launch, and coexistence with WSJT-X and Otto. External application defects remain external unless FieldOps behavior is implicated.

For every future slice, VS Code work should begin with **Auto**. The recommended Codex reasoning effort is:

| Slice | VS Code workflow | Codex reasoning effort |
| --- | --- | --- |
| 2.9-01 | Auto | Medium |
| 2.9-02 | Auto | Medium |
| 2.9-03 | Auto | Medium |
| 2.9-04 | Auto | Medium |
| 2.9-05 | Auto | Medium |
| 2.9-06 | Auto | Medium |
| 2.9-07 | Auto | High |
| 2.9-08 | Auto | Medium |
| 2.9-09 | Auto | High |

Each slice still requires focused review, acceptance evidence, and product-owner approval. Model choice does not authorize implementation, and no CAT/PTT/tuning/transmit-control, automatic-spotting, or automatic-submission work is currently committed to V3.0.


## 12. Authorization statement

This document authorizes only the 2.9-00 scope-contract work. No later V2.9 slice is authorized merely by writing this document. Each slice, including 2.9-01, requires separate review and approval before implementation begins.
