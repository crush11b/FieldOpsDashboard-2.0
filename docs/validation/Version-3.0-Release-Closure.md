# Version 3.0.0 Release Closure

- Date: **2026-09-17**
- Release branch: `release/3.0.0-closure`
- Product version: **3.0.0**
- Release name: **Field Operations Assistant**
- Status: **RELEASED — stable publication completed**

## Product boundary

V3.0 completes the Field Operations Assistant for one operator on one locally operated Windows field computer. React remains the touch dashboard, Express remains the browser-facing backend and external-data/configuration owner, the .NET Agent owns Windows hardware/OS telemetry, and the Tray owns interactive-session launching. Agent communication remains authenticated and loopback-only; browser code receives no reusable Agent credential.

V3.0 does not add CAT/PTT/transmit control, automatic tuning or spotting, POTA/SOTA submission, arbitrary installation or shell execution, cloud accounts, remote administration, fleet/multi-user management, or a generalized provider/plugin platform.

## Completed release scope

- unified mission and operating context across PLAN, PREPARE, OPERATE, and REVIEW;
- multi-entity POTA/SOTA Activations and canonical QSO associations;
- manual and WSJT-X active-entity inheritance and association editing;
- duplicate-safe import and one entity-specific ADIF artifact per reference;
- local versioned equipment inventory, reusable loadouts, activation associations, retained snapshots, deletion/restore, and truthful unknown values;
- resource-aware deterministic guidance with evidence provenance and limitations;
- duration-aware propagation presentation without continuous/true-path claims;
- local-time/DST weather correction plus condition and precipitation context;
- Agent-owned nullable Wi-Fi SSID with truthful Ethernet, disconnected, and unavailable states;
- standalone offline Maidenhead conversion;
- semantic visual treatment and accepted CF-20 day/night usability;
- bounded current/model SSN sourcing and freshness semantics;
- controlled Desktop rollback validation and exact source/native/runtime identity checks.

Decision-track dispositions are authoritative in `Version-3.0-Integration-Decision-Closure.md`. SmartFrequency recommendations, Local/NVIS evaluation, true path prediction, APRS/Direwolf/Meshtastic/Winlink/DigiPi/WSPR integrations, external logbook synchronization, contest scoring, award tracking, generalized diagnostic history/export, and equipment-data enrichment remain research candidates or deferred work rather than hidden V3.0 commitments.

## Validation evidence

- The supported Windows automated integration gate passed with four sequential single-worker Vitest shards, the complete Agent solution, Windows PowerShell Pester 3.4.0, metadata, build, P.533, and whitespace gates.
- Subsequent release-candidate PR gates also passed after rollback support and deleted-record presentation were added.
- [`Version-3.0-12-CF20-Field-Acceptance.md`](Version-3.0-12-CF20-Field-Acceptance.md) records running-Dashboard update, source/native parity, runtime hash, controlled rollback, reboot/sign-in survival, Agent/Tray readiness, retained-data checks, multi-entity export, and field-correction acceptance.
- PR #99 Windows release gate run `35182192965` passed for release-head commit `a9cce91947cd2c23a35439da2d9fb3b4988958d0` (GitHub PR merge test commit `148ee261fef6d2acff005c617e656b12ce4254c6`): 1,360 Vitest tests across four sequential single-worker shards, 483 Agent solution tests, and 178 Pester 3.4.0 tests passed with zero failures. Metadata, typecheck, production build, P.533 verification, and whitespace checks also passed. The durable test-report artifact is `v3-release-gate-test-results-148ee261fef6d2acff005c617e656b12ce4254c6`, SHA-256 `70e9e751e2770a0f031e802f1dd51a6b2da3dbbd5cc8784a9b841f802be3edfe`.

## Known evidence limitation

The real CF-20 advanced incrementally from V2.9.1 through V3.0 development. A separate complete all-store pre-V3 backup manifest was not retained before the first V3 write and cannot be recreated retroactively. The repository tests prove the backup/hash/restore contract, and the operator verified real record continuity across updates, rollback, and reboot. This closure records that limitation rather than inventing a missing artifact.

## Final release identity

- Approved merge and release commit: `33345ca48b3ac58017338ae44ba0fcd0918edd8e`.
- Stable source tag and release: [`v3.0.0`](https://github.com/crush11b/FieldOpsDashboard-2.0/releases/tag/v3.0.0).
- Native asset: `fieldops-native-win-x64.zip`, 239,724,804 bytes.
- Native asset SHA-256: `3d88d1fb3f951bbedaf503a0c9aca7a27c905dcd3a6e6eb805f03fa1d3e87444`.
- Final CF-20 source/native revisions: `33345ca48b3ac58017338ae44ba0fcd0918edd8e` / `33345ca48b3ac58017338ae44ba0fcd0918edd8e`.
- Final CF-20 informational version: `3.0.0+33345ca48b3ac58017338ae44ba0fcd0918edd8e`.
- Final CF-20 runtime-bundle SHA-256: `e3615b33ac356fd92425e902b7f9b9f499f741a040cb9115ef3c2df86a10dedc`.

## Publication record

The operator separately authorized merge, exact-revision native publication, CF-20 deployment, reboot validation, tag creation, and stable GitHub publication. The stable release was published only after source/native parity, runtime identity, retained records, Agent startup, Tray startup, and Dashboard readiness were verified on the CF-20.

The release procedure called for an annotated tag. During publication, the operator explicitly approved using the existing lightweight lowercase `v3.0.0` tag at the exact release commit. This is the accepted release deviation; it does not change the commit or artifact identity.
