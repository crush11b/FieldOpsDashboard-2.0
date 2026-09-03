import type { MissionWindow, SmartDeployExecutionRequest } from '../src/planning/smartDeployPlanning';
import { isValidCoordinates } from '../src/propagation/domain';
import { P533_BAND_FREQUENCIES, type P533CircuitExecution, type P533CircuitResult, type P533SupportedBand } from '../src/propagation/p533';
import type { PropagationMode, StationProfile } from '../src/propagation/domain';
import { executeRegionalP533, type RegionalP533Executor } from './regionalP533';
import type { RegionalP533Result } from '../src/propagation/regionalP533';
import { executeP533Circuit } from './p533Engine';

export const MISSION_WINDOW_SAMPLE_POSITIONS = ['start', 'midpoint', 'end'] as const;
export const MISSION_WINDOW_REPRESENTATIVE_SAMPLE_LIMITATION = 'P.533 results are representative samples at mission start, midpoint, and end; they do not provide continuous multi-day coverage or a continuous propagation forecast.';
export type MissionWindowSamplePosition = (typeof MISSION_WINDOW_SAMPLE_POSITIONS)[number];
export type MissionWindowPropagationStatus = 'complete' | 'partial' | 'unavailable';

export interface MissionWindowPropagationRequest {
  readonly planningRequest: SmartDeployExecutionRequest;
  readonly ssn: number;
}

export type MissionWindowP533Executor = RegionalP533Executor;
type MissionWindowPropagationSampleTuple = readonly [MissionWindowPropagationSample, MissionWindowPropagationSample, MissionWindowPropagationSample];

export interface MissionWindowPropagationBandSample {
  readonly band: P533SupportedBand;
  readonly modelFrequencyMHz: number;
  readonly execution: P533CircuitExecution;
  readonly regional: RegionalP533Result['bandResults'][number];
}

export interface MissionWindowPropagationSample {
  readonly position: MissionWindowSamplePosition;
  readonly modelDateTimeUtc: string;
  readonly status: MissionWindowPropagationStatus;
  readonly stationProfile: StationProfile;
  readonly modes: readonly PropagationMode[];
  readonly bands: readonly MissionWindowPropagationBandSample[];
  readonly provenance: {
    readonly model: 'ITU-R P.533';
    readonly engine: 'ITU-R-HF v14.3';
    readonly sourceState: 'modeled';
  };
  readonly error?: string;
}

export interface MissionWindowPropagationSummary {
  readonly successfulSampleCount: number;
  readonly failedSampleCount: number;
  readonly strongestBandBySample: readonly {
    readonly position: MissionWindowSamplePosition;
    readonly band: P533SupportedBand | null;
  }[];
  readonly consistentStrongestBand: P533SupportedBand | null;
  readonly limitations: readonly string[];
}

export interface MissionWindowPropagationResult {
  readonly status: MissionWindowPropagationStatus;
  readonly missionWindow: MissionWindow;
  readonly generatedAtUtc: string;
  readonly samples: readonly [MissionWindowPropagationSample, MissionWindowPropagationSample, MissionWindowPropagationSample];
  readonly summary: MissionWindowPropagationSummary;
  readonly error?: string;
}

export async function executeMissionWindowPropagation(
  request: MissionWindowPropagationRequest,
  now: () => Date = () => new Date(),
  executeCircuit: MissionWindowP533Executor = executeP533Circuit,
): Promise<MissionWindowPropagationResult> {
  const generatedAtUtc = now().toISOString();
  const planning = request.planningRequest;
  const sampleTimes = missionSampleTimes(planning.missionWindow);
  const stationProfile = stationProfileFromPlanning(planning);
  const invalidReason = validateMissionPropagationRequest(request, stationProfile);
  if (invalidReason) {
    const samples = unavailableSamples(sampleTimes, stationProfile, planning.equipment.modes, invalidReason);
    return buildResult('unavailable', planning.missionWindow, generatedAtUtc, samples, invalidReason);
  }

  const samples = await Promise.all(sampleTimes.map(sample => executeSample(sample.position, sample.modelDateTimeUtc, planning, stationProfile, request.ssn, executeCircuit)));
  const successfulSampleCount = samples.filter(sample => sample.status !== 'unavailable').length;
  const status: MissionWindowPropagationStatus = successfulSampleCount === 0
    ? 'unavailable'
    : successfulSampleCount === samples.length && samples.every(sample => sample.status === 'complete') ? 'complete' : 'partial';
  return buildResult(status, planning.missionWindow, generatedAtUtc, [samples[0], samples[1], samples[2]], status === 'unavailable' ? 'All mission-window model samples were unavailable.' : undefined);
}

function unavailableSamples(
  sampleTimes: ReturnType<typeof missionSampleTimes>,
  stationProfile: StationProfile | null,
  modes: readonly PropagationMode[],
  error: string,
): MissionWindowPropagationSampleTuple {
  return [
    unavailableSample(sampleTimes[0].position, sampleTimes[0].modelDateTimeUtc, stationProfile, modes, error),
    unavailableSample(sampleTimes[1].position, sampleTimes[1].modelDateTimeUtc, stationProfile, modes, error),
    unavailableSample(sampleTimes[2].position, sampleTimes[2].modelDateTimeUtc, stationProfile, modes, error),
  ];
}

export function missionSampleTimes(window: MissionWindow): readonly [
  { readonly position: 'start'; readonly modelDateTimeUtc: string },
  { readonly position: 'midpoint'; readonly modelDateTimeUtc: string },
  { readonly position: 'end'; readonly modelDateTimeUtc: string },
] {
  const startMs = Date.parse(window.start);
  const endMs = Date.parse(window.end);
  const midpointMs = startMs + Math.floor((endMs - startMs) / 2);
  return [
    { position: 'start', modelDateTimeUtc: new Date(startMs).toISOString() },
    { position: 'midpoint', modelDateTimeUtc: new Date(midpointMs).toISOString() },
    { position: 'end', modelDateTimeUtc: new Date(endMs).toISOString() },
  ];
}

function validateMissionPropagationRequest(request: MissionWindowPropagationRequest, stationProfile: StationProfile | null): string | null {
  const planning = request.planningRequest;
  if (!planning.plannedOperatingLocation.coordinates || planning.plannedOperatingLocation.provenance === 'unavailable' || !isValidCoordinates(planning.plannedOperatingLocation.coordinates)) return 'Planned operating location coordinates are unavailable.';
  const samples = missionSampleTimes(planning.missionWindow);
  if (samples.some(sample => !Number.isFinite(Date.parse(sample.modelDateTimeUtc)))) return 'Mission window timestamps are invalid.';
  if (!stationProfile) return 'Equipment context cannot be represented by the existing P.533 station profile.';
  if (!Number.isFinite(request.ssn) || request.ssn < 0 || request.ssn > 400) return 'P.533 SSN is invalid.';
  return null;
}

function stationProfileFromPlanning(planning: SmartDeployExecutionRequest): StationProfile | null {
  const equipment = planning.equipment;
  const mode = equipment.modes[0];
  if (!mode || !equipment.deployment) return null;
  return {
    mode,
    transmitPowerWatts: equipment.transmitPowerWatts,
    antenna: equipment.antenna,
    deployment: equipment.deployment,
  };
}

async function executeSample(
  position: MissionWindowSamplePosition,
  modelDateTimeUtc: string,
  planning: SmartDeployExecutionRequest,
  stationProfile: StationProfile,
  ssn: number,
  executeCircuit: MissionWindowP533Executor,
): Promise<MissionWindowPropagationSample> {
  const regional = await executeRegionalP533({ operatingLocation: planning.plannedOperatingLocation, regionId: planning.propagationObjective.regionId, stationProfile, modelDateTimeUtc, ssn }, executeCircuit);
  const bands = regional.bandResults.map(regionalBand => ({ band: regionalBand.band, modelFrequencyMHz: regionalBand.modelFrequencyMHz, execution: aggregateRegionalExecution(regionalBand), regional: regionalBand }));
  const successfulBands = bands.filter(item => item.execution.ok);
  const status: MissionWindowPropagationStatus = successfulBands.length === 0 ? 'unavailable' : successfulBands.length === bands.length ? 'complete' : 'partial';
  return {
    position,
    modelDateTimeUtc,
    status,
    stationProfile,
    modes: planning.equipment.modes,
    bands,
    provenance: { model: 'ITU-R P.533', engine: 'ITU-R-HF v14.3', sourceState: 'modeled' },
    ...(successfulBands.length === 0 ? { error: 'No P.533 bands were available for this mission sample.' } : {}),
  };
}

function unavailableSample(position: MissionWindowSamplePosition, modelDateTimeUtc: string, stationProfile: StationProfile | null, modes: readonly PropagationMode[], error: string): MissionWindowPropagationSample {
  return {
    position,
    modelDateTimeUtc,
    status: 'unavailable',
    stationProfile: stationProfile ?? { mode: modes[0] ?? 'SSB', transmitPowerWatts: Number.NaN, antenna: { type: 'custom' }, deployment: { geometry: 'other', heightCategory: 'unknown' } },
    modes,
    bands: [],
    provenance: { model: 'ITU-R P.533', engine: 'ITU-R-HF v14.3', sourceState: 'modeled' },
    error,
  };
}

function buildResult(
  status: MissionWindowPropagationStatus,
  missionWindow: MissionWindow,
  generatedAtUtc: string,
  samples: MissionWindowPropagationResult['samples'],
  error?: string,
): MissionWindowPropagationResult {
  const successful = samples.filter(sample => sample.status !== 'unavailable');
  const strongestBandBySample = samples.map(sample => ({ position: sample.position, band: strongestBand(sample) }));
  const strongestBands = strongestBandBySample.map(item => item.band).filter((band): band is P533SupportedBand => band !== null);
  return {
    status,
    missionWindow,
    generatedAtUtc,
    samples,
    summary: {
      successfulSampleCount: successful.length,
      failedSampleCount: samples.length - successful.length,
      strongestBandBySample,
      consistentStrongestBand: strongestBands.length === samples.length && new Set(strongestBands).size === 1 ? strongestBands[0] : null,
      limitations: [
        MISSION_WINDOW_REPRESENTATIVE_SAMPLE_LIMITATION,
        ...(status === 'partial' ? ['One or more mission samples or bands were unavailable; no continuous trend is inferred.'] : []),
        ...(status === 'unavailable' ? ['No modeled sample was available; no band recommendation is provided.'] : []),
      ],
    },
    ...(error ? { error } : {}),
  };
}

function strongestBand(sample: MissionWindowPropagationSample): P533SupportedBand | null {
  const successful = sample.bands.filter((band): band is MissionWindowPropagationBandSample & { execution: { readonly ok: true; readonly result: P533CircuitResult } } => band.execution.ok && band.execution.result.frequency.basicCircuitReliabilityPercent !== null);
  return successful.sort((left, right) => right.execution.result.frequency.basicCircuitReliabilityPercent! - left.execution.result.frequency.basicCircuitReliabilityPercent!)[0]?.band ?? null;
}

function aggregateRegionalExecution(band: RegionalP533Result['bandResults'][number]): P533CircuitExecution {
  const successful = band.samples.filter(sample => sample.execution.ok);
  if (successful.length === 0) return band.samples[0]?.execution ?? { ok: false, error: { code: 'execution_failed', message: 'No regional path sample was available.' } };
  const first = successful[0].execution;
  if (!first.ok) return first;
  return { ok: true, result: { ...first.result, frequency: { ...first.result.frequency, basicCircuitReliabilityPercent: band.summary.basicCircuitReliabilityPercent.median, snrDb: band.summary.snrDb.median, receivedPowerDb: band.summary.receivedPowerDb.median, basicMufMHz: band.summary.basicMufMHz.median } } };
}