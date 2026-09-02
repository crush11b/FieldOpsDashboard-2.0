import type { LiveBandActivity } from '../server/liveBandActivity';
import { OBSERVED_RF_BANDS } from './propagation/observedRf';

export class LiveBandActivityApiError extends Error {}

export async function fetchLiveBandActivity(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<LiveBandActivity> {
  const response = await fetcher('/api/live-band-activity', { cache: 'no-store', signal });
  if (!response.ok) throw new LiveBandActivityApiError(`Live Band Activity request failed (${response.status}).`);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new LiveBandActivityApiError('Live Band Activity response was not valid JSON.'); }
  if (!isLiveBandActivity(payload)) throw new LiveBandActivityApiError('Live Band Activity response was malformed.');
  return payload;
}

function isLiveBandActivity(value: unknown): value is LiveBandActivity {
  if (!isRecord(value) || !isRecord(value.source) || value.source.id !== 'pskreporter-via-mqtt'
    || value.source.name !== 'PSKReporter reports via mqtt.pskreporter.info'
    || !isStatus(value.status) || !isString(value.observedAtUtc) || !(value.newestObservedAtUtc === null || isString(value.newestObservedAtUtc))
    || !isString(value.collectedAtUtc) || !isRecord(value.observationWindow) || !isString(value.observationWindow.startsAt)
    || !isString(value.observationWindow.endsAt) || value.windowMinutes !== 15
    || !(value.operatingGrid4 === null || isString(value.operatingGrid4))
    || value.limitation !== 'Recent digital reception reports only; not a propagation prediction or guarantee of station success.'
    || !Array.isArray(value.bands) || value.bands.length !== OBSERVED_RF_BANDS.length) return false;
  return value.bands.every((band, index) => isRecord(band) && band.band === OBSERVED_RF_BANDS[index]
    && isNonNegativeInteger(band.reportCount) && (band.newestObservedAtUtc === null || isString(band.newestObservedAtUtc))
    && isNonNegativeInteger(band.inboundCount) && isNonNegativeInteger(band.outboundCount) && isNonNegativeInteger(band.localCount));
}

function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 0; }
function isStatus(value: unknown): value is LiveBandActivity['status'] { return ['connecting', 'live', 'reconnecting', 'cached', 'stale', 'unavailable'].includes(value as string); }
