import type { Coordinates } from '../location/coordinates';
import type { PropagationMode } from './domain';
import type { RegionalPathSample } from './regionalDestinations';

export const P533_BAND_FREQUENCIES = {
  '160m': { modelFrequencyMHz: 2.0, note: 'P.533 lower-bound representation; nominal 160m center is below the model lower bound.' },
  '80m': { modelFrequencyMHz: 3.5, note: 'Representative amateur-band modeling frequency.' },
  '40m': { modelFrequencyMHz: 7.1, note: 'Representative amateur-band modeling frequency.' },
  '30m': { modelFrequencyMHz: 10.1, note: 'Representative amateur-band modeling frequency.' },
  '20m': { modelFrequencyMHz: 14.1, note: 'Representative amateur-band modeling frequency.' },
  '17m': { modelFrequencyMHz: 18.1, note: 'Representative amateur-band modeling frequency.' },
  '15m': { modelFrequencyMHz: 21.1, note: 'Representative amateur-band modeling frequency.' },
  '12m': { modelFrequencyMHz: 24.9, note: 'Representative amateur-band modeling frequency.' },
  '10m': { modelFrequencyMHz: 28.1, note: 'Representative amateur-band modeling frequency.' },
} as const;

export type P533SupportedBand = keyof typeof P533_BAND_FREQUENCIES;
export type P533ManMadeNoise = 'QUIET' | 'RURAL' | 'RESIDENTIAL' | 'BUSINESS' | 'CITY' | 'INDUSTRIAL';
export type P533Antenna = { readonly model: 'ISOTROPIC'; readonly gainOffsetDb: number };

export interface P533CircuitRequest {
  readonly origin: Coordinates;
  readonly destination: Coordinates;
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly utcHour: number;
  readonly ssn: number;
  readonly band: P533SupportedBand;
  readonly frequencyMHz: number;
  readonly mode: PropagationMode;
  readonly transmitPowerWatts: number;
  readonly requiredSnrDb: number;
  readonly bandwidthHz: number;
  readonly requiredReliabilityPercent: number;
  readonly antenna: P533Antenna;
  readonly noiseEnvironment: P533ManMadeNoise;
}

export interface P533ReportFrequency {
  readonly frequencyMHz: number;
  readonly basicMufMHz: number | null;
  readonly receivedPowerDb: number | null;
  readonly snrDb: number | null;
  readonly basicCircuitReliabilityPercent: number | null;
}

export interface P533ParsedReport {
  readonly frequencies: readonly P533ReportFrequency[];
  readonly modelEngineVersion: string | null;
  readonly noiseModelVersion: string | null;
}

export interface P533AssetProvenance {
  readonly modelName: string;
  readonly recommendation: string;
  readonly modelVersion: string;
  readonly dataVersion: string;
  readonly wasmReleaseId: number;
  readonly dataReleaseId: number;
  readonly wasmSourceRevision: string;
  readonly runtimeNetworkRequired: false;
}

export interface P533CircuitResult {
  readonly sourceState: 'modeled';
  readonly model: 'ITU-R P.533';
  readonly modelVersion: 'P.533-14';
  readonly engine: 'ITU-R-HF v14.3';
  readonly request: P533CircuitRequest;
  readonly modeledPeriod: { readonly year: number; readonly month: number; readonly day: number; readonly utcHour: number };
  readonly frequency: P533ReportFrequency;
  readonly elapsedMs: number;
  readonly reportBytes: number;
  readonly assetProvenance: P533AssetProvenance;
}

export type P533ErrorCode =
  | 'invalid_request'
  | 'unsupported_band'
  | 'assets_unavailable'
  | 'engine_initialization_failed'
  | 'execution_failed'
  | 'report_missing'
  | 'report_parse_failed';

export interface P533CircuitFailure {
  readonly ok: false;
  readonly error: { readonly code: P533ErrorCode; readonly message: string };
}

export interface P533CircuitSuccess {
  readonly ok: true;
  readonly result: P533CircuitResult;
}

export type P533CircuitExecution = P533CircuitSuccess | P533CircuitFailure;

export class P533RequestValidationError extends Error {
  readonly code = 'invalid_request' as const;
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`P.533 request is invalid: ${issues.join('; ')}`);
    this.name = 'P533RequestValidationError';
    this.issues = issues;
  }
}

export function validateP533CircuitRequest(input: unknown): readonly string[] {
  if (!isRecord(input)) return ['request must be an object'];
  const issues: string[] = [];
  validateCoordinates(input.origin, 'origin', issues);
  validateCoordinates(input.destination, 'destination', issues);
  if (!isIntegerInRange(input.year, 1900, 2100)) issues.push('year must be an integer from 1900 through 2100');
  if (!isIntegerInRange(input.month, 1, 12)) issues.push('month must be an integer from 1 through 12');
  if (!isIntegerInRange(input.day, 1, daysInMonth(input.year, input.month))) issues.push('day is invalid for the requested model month');
  if (!isIntegerInRange(input.utcHour, 0, 23)) issues.push('utcHour must be an integer from 0 through 23');
  if (!isFiniteInRange(input.ssn, 0, 400)) issues.push('ssn must be finite and from 0 through 400');
  if (!isP533Band(input.band)) issues.push('band is not supported by P.533');
  if (!isFiniteInRange(input.frequencyMHz, 1.8, 60)) issues.push('frequencyMHz must be finite and within the P.533 input range');
  if (isP533Band(input.band) && typeof input.frequencyMHz === 'number' && Math.abs(input.frequencyMHz - P533_BAND_FREQUENCIES[input.band].modelFrequencyMHz) > 0.0005) {
    issues.push(`frequencyMHz must equal the canonical ${input.band} modeling frequency`);
  }
  if (typeof input.mode !== 'string') issues.push('mode is required for station-profile compatibility');
  if (!isFiniteInRange(input.transmitPowerWatts, 0.001, 1_000_000)) issues.push('transmitPowerWatts must be finite and positive');
  if (!isFiniteInRange(input.requiredSnrDb, -100, 100)) issues.push('requiredSnrDb must be finite and from -100 through 100');
  if (!isFiniteInRange(input.bandwidthHz, 1, 1_000_000)) issues.push('bandwidthHz must be finite and positive');
  if (!isFiniteInRange(input.requiredReliabilityPercent, 0, 100)) issues.push('requiredReliabilityPercent must be from 0 through 100');
  if (!isRecord(input.antenna) || input.antenna.model !== 'ISOTROPIC' || !isFiniteInRange(input.antenna.gainOffsetDb, -100, 100)) issues.push('antenna must be an isotropic reference with a finite gain offset');
  if (!isP533Noise(input.noiseEnvironment)) issues.push('noiseEnvironment is not a supported P.372 man-made noise enum');
  return issues;
}

export function createP533CircuitRequest(input: Omit<P533CircuitRequest, 'frequencyMHz'> & { readonly frequencyMHz?: number }): P533CircuitRequest {
  const frequencyMHz = input.frequencyMHz ?? (isP533Band(input.band) ? P533_BAND_FREQUENCIES[input.band].modelFrequencyMHz : NaN);
  const candidate = { ...input, frequencyMHz };
  const issues = validateP533CircuitRequest(candidate);
  if (issues.length > 0) throw new P533RequestValidationError(issues);
  return candidate as P533CircuitRequest;
}

export function createP533RequestFromRegionalPathSample(
  sample: RegionalPathSample,
  fields: Omit<P533CircuitRequest, 'origin' | 'destination'>,
): P533CircuitRequest {
  return createP533CircuitRequest({ ...fields, origin: sample.originCoordinates, destination: sample.destinationCoordinates });
}

export function createP533Input(request: P533CircuitRequest): string {
  const hour = request.utcHour === 0 ? 24 : request.utcHour;
  const txPowerDbw = 10 * Math.log10(request.transmitPowerWatts);
  const coordinate = (value: number) => value.toFixed(4);
  return `PathName "FieldOps P533"\nPathTXName "FieldOps Origin"\nPath.L_tx.lat ${coordinate(request.origin.lat)}\nPath.L_tx.lng ${coordinate(request.origin.lon)}\nTXAntFilePath "${request.antenna.model}"\nTXGOS ${request.antenna.gainOffsetDb.toFixed(1)}\nPathRXName "FieldOps Destination"\nPath.L_rx.lat ${coordinate(request.destination.lat)}\nPath.L_rx.lng ${coordinate(request.destination.lon)}\nRXAntFilePath "${request.antenna.model}"\nRXGOS ${request.antenna.gainOffsetDb.toFixed(1)}\nAntennaOrientation "TX2RX"\nPath.year ${request.year}\nPath.month ${request.month}\nPath.hour ${hour}\nPath.SSN ${request.ssn}\nPath.frequency ${request.frequencyMHz.toFixed(3)}\nPath.txpower ${txPowerDbw.toFixed(1)}\nPath.BW ${request.bandwidthHz}\nPath.SNRr ${request.requiredSnrDb}\nPath.SNRXXp ${request.requiredReliabilityPercent}\nPath.ManMadeNoise "${request.noiseEnvironment}"\nPath.Modulation ANALOG\nPath.SorL SHORTPATH\nLL.lat ${coordinate(request.destination.lat)}\nLL.lng ${coordinate(request.destination.lon)}\nLR.lat ${coordinate(request.destination.lat)}\nLR.lng ${coordinate(request.destination.lon)}\nUL.lat ${coordinate(request.destination.lat)}\nUL.lng ${coordinate(request.destination.lon)}\nUR.lat ${coordinate(request.destination.lat)}\nUR.lng ${coordinate(request.destination.lon)}\nDataFilePath "/data/"\nRptFilePath "/tmp/"\nRptFileFormat "RPT_BMUF | RPT_PR | RPT_SNR | RPT_BCR"\n`;
}

export function parseP533Report(report: string): P533ParsedReport | null {
  if (!report.trim()) return null;
  const columns: Record<string, number> = {};
  const modelMatch = report.match(/HF Model \(P533\)\s+Ver\s+([^\r\n]+)/);
  const noiseMatch = report.match(/Noise Model \(P372\)\s+Ver\s+([^\r\n]+)/);
  for (const line of report.split(/\r?\n/)) {
    const match = line.match(/^Column\s+(\d+):\s+([A-Za-z]+)/);
    if (match) columns[match[2]] = Number(match[1]) - 1;
  }
  if (columns.Frequency === undefined || columns.BMUF === undefined || columns.Pr === undefined || columns.SNR === undefined || columns.BCR === undefined) return null;
  const frequencies: P533ReportFrequency[] = [];
  let inCalculatedParameters = false;
  for (const rawLine of report.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.includes('Calculated Parameters') && !line.includes('End')) { inCalculatedParameters = true; continue; }
    if (line.includes('End Calculated Parameters')) { inCalculatedParameters = false; continue; }
    if (!inCalculatedParameters || !line || line.startsWith('*') || line.startsWith('-')) continue;
    const fields = line.split(',').map(value => Number.parseFloat(value.trim()));
    const frequencyMHz = fields[columns.Frequency];
    if (!Number.isFinite(frequencyMHz) || frequencyMHz <= 0) continue;
    frequencies.push({
      frequencyMHz,
      basicMufMHz: finiteOrNull(fields[columns.BMUF]),
      receivedPowerDb: finiteOrNull(fields[columns.Pr]),
      snrDb: finiteOrNull(fields[columns.SNR]),
      basicCircuitReliabilityPercent: finiteOrNull(fields[columns.BCR]),
    });
  }
  return frequencies.length > 0 ? { frequencies, modelEngineVersion: modelMatch?.[1].trim() ?? null, noiseModelVersion: noiseMatch?.[1].trim() ?? null } : null;
}

function validateCoordinates(value: unknown, label: string, issues: string[]): void {
  if (!isRecord(value) || !isFiniteInRange(value.lat, -90, 90) || !isFiniteInRange(value.lon, -180, 180)) issues.push(`${label} coordinates are invalid`);
}

function isP533Band(value: unknown): value is P533SupportedBand {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(P533_BAND_FREQUENCIES, value);
}

function isP533Noise(value: unknown): value is P533ManMadeNoise {
  return ['QUIET', 'RURAL', 'RESIDENTIAL', 'BUSINESS', 'CITY', 'INDUSTRIAL'].includes(value as string);
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function daysInMonth(year: unknown, month: unknown): number {
  return isIntegerInRange(year, 1900, 2100) && isIntegerInRange(month, 1, 12) ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}