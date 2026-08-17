import type { Coordinates } from '../location/coordinates';
import type { OperatingLocation } from '../location/operatingLocation';
import type { TelemetrySource, TelemetryTimestamps } from '../telemetry';

export const HF_BANDS = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'] as const;
export type HfBand = (typeof HF_BANDS)[number];

export const PROPAGATION_MODES = ['SSB', 'CW', 'FT8', 'FT4', 'JS8', 'RTTY'] as const;
export type PropagationMode = (typeof PROPAGATION_MODES)[number];

export const PROPAGATION_SOURCE_STATES = ['live', 'cached', 'stale', 'unavailable', 'modeled'] as const;
export type PropagationSourceState = (typeof PROPAGATION_SOURCE_STATES)[number];
export const PROPAGATION_OPERATING_MODES = ['online_live_enhanced', 'online_partial', 'offline_modeled', 'offline_cached_modeled'] as const;
export type PropagationOperatingMode = (typeof PROPAGATION_OPERATING_MODES)[number];
export const PROPAGATION_RATINGS = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'UNAVAILABLE'] as const;
export type PropagationRating = (typeof PROPAGATION_RATINGS)[number];
export const PROPAGATION_CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'modeled_only', 'unavailable'] as const;
export type PropagationConfidence = (typeof PROPAGATION_CONFIDENCE_LEVELS)[number];

export interface PropagationSourceReference {
  readonly state: PropagationSourceState;
  readonly source: TelemetrySource;
  readonly timestamps: TelemetryTimestamps;
}

export interface AntennaProfile {
  readonly type: 'EFHW' | 'EFRW' | 'dipole' | 'vertical' | 'loaded_vertical' | 'portable_whip' | 'beam' | 'unknown_random_wire' | 'custom';
  readonly name?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DeploymentProfile {
  readonly geometry: 'inverted_v' | 'sloper' | 'vertical' | 'low_horizontal' | 'elevated_horizontal' | 'other';
  readonly heightCategory?: 'ground_level' | 'low' | 'elevated' | 'unknown';
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface StationProfile {
  readonly mode: PropagationMode;
  readonly transmitPowerWatts: number;
  readonly antenna: AntennaProfile;
  readonly deployment: DeploymentProfile;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RegionalDestination {
  readonly kind: 'regional';
  readonly regionId: string;
  readonly representativeSamplePoints: readonly Coordinates[];
}

export interface SpecificDestination {
  readonly kind: 'specific';
  readonly coordinates: Coordinates;
  readonly name?: string;
  readonly resolver?: 'coordinates' | 'maidenhead' | 'sota' | 'pota' | 'saved_location';
}

export type PropagationDestination = RegionalDestination | SpecificDestination;

export interface PropagationRequest {
  readonly operatingLocation: OperatingLocation;
  readonly dateTimeUtc: string;
  readonly stationProfile: StationProfile;
  readonly destination: PropagationDestination;
}

export interface ModelBandResult {
  readonly status: 'available' | 'unavailable';
  readonly modelName: string;
  readonly calculationTimeUtc: string;
  readonly circuit?: Readonly<Record<string, unknown>>;
}

export interface ModelEvidence {
  readonly kind: 'model';
  readonly model: string;
  readonly circuit?: Readonly<Record<string, unknown>>;
  readonly provenance: PropagationSourceReference & { readonly state: 'modeled' };
}

export interface SpaceWeatherEvidence {
  readonly kind: 'current_environment';
  readonly summary: Readonly<Record<string, unknown>>;
  readonly provenance: PropagationSourceReference;
}

export interface ObservedRfEvidence {
  readonly kind: 'observed_rf';
  readonly observationWindow: { readonly startsAt: string; readonly endsAt: string };
  readonly band: HfBand;
  readonly mode: PropagationMode;
  readonly reportCount: number;
  readonly uniqueStationCount: number;
  readonly uniqueReporterCount: number;
  readonly regionalPathRelevance?: string;
  readonly provenance: PropagationSourceReference;
}

export interface IonosphereEvidence {
  readonly kind: 'live_ionosphere';
  readonly station?: string;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly provenance: PropagationSourceReference;
}

export interface PropagationEvidence {
  readonly model: ModelEvidence;
  readonly currentEnvironment?: SpaceWeatherEvidence;
  readonly observedRf?: ObservedRfEvidence;
  readonly liveIonosphere?: IonosphereEvidence;
}

export interface PropagationExplanation {
  readonly text: string;
  readonly sourceStates?: readonly PropagationSourceState[];
  readonly sourceIds?: readonly string[];
}

export interface PropagationBandAssessment {
  readonly band: HfBand;
  readonly rating: PropagationRating;
  readonly confidence: PropagationConfidence;
  readonly modelResult: ModelBandResult;
  readonly currentConditionResult?: SpaceWeatherEvidence;
  readonly observedRfResult?: ObservedRfEvidence;
  readonly ionosphereResult?: IonosphereEvidence;
  readonly reasons: readonly PropagationExplanation[];
  readonly cautions: readonly PropagationExplanation[];
  readonly provenance: readonly PropagationSourceReference[];
}

export function isHfBand(value: unknown): value is HfBand {
  return typeof value === 'string' && (HF_BANDS as readonly string[]).includes(value);
}

export function isPropagationMode(value: unknown): value is PropagationMode {
  return typeof value === 'string' && (PROPAGATION_MODES as readonly string[]).includes(value);
}

export function isPropagationSourceState(value: unknown): value is PropagationSourceState {
  return typeof value === 'string' && (PROPAGATION_SOURCE_STATES as readonly string[]).includes(value);
}

export function isPropagationOperatingMode(value: unknown): value is PropagationOperatingMode {
  return typeof value === 'string' && (PROPAGATION_OPERATING_MODES as readonly string[]).includes(value);
}

export function isValidCoordinates(value: unknown): value is Coordinates {
  if (!isRecord(value)) return false;
  return typeof value.lat === 'number' && Number.isFinite(value.lat) && value.lat >= -90 && value.lat <= 90
    && typeof value.lon === 'number' && Number.isFinite(value.lon) && value.lon >= -180 && value.lon <= 180;
}

export function isRegionalDestination(value: unknown): value is RegionalDestination {
  return isRecord(value)
    && value.kind === 'regional'
    && typeof value.regionId === 'string'
    && value.regionId.trim().length > 0
    && Array.isArray(value.representativeSamplePoints)
    && value.representativeSamplePoints.length > 0
    && value.representativeSamplePoints.every(isValidCoordinates);
}

export function isSpecificDestination(value: unknown): value is SpecificDestination {
  return isRecord(value) && value.kind === 'specific' && isValidCoordinates(value.coordinates);
}

export function isValidStationProfile(value: unknown): value is StationProfile {
  return isRecord(value)
    && isPropagationMode(value.mode)
    && typeof value.transmitPowerWatts === 'number'
    && Number.isFinite(value.transmitPowerWatts)
    && value.transmitPowerWatts > 0
    && isRecord(value.antenna)
    && typeof value.antenna.type === 'string'
    && isRecord(value.deployment)
    && typeof value.deployment.geometry === 'string';
}

export function validatePropagationRequest(request: PropagationRequest): readonly string[] {
  const errors: string[] = [];
  if (!request.operatingLocation.coordinates || request.operatingLocation.provenance === 'unavailable') {
    errors.push('Operating location is unavailable.');
  }
  if (!Number.isFinite(new Date(request.dateTimeUtc).getTime())) errors.push('Propagation date/time is invalid.');
  if (!isValidStationProfile(request.stationProfile)) errors.push('Station profile is invalid.');
  if (!isRegionalDestination(request.destination) && !isSpecificDestination(request.destination)) {
    errors.push('Destination is invalid.');
  }
  return errors;
}

export function isValidObservedRfEvidence(value: unknown): value is ObservedRfEvidence {
  return isRecord(value)
    && value.kind === 'observed_rf'
    && isHfBand(value.band)
    && isPropagationMode(value.mode)
    && nonNegativeInteger(value.reportCount)
    && nonNegativeInteger(value.uniqueStationCount)
    && nonNegativeInteger(value.uniqueReporterCount)
    && isRecord(value.observationWindow)
    && typeof value.observationWindow.startsAt === 'string'
    && typeof value.observationWindow.endsAt === 'string';
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}