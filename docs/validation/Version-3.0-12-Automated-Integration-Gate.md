# Version 3.0-12 Automated Integration Gate

- Date: **2026-09-16**
- Validation branch: `integration/3.0-12-release-gate`
- Validated revision: `b61e6fddd6c08e92f27216211638c1daa43fef8f`
- Accepted main baseline entering the gate: `9c556f29186d1d0fd126b456499c17242f4f420d`
- GitHub Actions run: [V3 release gate #4](https://github.com/crush11b/FieldOpsDashboard-2.0/actions/runs/35136230678)
- Status: **Automated gate passed; CF-20 acceptance and release authorization remain open**

## Scope

This record captures the complete supported Windows automated validation gate for V3.0. It does not authorize a merge, ToughBook update, rollback exercise, reboot, tag, source release, or stable publication.

The workflow provisions and verifies the pinned offline P.533 runtime before building or testing. It runs the four Vitest shards sequentially with one worker, the complete Agent solution, and the complete repository PowerShell suite under Windows PowerShell Pester 3.4.0.

## Results

| Gate | Result |
| --- | --- |
| P.533 provision and verification | Passed |
| `npm run metadata:check` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| Vitest shard 1/4 | 32 files; 371 passed; 0 failed |
| Vitest shard 2/4 | 32 files; 332 passed; 0 failed |
| Vitest shard 3/4 | 31 files; 322 passed; 0 failed |
| Vitest shard 4/4 | 31 files; 335 passed; 0 failed |
| Vitest total | 126 files; 1,360 passed; 0 failed |
| `.NET Agent` solution | 483 passed; 0 failed; 0 skipped |
| Windows PowerShell Pester 3.4.0 | 175 passed; 0 failed; 0 skipped; 0 pending; 0 inconclusive |
| `git diff --check` | Passed |

The Agent total comprises 3 WSJT-X multicast-proof tests, 315 Agent tests, and 165 Tray tests.

## Gate corrections

The first supported Windows run exposed one asynchronous UI-test race. The test now waits for the accepted objective state before saving. Subsequent Pester runs exposed hosted-runner assumptions rather than product failures: a temporary local-account name exceeded Windows' limit, a shortcut assertion treated equivalent short and long Windows paths as different, and two diagnostics used live session state. Those tests now use bounded names, identity-focused shortcut assertions, and injected deterministic fixtures.

The final run passed without suppressing, excluding, or silently rerunning a failed test. Later gate steps use `always()` so a failure cannot hide the remaining evidence.

## Native artifact evidence

The immutable native workflow for accepted main revision `9c556f29186d1d0fd126b456499c17242f4f420d` also passed in [Native artifacts run #222](https://github.com/crush11b/FieldOpsDashboard-2.0/actions/runs/35133658510):

- P.533 provisioning and verification passed;
- 483 Agent solution tests passed;
- native publication, packaging, and package validation passed;
- workflow artifact ID: `10462171622`;
- workflow artifact size: `239185704` bytes;
- uploaded workflow-artifact SHA-256: `7af9cc1eddec51d7f2056c4ecb8983763172416260e8d46648e80330226ae282`;
- immutable development release: `native-9c556f29186d1d0fd126b456499c17242f4f420d`.

This artifact belongs to the pre-gate main revision. A final native artifact must be built for the exact approved V3.0 release commit after merge and before CF-20 deployment; it must not be represented as the final V3.0 artifact.

## Remaining release gates

The following remain open and require separate authorization where noted:

- review and merge of the V3.0-12 validation changes;
- exact-revision native artifact for the approved merged candidate;
- migration from the real accepted V2.9.1 installation with backup and hashes;
- running-Dashboard update and listener/readiness verification on the CF-20;
- rollback proof;
- reboot and sign-in survival verification, with the operator warned plainly before reboot;
- final version/documentation reconciliation to `3.0.0`;
- final release-closure record;
- annotated tag and stable release publication only after explicit approval.

