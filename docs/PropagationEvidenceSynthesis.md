# Propagation Evidence Synthesis

Slices 5H-A and 5H-B define the evidence-synthesis and explainable rating contracts used by propagation guidance. They are domain and interpretation layers only. They do not add production UI, ionosonde integration, or deployment behavior.

## Evidence channels

The synthesis keeps three evidence channels independent:

- **ITU-R P.533 model evidence**: regional BCR median and spread, SNR range, successful and total samples, model timestamp, revision, engine provenance, and reference antenna assumptions.
- **Observed RF evidence**: PSKReporter report, path, remote-callsign, direction, exact-mode, SNR, and observation-window data. This is digital-only evidence and does not establish SSB usability or the physical propagation mechanism.
- **Space-weather evidence**: NOAA F10.7, SSN, Kp, R-scale, and GOES flare-class products, each retaining source state and timestamps.

An optional ionosphere input is represented as a future contract only. No ionosonde source or integration is implemented in 5H-A.

Raw source values remain available to callers. Interpretation adds categorical states, reason codes, caution codes, source coverage, freshness, and provenance. There is no weighted or opaque composite score.

Source freshness governs whether environmental evidence is interpreted as current. Live Kp and live R-scale in a live snapshot may support current favorable, disturbed, or radio-blackout states. Partial snapshots remain qualified and use only the fresh products that are present. Cached and stale NOAA values are retained as provenance and historical context, but cannot create a current favorable, disturbed, or radio-blackout state. A retained stale or cached R3 may produce a historical-blackout caution, never a current-radio-blackout caution.

## Decision basis and rating boundary

`PropagationDecisionBasis` is the explainable intermediate product. It contains:

- model opportunity state;
- observed-RF activity state;
- environment state and exceptional-condition metadata;
- model/observation agreement;
- selected-mode relevance;
- source coverage and freshness;
- limitations, reasons, and cautions.

The thresholds in `interpretModelEvidence` are explicitly versioned `preliminary_5h_a`. They are deterministic interpretation thresholds, not a redefinition of P.533 BCR. `evaluatePropagationBand` converts the decision basis into the first real product rating under `PROPAGATION_RATING_POLICY_VERSION = regional_guidance_v1`. The final assessment exposes the policy version and ordered `ratingDecisionSteps`; no weighted composite score is used.

Confidence is separate from rating. It describes evidence completeness and agreement, not whether the band is good or bad. A modeled-only result can have a useful model interpretation while still being marked `modeled_only` confidence.

## State semantics

Model opportunity is one of `very_favorable`, `favorable`, `marginal`, `unfavorable`, or `unavailable`. A model can be `unsupported`, such as 6m, while observed RF and NOAA evidence remain usable.

Observed RF distinguishes `strongly_observed`, `observed`, `limited`, `none_observed`, and `unavailable`. Zero current reports is `none_observed`, never `unavailable`. It is evidence of no observed activity in the source window, not proof that the band is closed.

Agreement includes:

- `confirmed` when favorable model and current observed paths agree;
- `observed_opening` when current observed activity exceeds an unfavorable model expectation;
- `model_only` when observed RF is unavailable;
- `weakly_unconfirmed` when a favorable model has no current observation;
- `contradictory` or `consistent` where evidence points in different or matching directions;
- `insufficient` when the channels cannot support a comparison.

The observed opening state is intentionally distinct from model failure. It allows later decision logic to acknowledge direct RF evidence without silently rewriting model provenance.

Environment interpretation preserves R-scale as HF radio-blackout semantics. R3 or greater produces a blackout caution, while sunlit-path applicability remains `unknown`; the synthesis does not infer path illumination from R-scale alone.

## Rating policy v1

The evaluator applies explicit ordered rules:

1. Establish the model baseline from the 5H-A opportunity state: `very_favorable` -> `EXCELLENT`, `favorable` -> `GOOD`, `marginal` -> `FAIR`, and `unfavorable` -> `POOR`.
2. Apply current, recent observed-RF confirmation or observed-opening rules. Strong direct live evidence can promote a favorable baseline one level when the current environment is favorable or quiet and there is no wide-spread or partial-model caution. An observed opening promotes at most one level: direct evidence may promote normally, adjacent evidence is capped at `GOOD`, and indirect evidence is capped at `FAIR`. Stale, cached, limited, and zero-report evidence cannot promote.
3. Apply current environmental qualification. Ordinary disturbed conditions qualify only an unconfirmed modeled `EXCELLENT` to `GOOD` or `GOOD` to `FAIR`; `FAIR` and `POOR` remain unchanged. Live, recent observed support that contributed to a confirmed model, observed opening, or observed-only result prevents this ordinary qualification from erasing the observed evidence. Severe disturbance caps at `FAIR`, or `GOOD` when strong direct live RF is actually present. Current R3+ blackout evidence uses the same cap because sunlit-path applicability is unknown. Historical, cached, stale, partial, and unavailable environment states do not change the rating.
4. Derive final confidence from source freshness, agreement, mode relevance, model completeness, and the resulting evidence path.

The compact policy table is:

| Evidence path | Rating behavior |
| --- | --- |
| Usable P.533 model | Use the model baseline mapping above |
| Favorable model + strong direct live confirmation + favorable/quiet environment | Promote `GOOD` to `EXCELLENT`; otherwise retain baseline |
| Observed opening, direct | One-step promotion |
| Observed opening, adjacent | One-step promotion, maximum `GOOD` |
| Observed opening, indirect | One-step promotion, maximum `FAIR` |
| No model + strong direct observed-only | `GOOD` |
| No model + observed/adjacent/indirect evidence | `FAIR` maximum |
| No model + limited, zero, or unavailable observations | `UNAVAILABLE` |
| `local_nvis` | `UNAVAILABLE`; separate local/NVIS evaluator required |

The evaluator never guarantees a contact, treats FT8 as voice evidence, or converts report counts into a rating.

The `current_conditions_disturbed` caution is independent from the ordinary qualification step. The evaluator emits `environment_disturbed_qualification` only when the rule changes the rating; it never records a no-op downgrade such as `GOOD` -> `GOOD` or `FAIR` -> `FAIR`. Severe disturbance and current R3+ remain explicit caps even when ordinary disturbed qualification is protected by observed evidence.

## Decision trace and confidence

Each final assessment contains `ratingDecisionSteps`. Stable rule IDs include `model_baseline_favorable`, `observed_confirmation`, `observed_opening_direct`, `observed_opening_adjacent`, `observed_opening_indirect_limit`, `observed_only_direct`, `environment_disturbed_qualification`, `environment_severe_cap`, `environment_blackout_cap`, `insufficient_evidence`, and `local_nvis_deferred`. Each step records its action, previous rating, resulting rating, and evidence basis.

`HIGH` requires a usable model, live recent observed RF, confirmed agreement, direct mode relevance, live favorable or quiet environment, and no partial-model or wide-spread caution. Adjacent confirmation is capped at `MEDIUM`; indirect evidence cannot produce `HIGH`. Observed-only guidance is `LOW`. Usable model evidence without usable current external evidence is `MODELED_ONLY`. An unavailable final rating is `UNAVAILABLE` confidence. Absence of the optional ionosphere channel is a limitation, not an automatic v1 confidence penalty.

## Region, mode, and band limitations

`local_nvis` preserves local observed digital activity but adds `local_mechanism_unknown`. It must not be presented as proof of NVIS.

For modes, an exact observed mode is `direct`. The explicit semantic relationship matrix classifies FT4, JS8, and RTTY evidence as adjacent to the FT8-family, while FT8 evidence is indirect for SSB and CW. This prevents FT8 evidence from being presented as direct SSB evidence and keeps `indirect` reachable. The source remains explicitly digital-only; no percentage advantage or mode equivalence is claimed.

For 6m, P.533 can be `unsupported`. The assessment remains valid as an observed-only or unavailable evidence contract and does not fabricate a modeled opportunity state.

The 6m evaluator path is observed-only: strong direct live activity is `GOOD`, modest direct activity is `FAIR`, strong indirect activity is `FAIR` maximum, and zero or unavailable PSK evidence is `UNAVAILABLE`. The `model_unsupported` limitation remains in the decision basis.

`local_nvis` is always `UNAVAILABLE` under `regional_guidance_v1`. Local digital activity is preserved in the observed evidence and provenance, but the result explicitly records that a separate local/NVIS evaluator is required and that activity does not establish NVIS.

## Operating modes and offline behavior

The operating mode is derived from source coverage:

- `online_live_enhanced`: live model, NOAA, and useful current observations;
- `online_partial`: at least one live channel but incomplete enhancement;
- `offline_cached_modeled`: cached or stale source material remains available;
- `offline_modeled`: model guidance remains without live or cached observed/environment enhancement;
- `observed_only`: useful current observations without a usable model;
- `unavailable`: no usable model or observations.

Stale source states are retained rather than silently promoted to live. Freshness and source state remain in the contract so consumers can show the age and limitations of evidence.

Missing or nonfinite model summaries are invalid at the interpretation boundary. In particular, an absent median BCR is not coerced to BCR 0 and cannot manufacture an unfavorable result. Sample counts, successful-count bounds, BCR bounds, and spread validity are checked before model opportunity states are produced. A valid zero BCR remains a genuine unfavorable model result.

## Provenance and test contract

Every assessment carries model revision/provenance, NOAA status, observed source state and observation window, and the selected station profile. Synthetic tests cover favorable and weak model evidence, strong/zero/unavailable observations, stale and cached inputs, partial samples, broad BCR spread, mode relevance, 6m, local digital activity, R-scale conditions, agreement, confidence precursor, reason/caution codes, and operating modes.
