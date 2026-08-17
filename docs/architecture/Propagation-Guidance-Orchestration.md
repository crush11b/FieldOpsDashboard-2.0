# Propagation Guidance Orchestration

Slice 5I exposes one server-owned production guidance operation:

`POST /api/propagation-guidance`

The request contains a canonical destination region and an operating location with validated coordinates and provenance. The server reads the persisted station profile, obtains one NOAA space-weather snapshot, updates the observed-RF service location, derives regional observed RF, and then evaluates the canonical ten guidance bands through the existing evidence synthesis and rating evaluator.

## Source independence

Current NOAA products remain current-condition evidence. The NOAA smoothed monthly sunspot number is returned separately as `snapshot.modelSsn` and is the only solar value supplied to regional P.533. It has a longer model-input freshness window than current SSN evidence. The service never fabricates a model SSN from a default, clock, or legacy solar endpoint.

Observed RF and NOAA evidence remain independent of the modeled result. A model result may be complete, partial, unavailable, or not applicable while observed evidence still contributes according to the existing rating policy.

## Model execution and cache

Regional P.533 execution remains owned by `server/regionalP533.ts`; the orchestration service does not loop samples or bands. Regional model results are cached and concurrent requests for the same key share one in-flight promise.

The cache key includes:

- Quantized operating coordinates
- Destination region
- Station mode, transmit power, antenna type, deployment geometry, and height category
- UTC evaluation hour
- Model SSN value and observation timestamp

Current NOAA Kp, R-scale, X-ray, F10.7, and current SSN changes do not invalidate a model result. They still affect the current evidence and final rating evaluation.

## Truthful offline behavior

The response preserves source state and errors. A cached NOAA model input can support modeled guidance; a cold offline request without numeric model SSN does not attempt P.533. `local_nvis` returns ten unavailable assessments with `model.cache: not_applicable` because local/NVIS evaluation is deferred to a separate mechanism.

The response status is `complete` only when at least one assessment is available and the model result is complete. It is `partial` when evidence produces assessments but the model is partial or unavailable. It is `unavailable` when no band can be rated.

## Response shape

The response includes:

- `assessments`: exactly the canonical ten bands, including `6m`
- `spaceWeather`: current NOAA products plus separate model SSN provenance
- `model`: model status, cache state, SSN input, provenance, counts, timing, and reason
- `ratingPolicyVersion`: `regional_guidance_v1`
- `sourceErrors`: user-safe source and model errors

Malformed requests return `400`. Internal acquisition or model failures return `503` without exposing raw exceptions.
