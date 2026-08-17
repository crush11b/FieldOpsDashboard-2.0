# Propagation Evidence Synthesis

Slice 5H-A defines the evidence-synthesis contract used by later propagation decision work. It is a domain contract and interpretation layer only. It does not add production UI, ionosonde integration, deployment behavior, or the final 5H-B rating evaluator.

## Evidence channels

The synthesis keeps three evidence channels independent:

- **ITU-R P.533 model evidence**: regional BCR median and spread, SNR range, successful and total samples, model timestamp, revision, engine provenance, and reference antenna assumptions.
- **Observed RF evidence**: PSKReporter report, path, remote-callsign, direction, exact-mode, SNR, and observation-window data. This is digital-only evidence and does not establish SSB usability or the physical propagation mechanism.
- **Space-weather evidence**: NOAA F10.7, SSN, Kp, R-scale, and GOES flare-class products, each retaining source state and timestamps.

An optional ionosphere input is represented as a future contract only. No ionosonde source or integration is implemented in 5H-A.

Raw source values remain available to callers. Interpretation adds categorical states, reason codes, caution codes, source coverage, freshness, and provenance. There is no weighted or opaque composite score.

## Decision basis and rating boundary

`PropagationDecisionBasis` is the explainable intermediate product. It contains:

- model opportunity state;
- observed-RF activity state;
- environment state and exceptional-condition metadata;
- model/observation agreement;
- selected-mode relevance;
- source coverage and freshness;
- limitations, reasons, and cautions.

The thresholds in `interpretModelEvidence` are explicitly versioned `preliminary_5h_a`. They are deterministic interpretation thresholds, not final product rating thresholds. `createPropagationBandAssessment` returns `rating: null` and `ratingStatus: deferred_to_5h_b` until the final rating architecture is agreed.

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

## Region, mode, and band limitations

`local_nvis` preserves local observed digital activity but adds `local_mechanism_unknown`. It must not be presented as proof of NVIS.

For modes, an exact observed mode is `direct`; other digital activity can be `adjacent` or `indirect`. This prevents FT8 evidence from being presented as direct SSB evidence. The source remains explicitly digital-only.

For 6m, P.533 can be `unsupported`. The assessment remains valid as an observed-only or unavailable evidence contract and does not fabricate a modeled opportunity state.

## Operating modes and offline behavior

The operating mode is derived from source coverage:

- `online_live_enhanced`: live model, NOAA, and useful current observations;
- `online_partial`: at least one live channel but incomplete enhancement;
- `offline_cached_modeled`: cached or stale source material remains available;
- `offline_modeled`: model guidance remains without live or cached observed/environment enhancement;
- `observed_only`: useful current observations without a usable model;
- `unavailable`: no usable model or observations.

Stale source states are retained rather than silently promoted to live. Freshness and source state remain in the contract so consumers can show the age and limitations of evidence.

## Provenance and test contract

Every assessment carries model revision/provenance, NOAA status, observed source state and observation window, and the selected station profile. Synthetic tests cover favorable and weak model evidence, strong/zero/unavailable observations, stale and cached inputs, partial samples, broad BCR spread, mode relevance, 6m, local digital activity, R-scale conditions, agreement, confidence precursor, reason/caution codes, and operating modes.
