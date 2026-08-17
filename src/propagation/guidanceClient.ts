import type { OperatingLocation } from '../location/operatingLocation';
import { PROPAGATION_GUIDANCE_BANDS, PROPAGATION_OPERATING_MODES, PROPAGATION_RATINGS, PROPAGATION_CONFIDENCE_LEVELS } from './domain';
import { PROPAGATION_REGION_IDS, type PropagationRegionId } from './regionalDestinations';
import type { PropagationGuidanceResponse } from '../../server/propagationGuidance';

export class PropagationGuidanceClientError extends Error {}

export async function fetchPropagationGuidance(
  destinationRegion: PropagationRegionId,
  operatingLocation: OperatingLocation,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<PropagationGuidanceResponse> {
  const response = await fetcher('/api/propagation-guidance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destinationRegion, operatingLocation }),
    signal,
  });
  if (!response.ok) throw new PropagationGuidanceClientError(`Guidance request failed (${response.status}).`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PropagationGuidanceClientError('Guidance response was not valid JSON.');
  }
  if (!isValidGuidanceResponse(payload)) throw new PropagationGuidanceClientError('Guidance response was malformed.');
  return payload;
}

function isValidGuidanceResponse(value: unknown): value is PropagationGuidanceResponse {
  if (!isRecord(value) || value.kind !== 'propagation_guidance' || !isString(value.status)
    || !['complete', 'partial', 'unavailable'].includes(value.status)
    || !isString(value.destinationRegion) || !PROPAGATION_REGION_IDS.includes(value.destinationRegion as PropagationRegionId)
    || !Array.isArray(value.assessments) || value.assessments.length !== PROPAGATION_GUIDANCE_BANDS.length) return false;
  const bands = value.assessments.map(item => isRecord(item) && item.band);
  if (new Set(bands).size !== PROPAGATION_GUIDANCE_BANDS.length || !PROPAGATION_GUIDANCE_BANDS.every(band => bands.includes(band))) return false;
  return value.assessments.every(item => isRecord(item)
    && isString(item.band) && PROPAGATION_RATINGS.includes(item.rating as typeof PROPAGATION_RATINGS[number])
    && PROPAGATION_CONFIDENCE_LEVELS.includes(item.confidence as typeof PROPAGATION_CONFIDENCE_LEVELS[number])
    && PROPAGATION_OPERATING_MODES.includes(item.operatingMode as typeof PROPAGATION_OPERATING_MODES[number])
    && Array.isArray(item.reasons) && Array.isArray(item.cautions));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
