# Version 3.0 Initial Field-Test Candidate

- Baseline: `v2.9.1` / `7e67ed7a1820ce5fa11b57b89cf33808fb07aa3c`
- Candidate target date: **2026-09-17**
- Field evaluation begins: **2026-09-18**
- Supported hardware: Panasonic ToughBook CF-20
- Status: **IN PROGRESS — local packaged-build gate passed; Windows/native and CF-20 gates pending**

This worksheet covers the deliberately bounded initial V3.0 field candidate defined by the [Version 3.0 Cohesive Field Operations contract](../planning/Version-3.0-Cohesive-Field-Operations.md). It is not the complete V3.0 release, a release tag, publication authorization, or permission to bypass a failed gate.

## 1. Candidate contents

| Capability | Included behavior | Explicit boundary |
| --- | --- | --- |
| Product contract | Unified operating-context architecture and V3.0 slice ordering | Does not implement later slices by implication |
| Forecast time | UTC transport, presentation-boundary conversion, explicit timezone labels, deterministic DST tests | Planned remote sites remain explicitly UTC until a target timezone is retained |
| Network identity | Nullable connected Wi-Fi SSID from the Windows Agent with truthful Ethernet, disconnected, unavailable-name, and unavailable-telemetry fallbacks | No BSSID or MAC address in the normal interface |
| Maidenhead workspace | Shared strict 4/6/8-character conversion, representative center, bounds, distance, initial bearing, and copy controls | Center is an estimate, not an exact station position |
| Integration evidence | Application regression, native build/test, package, update survival, rollback, and CF-20 checks | A failure reduces or blocks candidate scope; it is not waived |

Multi-entity activation persistence/export, broad visual themes, duration-aware propagation, explainable SmartFrequency, diagnostic-history persistence, and direct third-party integrations are not part of this field candidate.

## 2. Local automated evidence — 2026-09-14

| Gate | Result | Evidence |
| --- | --- | --- |
| Product metadata | PASS | `npm run metadata:check` passed as part of the full application suite |
| TypeScript | PASS | `npm run typecheck` |
| Focused location integration | PASS | 168 tests across Maidenhead, coordinate, operating-location, SmartDeploy, observed-RF, and propagation-guidance suites |
| P.533 asset provision/verification | PASS | All pinned WASM and data assets downloaded and passed SHA-256 verification; runtime remains local after provisioning |
| Full application suite | CONDITIONAL | 1,278 passed, 6 failed, 1 skipped; the six failures are five host-specific Windows path assertions executed on Linux and one restricted OS multicast-interface enumeration |
| Front-end production bundle | PASS | `npx vite build`; 1,744 modules transformed |
| Server bundle | PASS | direct `esbuild` bundle of `server.ts` |
| P.533 worker bundle | PASS | direct `esbuild` bundle of `server/p533Worker.ts` |
| Full packaged build | PASS | `npm run build`, including source/runtime and `dist` P.533 verification |
| Agent solution | PENDING | .NET SDK is unavailable in the local validation environment; run on Windows/CI |
| PowerShell/update suite | PENDING | Run with the repository-compatible Windows PowerShell/Pester host |
| Diff hygiene | PASS | `git diff --check` |

The local conditional test result is not a candidate waiver. All P.533 model tests pass with the provisioned bundle. The Windows/native run must resolve the remaining checks in their supported host, compile and test the Agent, run the PowerShell suite, build the native package, and record exact revision parity before CF-20 installation.

## 3. Windows/native pre-deployment gate

Record the exact candidate commit before beginning: `________________________________________`

- [ ] Clean checkout of the exact candidate revision.
- [ ] Node 22.x and .NET 8.x are recorded.
- [ ] `npm ci` passes.
- [ ] `npm run p533:provision` and `npm run p533:verify` pass without a network dependency at runtime.
- [ ] `npm test` passes in the supported Windows environment.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes, including `p533:verify:dist`.
- [ ] `dotnet test agent/FieldOps.Agent.sln --configuration Release` passes; record test count: `________`.
- [ ] The repository-compatible PowerShell/Pester suite passes; record pass/fail/skip counts: `________ / ________ / ________`.
- [ ] Native Agent and Tray artifacts are published from the exact candidate revision.
- [ ] The packaged native artifact validates against the exact candidate revision.
- [ ] Source, native manifest, installed Agent, installed Tray, deployment manifest, and `/api/version` revisions all match.
- [ ] The tracked worktree is clean after generated test evidence is handled.

Any compile failure in `WindowsWifiSsidProvider`, failed native test, missing runtime asset, or revision mismatch is a stop condition.

## 4. CF-20 safety and upgrade gate

Before installation:

- [ ] Record installed version/revision and confirm the starting point is accepted V2.9.1.
- [ ] Back up product configuration, App Catalog, activation/QSO data, notes, checklists, briefs, and other retained local state using the supported update workflow.
- [ ] Record current Dashboard, Agent, Tray, GNSS, battery, network, WSJT-X, and application-launcher health.
- [ ] Confirm no activation is active and no QSO or export operation is in progress.

Upgrade and recovery:

- [ ] Update through the supported development-updater path while the normal Dashboard/Tray topology is running.
- [ ] Confirm configuration, App Catalog, activation/QSO data, and retained field records survive unchanged.
- [ ] Confirm exactly one Tray instance, Agent automatic startup, Dashboard availability, and revision parity after restart.
- [ ] Reboot Windows and repeat runtime, persistence, and revision checks.
- [ ] Confirm the updater retains a usable V2.9.1 rollback point.
- [ ] Exercise rollback only if required by a failed gate; record the reason and recovery result. Do not call the candidate accepted after rollback.

## 5. Candidate capability checks

### Forecast time and timezone

- [ ] Main forecast cards show local civil time that agrees with the CF-20 clock and include the resolved timezone label/abbreviation.
- [ ] Forecast chronology remains correct across midnight.
- [ ] A planned remote operating location is labeled UTC rather than silently using the CF-20 timezone as the target timezone.
- [ ] Provider unavailable, stale, and refresh behavior remain truthful.
- [ ] Offline startup does not fabricate current forecast evidence.

### Connected network identity

- [ ] Connected Wi-Fi shows the actual SSID with original case when Windows safely supplies it.
- [ ] Connected Wi-Fi with an unavailable/denied name shows `Wi-Fi connected (name unavailable)`.
- [ ] Ethernet shows `Ethernet connected` and never displays a Wi-Fi name.
- [ ] Disconnected state shows `Disconnected`.
- [ ] Missing Agent telemetry shows `Network telemetry unavailable`.
- [ ] Diagnostics retain adapter/interface type needed for troubleshooting.
- [ ] The normal header exposes neither BSSID nor MAC address.
- [ ] SSID lookup failure does not degrade unrelated Agent telemetry.

### Maidenhead workspace

- [ ] Current operating coordinates produce correct 4-, 6-, and 8-character locators.
- [ ] Manual valid coordinates at `0, 0`, near the antimeridian, and near the poles remain usable.
- [ ] Valid 4-, 6-, and 8-character locators decode to representative center coordinates.
- [ ] Invalid letters, digits, and lengths are rejected rather than approximated.
- [ ] Copy controls work for every generated locator and center coordinates.
- [ ] Distance and initial bearing use the current operating location and the decoded cell center.
- [ ] Same-point bearing displays as unavailable/non-meaningful.
- [ ] The center-point and precision caveats remain visible.
- [ ] All calculations continue to work with network connectivity disabled.

## 6. V2.9.1 regression checks

- [ ] GNSS position and GNSS-time evidence retain independent truthful states.
- [ ] Battery and system telemetry remain available or honestly unavailable.
- [ ] App Catalog state, discovery, favorites, capability metadata, and authorized launch behavior are unchanged.
- [ ] Manual QSO logging, edit/review, persistence, and ADIF export preserve QSO counts.
- [ ] WSJT-X state and QSO ingestion coexist with FieldOps and any separately supported local subscriber.
- [ ] Weather, propagation, observed activity, and station evidence retain source/age/unavailable semantics.
- [ ] Activation PLAN → PREPARE → OPERATE → REVIEW behavior and read-only completion remain intact.
- [ ] Dashboard, Agent, and Tray recover after application restart and Windows reboot.
- [ ] The core workspace remains usable offline in CF-20 landscape orientation with touch input.
- [ ] No CAT, PTT, tuning, transmit, spotting, submission, cloud-account, or remote-administration behavior was introduced.

## 7. Field observation log

| UTC time | Scenario | Result | Evidence/notes | Follow-up |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |

Record reproducible defects with candidate revision, local time and timezone, connectivity state, operating-location provenance, Agent/Tray status, exact inputs, expected behavior, actual behavior, and recovery outcome. External radio or application defects remain external unless FieldOps behavior is implicated.

## 8. Candidate decision

- [ ] **GO** — all required Windows/native, upgrade, candidate-capability, and V2.9.1 regression gates pass.
- [ ] **GO WITH EXPLICITLY DEFERRED OBSERVATION** — only a non-safety, non-data, non-build observation remains; owner and follow-up are recorded below.
- [ ] **NO-GO** — a compile, package, update/rollback, persistence, truthful-state, or primary workflow gate failed.

Decision: `____________________`  Date/time UTC: `____________________`

Candidate revision: `________________________________________`

Operator/reviewer: `____________________`

Deferred observation or no-go reason: `____________________________________________________________`

This decision authorizes only the bounded field-test candidate when explicitly approved. It does not close V3.0, authorize a tag or GitHub release, or approve the remaining V3.0 slices.
