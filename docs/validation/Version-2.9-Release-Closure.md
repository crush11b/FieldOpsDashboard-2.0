# Version 2.9.0 Release Closure

- Date: **2026-09-13**
- Release-candidate commit: **the single `chore: prepare v2.9.0 release` commit on `release/2.9.0`**
- Product version: **2.9.0**
- Release name: **Field Product Completion**
- Status: **Release candidate; publication not yet authorized**

## Closure basis

V2.9 development is complete within the approved single-operator field-product boundary. The V2.9-09 automated integration gate and live CF-20 acceptance passed. The V2.9-09 evidence records document the initial running-Dashboard update failure and successful rollback, the wrapper-order root cause, corrective PR #72 merged as `4254be395c2aff3873c921c4dba98f8655409460`, successful update while the Dashboard was running, restart as `RUNNING`, source/native parity, persisted configuration and App Catalog state, and post-reboot runtime verification.

## Product and release metadata

- Product version: `2.9.0`.
- Release name: `Field Product Completion`.
- Historical V2.8.0 validation and release records remain unchanged.
- No feature behavior, native artifact, deployment state, tag, or GitHub release is changed by this closure.

## Validation gates

The release-candidate validation must record the exact results for:

- `npm run metadata:check`
- `npm run typecheck`
- `npm run build`
- Four sequential application Vitest shards with `--maxWorkers=1`
- Complete Agent solution with `--no-restore`
- Repository PowerShell suite using explicitly imported Windows PowerShell Pester 3.4.0
- `git diff --check`

Completed validation totals:

- `npm run metadata:check`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; 1,742 modules transformed.
- Application Vitest shards: 1,251 tests passed across four sequential shards: 350, 303, 265, and 333; shard 4 covered 28 test files across 61 suites.
- Complete Agent solution: 481 passed, 0 failed, 0 skipped.
- Repository PowerShell suite: 134 passed, 0 failed, 0 skipped, 0 pending, under Windows PowerShell Pester 3.4.0.
- `git diff --check`: passed.

## Publication boundary

This record establishes the V2.9.0 release candidate. Publishing V2.9.0 still requires an explicitly authorized release action: review and acceptance of this closure, creation and push of the approved `v2.9.0` tag, GitHub release publication, and any separately authorized artifact/deployment operation. No tag, GitHub release, native artifact upload, updater run, deployment, reboot, or CF-20 state change is authorized by this record.
