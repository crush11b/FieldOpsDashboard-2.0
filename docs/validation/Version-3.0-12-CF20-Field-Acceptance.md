# Version 3.0-12 CF-20 Field Acceptance

- Date: **2026-09-17**
- Supported target: one locally operated Panasonic ToughBook CF-20
- Accepted V2.9.1 baseline: `7e67ed7a1820ce5fa11b57b89cf33808fb07aa3c`
- Final pre-release field revision: `9c4dd6571e1b4124d818315fa27a12bb8450946e`
- Status: **PASSED for the implemented V3.0 product; final 3.0.0 identity deployment remains a release gate**

## Data continuity and migration

The CF-20 was advanced incrementally from the accepted V2.9.1 installation through the bounded V3.0 slices. Existing configuration, App Catalog records, Activations, briefs, notes, checklists, QSOs, equipment inventory, and loadouts remained readable and were operator-verified after update and restart. Multi-entity records survived restart, canonical QSO totals remained uninflated, and a two-POTA/one-SOTA operation exported three entity-specific ADIF files as intended.

The accepted V2.9 field record contains configuration hash evidence, and the V3.0 automated suite proves immutable manifest creation, per-file SHA-256 verification, corruption rejection, migration idempotence, and forward-data quarantine. Because the real CF-20 was advanced through incremental development slices, a separate full pre-V3 all-store backup manifest was not captured before the first V3 write. That historical artifact cannot be recreated retroactively. This limitation is explicit; no fabricated hash or backup claim is made. The operator accepted observed continuity of the real retained records as the field evidence for this development cycle.

## Running update and identity

The supported Desktop updater successfully updated the running product to `47fcbc7b7dfb639abe27638accc6d92901ce7663`, reporting:

- source revision matched;
- native revision matched;
- Dashboard running.

The post-reboot `/api/version` response reported:

- source/native revision: `47fcbc7b7dfb639abe27638accc6d92901ce7663`;
- informational version: `2.9.1+47fcbc7b7dfb639abe27638accc6d92901ce7663`;
- runtime bundle SHA-256: `b49f2d02433d8938b177272c77d227bfa3aff7ef1a34d9eea1bed5afff77db0c`.

The final pre-release field correction then updated successfully to `9c4dd6571e1b4124d818315fa27a12bb8450946e` with matched source/native identity and a running Dashboard. The operator accepted deleted equipment/loadouts hidden by default, explicit `Show Deleted` recovery, preserved active records, and intact Activation loadout associations.

## Controlled rollback

The `Validate FieldOps Rollback` Desktop action captured installed revision `47fcbc7b7dfb639abe27638accc6d92901ce7663`, attempted validated parent revision `cfe8bdde9d39a8af4be3a3ef9afcc3e6c0363773`, and deliberately failed before staged deployment copy. The updater then reported:

- previous installation restored;
- Agent restored and running;
- one interactive Tray restored for the operator;
- Dashboard restored and ready;
- source/native identity restored to `47fcbc7b7dfb639abe27638accc6d92901ce7663`.

This proves transactional filesystem and runtime restoration without representing the deliberate failure as a successful deployment.

## Reboot and sign-in

After an explicitly authorized reboot and normal operator sign-in:

- the Tray started automatically and reported running/healthy;
- exactly one Tray instance was observed;
- `FieldOpsAgent` was `Running` with `Automatic` startup;
- the Dashboard backend responded on loopback without using the deployment updater;
- no unwanted browser window was launched automatically;
- source/native parity and runtime-bundle identity passed;
- App Catalog, Activations/QSOs, equipment inventory, and loadouts remained present.

## Field-correction acceptance

The operator also accepted the V3.0 field corrections through the incremental candidate cycle: actual connected Wi-Fi SSID and fallbacks, local-time weather/DST behavior, condition and precipitation context, offline Maidenhead calculation, day/night presentation, mission evidence, loadout association behavior, duration-aware propagation, current/model SSN separation, multi-entity logging, and per-entity ADIF export.

## Remaining release gate

The exact approved `3.0.0` metadata/closure commit must pass the complete Windows gate, produce a matching immutable native artifact, and be deployed once to the CF-20 for final version/source/native/runtime identity verification. Tagging and stable release publication require separate explicit authorization.
