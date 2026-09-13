# Version 2.9-08 Punch-List Closure

- Status: **Complete after this record is accepted**
- Scope: Documentation-only closure of the V2.9-08 punch list
- Branch: `feature/2.9-08e-punch-list-closure`
- Baseline: `main` at `598b5eb57678668113ab653247485d44a8f17c82`
- Date: 2026-09-13

## Authority and boundary

This record is the authoritative evidence and disposition record for every item inventoried under V2.9-08 in [Version 2.9 - Field Product Completion](../planning/Version-2.9-Field-Product-Completion.md). It does not authorize implementation outside the dispositions below and does not change application, Agent, Tray, updater, launcher, persistence, deployment, or release behavior.

V2.9 remains unreleased. V2.9-09 has not begun. No version, release, tag, artifact, or deployment action occurred for this closure. CF-20 integration and update-survival acceptance remain mandatory release gates.

## Evidence sources

- PR #64: README/setup wording, merged as `249b31497ebdc0d533620ff026feecf5a386df2e`.
- PR #65: Legacy Auto App Installer removal, merged as `7601de5bfac6647240d5a81e42192412242f17f8`.
- PR #66: automatic PLAN forecast and space-weather refresh, merged as `0838d2d6633b9169d9205a2a3281b2ae791d6339`.
- PR #67: QSO Logger frequency-entry usability, merged as `598b5eb57678668113ab653247485d44a8f17c82`. All four application shards passed. The numeric total for shard 2 was not captured, so no combined application-test total is asserted; V2.9-09 will establish the authoritative complete-suite total.
- [Version 2.7 final CF-20 acceptance](../planning/Version-2.7-Connected-Operations.md) records retained operational evidence, existing truthful limitations, and mandatory field validation boundaries.
- [CF-20 Development Updater](CF-20-Development-Updater.md) records the exact-revision updater workflow and its elevation-dependent operating path.
- [Offline deployment guide](../../README_OFFLINE_DEPLOYMENT.txt) records the supported local deployment and update boundary.

## Closure table

| # | Punch-list item | Disposition | Evidence and final boundary |
| --- | --- | --- | --- |
| 1 | README/setup wording | **Fixed** | PR #64 corrected the README and offline deployment wording. The merged commit is `249b31497ebdc0d533620ff026feecf5a386df2e`. |
| 2 | Automatic PLAN forecast and space-weather refresh | **Fixed** | PR #66 merged as `0838d2d6633b9169d9205a2a3281b2ae791d6339`. Retained evidence and truthful unavailable/failure behavior remain preserved. |
| 3 | Duration-aware propagation forecast | **Deferred to V3.0** | No continuous prediction is implied. Existing start/midpoint/end representative P.533 sampling remains the truthful bounded behavior. |
| 4 | Weather and Alerts Unknown behavior | **Already resolved; no reproduced defect** | Existing unavailable, not-requested, live, and unknown-severity semantics remain truthful. No speculative code change was made. Reopen only with a field reproduction. |
| 5 | JS8 conventional-frequency defaults | **Blocked pending field evidence** | An authoritative approved band/frequency matrix does not exist. A blank editable frequency is safer than an invented default. No JS8 frequency values are authorized. |
| 6 | QSO Logger frequency-entry usability | **Fixed** | PR #67 merged as `598b5eb57678668113ab653247485d44a8f17c82`. All four application shards passed; shard 2's numeric count was not captured, so no combined total is invented. V2.9-09 owns the authoritative complete-suite total. |
| 7 | Non-elevated updater behavior | **Blocked pending field evidence** | CF-20 evidence must use the approved standard-user, unelevated-administrator, and elevation matrix. No updater change is authorized without that evidence. Carry this validation into V2.9-09. |
| 8 | Installation-file locks and backup cleanup | **Already resolved; no reproduced defect** | Bounded retention, rollback diagnostics, and locking-process diagnostics are implemented. Carry real Windows locked-file and update-survival validation into V2.9-09. |
| 9 | Installed-launcher cleanup | **Already resolved; no reproduced defect** | Existing cleanup and process-tracking behavior has no reproduced current defect. Carry installed-path and stale-process smoke validation into V2.9-09. Do not add broader process-killing heuristics. |
| 10 | Legacy Auto App Installer presentation and endpoints | **Fixed** | PR #65 removed the legacy surface and merged as `7601de5bfac6647240d5a81e42192412242f17f8`. No third-party installation capability remains authorized. |
| 11 | Remaining high-value usability/presentation items | **Explicitly excluded; V3.0 handoff** | BktTimeSync is disabled by default. Broader recommendations, equipment/loadouts, radio integration, and Assistant behavior remain V3.0 handoff or separately authorized future work. |

## Final disposition

V2.9-08 is complete after this record is accepted. The closure distinguishes fixed work, already-resolved behavior with no reproduced defect, evidence-blocked work, V3.0 deferrals, and explicit exclusions without treating any unresolved evidence gap as a silent implementation waiver.

This record does not claim that V2.9 is released. V2.9 remains unreleased, V2.9-09 has not begun, and no release or deployment action occurred. V2.9-09 remains gated on integration, update survival, restart/rollback behavior, the approved CF-20 validation matrix, and the complete-suite release gate.

## Documentation-only validation

- `npm run metadata:check` - passed.
- `git diff --check` - passed.
- TypeScript, Vitest, application shards, Agent/.NET tests, PowerShell updater tests, and deployment commands were not run for this documentation-only closure.
