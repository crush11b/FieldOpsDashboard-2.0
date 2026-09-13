# Version 2.9.1 Release Closure

- Date: **2026-09-13**
- Release branch: `release/2.9.1`
- Baseline: merge commit `2bd90cb00cc261b19ba1def293c73a6f921d5953`
- Product version: **2.9.1**
- Release name: **Deployment Identity and Rollback Safety**
- Status: **Release preparation; publication not authorized**

## Purpose

V2.9.1 is a patch release for the deployment-identity, absolute-startup, and rollback-safety correction merged in PR #75. It preserves the V2.9.0 product scope and does not change native artifact behavior.

## Validation gates

The complete release validation must record exact results for:

- `npm run metadata:check`
- `npm run typecheck`
- `npm run build`
- Four sequential application Vitest shards with `--maxWorkers=1`
- Complete Agent solution with `--no-restore`
- Complete repository PowerShell suite under Windows PowerShell Pester 3.4.0
- `git diff --check`

Validation results:

- `npm run metadata:check`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed, including P533 distribution verification and server bundles.
- Vitest shard 1/4: 64 suites, 364 tests, 364 passed, 0 failed, 0 skipped.
- Vitest shard 2/4: 62 suites, 291 tests, 291 passed, 0 failed, 0 skipped.
- Vitest shard 3/4: 61 suites, 270 tests, 270 passed, 0 failed, 0 skipped.
- Vitest shard 4/4: 60 suites, 331 tests, 331 passed, 0 failed, 0 skipped.
- Vitest total: 247 suites, 1,256 tests, 1,256 passed, 0 failed, 0 skipped.
- `dotnet test agent/FieldOps.Agent.sln --no-restore`: passed; 481 tests passed, 0 failed, 0 skipped across the three test projects.
- Windows PowerShell Pester 3.4.0: 139 tests, 139 passed, 0 failed, 0 skipped, 0 pending, 0 inconclusive. The suite was run with process-scoped `ExecutionPolicy Bypass` because the machine policy blocks test scripts.
- `git diff --check`: passed.

## Publication boundary

This record prepares V2.9.1 for review only. It does not authorize creation of the `v2.9.1` tag, publication of a GitHub release, native artifact upload, deployment, updater execution, reboot, or CF-20 state change. The V2.9.0 tag, release, and native artifacts remain unchanged.