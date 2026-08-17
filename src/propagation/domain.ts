import type { Coordinates } from '../location/coordinates';
import type { OperatingLocation } from '../location/operatingLocation';
import type { TelemetrySource, TelemetryTimestamps } from '../telemetry';

export const PROPAGATION_GUIDANCE_BANDS = ['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m'] as const;
export type PropagationGuidanceBand = (typeof PROPAGATION_GUIDANCE_BANDS)[number];
export const P533_SUPPORTED_BANDS = ['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'] as const;
export type P533SupportedBand = (typeof P533_SUPPORTED_BANDS)[number];
export type HfBand = PropagationGuidanceBand;

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

export const ANTENNA_TYPES = ['EFHW', 'EFRW', 'dipole', 'vertical', 'loaded_vertical', 'portable_whip', 'beam', 'unknown_random_wire', 'custom'] as const;
export type AntennaType = (typeof ANTENNA_TYPES)[number];
export const DEPLOYMENT_GEOMETRIES = ['inverted_v', 'sloper', 'horizontal', 'vertical', 'directional', 'other'] as const;
export type DeploymentGeometry = (typeof DEPLOYMENT_GEOMETRIES)[number];
export const HEIGHT_CATEGORIES = ['under_15_ft', '15_to_30_ft', 'over_30_ft', 'unknown', 'not_applicable'] as const;
export type HeightCategory = (typeof HEIGHT_CATEGORIES)[number];

export const ANTENNA_DEPLOYMENT_COMPATIBILITY: Readonly<Record<AntennaType, readonly DeploymentGeometry[]>> = {
  EFHW: ['inverted_v', 'sloper', 'vertical', 'horizontal'],
  EFRW: ['inverted_v', 'sloper', 'vertical', 'horizontal'],
  dipole: ['inverted_v', 'horizontal'],
  vertical: ['vertical'],
  loaded_vertical: ['vertical'],
  portable_whip: ['vertical'],
  beam: ['directional'],
  unknown_random_wire: ['sloper', 'inverted_v', 'horizontal', 'vertical', 'other'],
  custom: ['other'],
};

export const WIRE_HEIGHT_DEPLOYMENTS: readonly DeploymentGeometry[] = ['inverted_v', 'sloper', 'horizontal'];

export interface PropagationSourceReference {
  readonly state: PropagationSourceState;
  readonly source: TelemetrySource;
  readonly timestamps: TelemetryTimestamps;
}

export interface AntennaProfile {
  readonly type: AntennaType;
  readonly name?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DeploymentProfile {
  readonly geometry: DeploymentGeometry;
  readonly heightCategory?: HeightCategory;
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
  return typeof value === 'string' && (PROPAGATION_GUIDANCE_BANDS as readonly string[]).includes(value);
}

export function isP533SupportedBand(value: unknown): value is P533SupportedBand {
  return typeof value === 'string' && (P533_SUPPORTED_BANDS as readonly string[]).includes(value);
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

export function isAntennaType(value: unknown): value is AntennaType {
  return typeof value === 'string' && (ANTENNA_TYPES as readonly string[]).includes(value);
}

export function isDeploymentGeometry(value: unknown): value is DeploymentGeometry {
  return typeof value === 'string' && (DEPLOYMENT_GEOMETRIES as readonly string[]).includes(value);
}

export function isHeightCategory(value: unknown): value is HeightCategory {
  return typeof value === 'string' && (HEIGHT_CATEGORIES as readonly string[]).includes(value);
}

export function isDeploymentCompatible(antenna: AntennaType, deployment: DeploymentGeometry): boolean {
  return ANTENNA_DEPLOYMENT_COMPATIBILITY[antenna].includes(deployment);
}

export function isHeightCategoryValidForDeployment(
  deployment: DeploymentGeometry,
  heightCategory: HeightCategory | undefined,
): boolean {
  if (heightCategory === undefined) return true;
  if (WIRE_HEIGHT_DEPLOYMENTS.includes(deployment)) return heightCategory !== 'not_applicable';
  if (deployment === 'other') return heightCategory === 'unknown' || heightCategory === 'not_applicable';
  return heightCategory === 'not_applicable';
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
    && isAntennaType(value.antenna.type)
    && isRecord(value.deployment)
    && isDeploymentGeometry(value.deployment.geometry)
    && isDeploymentCompatible(value.antenna.type, value.deployment.geometry)
    && (value.deployment.heightCategory === undefined || isHeightCategory(value.deployment.heightCategory))
    && isHeightCategoryValidForDeployment(value.deployment.geometry, value.deployment.heightCategory);
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