# ADR-012: SmartFrequency Evidence Provider Feasibility

- Status: accepted for evidence-foundation planning
- Date: 2026-09-12
- Scope: V2.9-07 SmartFrequency evidence contracts only

## Decision

SmartFrequency will represent provider feasibility as evidence metadata and will not implement or access a provider in V2.9-07. POTA and SOTA are evaluated separately. Unknown provider facts remain unknown until confirmed from current official documentation and an approved operational review.

The evidence foundation may describe modeled propagation, observed RF, station-specific reception, attributed activity spots, actual QSOs, established digital activity references, and direct occupancy/interference observations. It must not produce recommendations, rankings, scores, a clear-frequency claim, tuning, transmit, spotting, submission, or launch instructions.

## Truth boundaries

- A modeled propagation opportunity does not establish that a frequency is unoccupied.
- Digital reception reports do not establish SSB usability or frequency occupancy.
- A spot is attributed activity or intent, not proof of current occupancy.
- A historical QSO result is station-specific and time-bound.
- Absence of reports never proves a frequency is clear.
- Digital activity references identify established activity patterns, not empty spectrum.
- Direct occupancy observations are observations with source, time, scope, and limitations; they are not recommendations.

## Provider feasibility

Official references reviewed for this decision:

- POTA user documentation: [POTA Help](https://docs.pota.app/), including the user-facing spot surface for operator/activity, park, frequency, and mode information.
- SOTA official terms: [SOTA API documentation and terms](https://sota.org.uk/docs).

| Provider | Verified official facts | Remaining approval/operational unknowns | Disposition |
| --- | --- | --- | --- |
| POTA | Official user documentation confirms the spot surface presents operator/activity, park, frequency, and mode information. | An official supported machine-API contract, authentication policy, rate limits, redistribution permission, attribution format, cache permission, retention, and stability commitment remain unconfirmed. | **blocked/unknown pending an official supported machine-API contract and explicit provider confirmation; no implementation** |
| SOTA | The official terms state the API is private and provided as-is without an SLA; endpoints and schema may change without notice; reasonable-usage limits apply; commercial use requires formal licensing; a designated contact and SOTA Reflector/API-consumers-group membership are required; AI-generated software may not connect without prior SOTA approval. | FieldOps must independently satisfy and approve those requirements before any access; no API access is authorized by this ADR. | **BLOCKED pending explicit SOTA approval and operational authorization; no implementation** |

FieldOps will not implement or access the SOTA API unless the stated approval, authorization, licensing where applicable, designated contact, and community membership requirements are independently satisfied and approved. Neither provider is called by this ADR.

## Consequences

The repository gains a bounded contract for recording feasibility and evidence limitations without coupling SmartFrequency to an undocumented or unauthorized network provider. Provider integration remains a follow-up decision after official documentation, terms, authentication, fields, attribution, rate limits, caching, offline, support, and approval questions are verified.

No provider client, network access, cache, recommendation logic, UI, persistence, or radio-control behavior is introduced by this ADR.
