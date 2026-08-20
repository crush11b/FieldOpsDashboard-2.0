import type { OperatingLocation } from '../location/operatingLocation';
import type { DashboardConfig } from '../types';
import {
  P533_BAND_FREQUENCIES,
  type P533CircuitExecution,
  type P533CircuitRequest,
  type P533CircuitResult,
  type P533ManMadeNoise,
  type P533SupportedBand,
} from './p533';
import type { PropagationGuidanceBand, StationProfile } from './domain';
import type { PropagationRegionId, RegionalPathSample } from './regionalDestinations';

export const REGIONAL_P533_REFERENCE_PROFILE = {
  antenna: { model: 'ISOTROPIC' as const, gainOffsetDb: 0 },
  bandwidthHz: 3000,
  requiredSnrDb: 15,
  requiredReliabilityPercent: 90,
  noiseEnvironment: 'RESIDENTIAL' as P533ManMadeNoise,
  modulation: 'ANALOG' as const,
  pathDirection: 'SHORTPATH' as const,
} as const;

export interface RegionalP533Request {
  readonly operatingLocation: OperatingLocation;
  readonly regionId: PropagationRegionId;
  readonly stationProfile: StationProfile;
  readonly modelDateTimeUtc: string;
  readonly ssn: number;
  readonly referenceProfile?: typeof REGIONAL_P533_REFERENCE_PROFILE;
}

export interface RegionalP533RequestFromConfig extends Omit<RegionalP533Request, 'stationProfile'> {
  readonly config: Pick<DashboardConfig, 'propagation'>;
}

export interface RegionalP533ModelAssumptions {
  readonly antennaModel: 'ISOTROPIC';
  readonly antennaGainOffsetDb: 0;
  readonly bandwidthHz: 3000;
  readonly requiredSnrDb: 15;
  readonly requiredReliabilityPercent: 90;
  readonly noiseEnvironment: P533ManMadeNoise;
  readonly modulation: 'ANALOG';
  readonly pathDirection: 'SHORTPATH';
  readonly modeInterpretation: 'Station mode is preserved as metadata; P.533 uses the explicit provisional reference modulation and SNR/bandwidth assumptions.';
  readonly antennaInterpretation: 'Selected antenna and deployment are preserved as metadata; no radiation-pattern or dBi adjustment is applied.';
}

export interface RegionalP533SampleResult {
  readonly regionId: Exclude<PropagationRegionId, 'local_nvis'>;
  readonly sampleId: string;
  readonly sampleLabel: string;
  readonly distanceKm: number;
  readonly initialBearingDegrees: number | null;
  readonly compassDirection: string;
  readonly band: P533SupportedBand;
  readonly modelFrequencyMHz: number;
  readonly stationProfile: StationProfile;
  readonly assumptions: RegionalP533ModelAssumptions;
  readonly execution: P533CircuitExecution;
}

export interface RegionalP533NumericSummary {
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly median: number | null;
}

export interface RegionalP533BandSummary {
  readonly sampleCount: number;
  readonly successfulSampleCount: number;
  readonly failedSampleCount: number;
  readonly basicCircuitReliabilityPercent: RegionalP533NumericSummary;
  readonly snrDb: RegionalP533NumericSummary;
  readonly receivedPowerDb: RegionalP533NumericSummary;
  readonly basicMufMHz: RegionalP533NumericSummary;
  readonly sampleFailures: readonly { readonly sampleId: string; readonly sampleLabel: string; readonly error: string }[];
}

export interface RegionalP533BandResult {
  readonly band: P533SupportedBand;
  readonly modelFrequencyMHz: number;
  readonly samples: readonly RegionalP533SampleResult[];
  readonly summary: RegionalP533BandSummary;
}

export interface RegionalP533Provenance {
  readonly sourceState: 'modeled';
  readonly model: 'ITU-R P.533';
  readonly recommendation: 'P.533-14';
  readonly engine: 'ITU-R-HF v14.3';
  readonly assetProvenance: P533CircuitResult['assetProvenance'] | null;
}

export type RegionalP533Status = 'complete' | 'partial' | 'unavailable' | 'not_applicable';

export interface RegionalP533Result {
  readonly status: RegionalP533Status;
  readonly regionId: PropagationRegionId;
  readonly regionLabel: string;
  readonly operatingLocation: OperatingLocation;
  readonly stationProfile: StationProfile;
  readonly assumptions: RegionalP533ModelAssumptions;
  readonly modeledAtUtc: string;
  readonly ssn: number;
  readonly unsupportedBands: readonly ['6m'];
  readonly provenance: RegionalP533Provenance;
  readonly bandResults: readonly RegionalP533BandResult[];
  readonly reason?: string;
  readonly sampleCount: number;
  readonly executionCount: number;
  readonly elapsedMs: number;
}

export function createRegionalP533RequestFromConfig(input: RegionalP533RequestFromConfig): RegionalP533Request {
  return { ...input, stationProfile: input.config.propagation.stationProfile };
}

export function getRegionalP533Assumptions(
  referenceProfile: typeof REGIONAL_P533_REFERENCE_PROFILE = REGIONAL_P533_REFERENCE_PROFILE,
): RegionalP533ModelAssumptions {
  return {
    antennaModel: referenceProfile.antenna.model,
    antennaGainOffsetDb: referenceProfile.antenna.gainOffsetDb,
    bandwidthHz: referenceProfile.bandwidthHz,
    requiredSnrDb: referenceProfile.requiredSnrDb,
    requiredReliabilityPercent: referenceProfile.requiredReliabilityPercent,
    noiseEnvironment: referenceProfile.noiseEnvironment,
    modulation: referenceProfile.modulation,
    pathDirection: referenceProfile.pathDirection,
    modeInterpretation: 'Station mode is preserved as metadata; P.533 uses the explicit provisional reference modulation and SNR/bandwidth assumptions.',
    antennaInterpretation: 'Selected antenna and deployment are preserved as metadata; no radiation-pattern or dBi adjustment is applied.',
  };
}

export function buildRegionalP533CircuitRequest(
  request: RegionalP533Request,
  sample: RegionalPathSample,
  band: P533SupportedBand,
): P533CircuitRequest {
  const date = new Date(request.modelDateTimeUtc);
  const assumptions = request.referenceProfile ?? REGIONAL_P533_REFERENCE_PROFILE;
  return {
    origin: sample.originCoordinates,
    destination: sample.destinationCoordinates,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    utcHour: date.getUTCHours(),
    ssn: request.ssn,
    band,
    frequencyMHz: P533_BAND_FREQUENCIES[band].modelFrequencyMHz,
    mode: request.stationProfile.mode,
    transmitPowerWatts: request.stationProfile.transmitPowerWatts,
    requiredSnrDb: assumptions.requiredSnrDb,
    bandwidthHz: assumptions.bandwidthHz,
    requiredReliabilityPercent: assumptions.requiredReliabilityPercent,
    antenna: assumptions.antenna,
    noiseEnvironment: assumptions.noiseEnvironment,
  };
}

export function summarizeRegionalP533Samples(samples: readonly RegionalP533SampleResult[]): RegionalP533BandSummary {
  const successes = samples.filter(sample => sample.execution.ok);
  const failures = samples.filter((sample): sample is RegionalP533SampleResult & { execution: Extract<P533CircuitExecution, { ok: false }> } => !sample.execution.ok);
  const values = (selector: (result: P533CircuitResult) => number | null): RegionalP533NumericSummary => {
    const numbers = successes.map(sample => selector((sample.execution as Extract<P533CircuitExecution, { ok: true }>).result)).filter((value): value is number => value !== null);
    if (numbers.length === 0) return { minimum: null, maximum: null, median: null };
    numbers.sort((a, b) => a - b);
    const middle = Math.floor(numbers.length / 2);
    return {
      minimum: numbers[0],
      maximum: numbers[numbers.length - 1],
      median: numbers.length % 2 === 0 ? (numbers[middle - 1] + numbers[middle]) / 2 : numbers[middle],
    };
  };
  return {
    sampleCount: samples.length,
    successfulSampleCount: successes.length,
    failedSampleCount: failures.length,
    basicCircuitReliabilityPercent: values(result => result.frequency.basicCircuitReliabilityPercent),
    snrDb: values(result => result.frequency.snrDb),
    receivedPowerDb: values(result => result.frequency.receivedPowerDb),
    basicMufMHz: values(result => result.frequency.basicMufMHz),
    sampleFailures: failures.map(sample => ({ sampleId: sample.sampleId, sampleLabel: sample.sampleLabel, error: sample.execution.error.message })),
  };
}

export function isRegionalP533RequestDateValid(value: string): boolean {
  return Number.isFinite(new Date(value).getTime()) && /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
}

export function isSupportedRegionalP533Band(value: unknown): value is P533SupportedBand {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(P533_BAND_FREQUENCIES, value);
}

export function getRegionalP533UnsupportedBands(): readonly ['6m'] {
  return ['6m'];
}

export function toRegionalP533SampleResult(
  regionId: Exclude<PropagationRegionId, 'local_nvis'>,
  sample: RegionalPathSample,
  band: P533SupportedBand,
  stationProfile: StationProfile,
  assumptions: RegionalP533ModelAssumptions,
  execution: P533CircuitExecution,
): RegionalP533SampleResult {
  return {
    regionId,
    sampleId: sample.sampleId,
    sampleLabel: sample.sampleLabel,
    distanceKm: sample.distanceKm,
    initialBearingDegrees: sample.initialBearingDegrees,
    compassDirection: sample.compassDirection,
    band,
    modelFrequencyMHz: P533_BAND_FREQUENCIES[band].modelFrequencyMHz,
    stationProfile,
    assumptions,
    execution,
  };
}

export type RegionalP533ModeledBand = Exclude<PropagationGuidanceBand, '6m'>;