import { parseCoordinates } from '../src/location/coordinates';

export const SOTA_SUMMIT_SOURCE_ID = 'sota-summit-database';
export const SOTA_SUMMIT_SOURCE_TYPE = 'sota_official_summit_csv';
export const SOTA_SUMMIT_SOURCE_NAME = 'Official Summits on the Air summit database';
export const SOTA_SUMMIT_SOURCE_URL = 'https://www.sotadata.org.uk/summitslist.csv';

export interface SummitRecord {
  readonly reference: string;
  readonly name: string;
  readonly association?: string;
  readonly region?: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly elevationM?: number;
}

export interface SotaDatasetMetadata {
  readonly sourceVersion: string | null;
  readonly downloadedAtUtc: string;
  readonly stale: boolean;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
}

export type SotaDatasetState = 'AVAILABLE' | 'STALE' | 'UNAVAILABLE';

export interface SotaCsvValidationIssue {
  readonly row: number;
  readonly field?: string;
  readonly message: string;
}

export type SotaCsvParseResult =
  | { readonly status: 'valid'; readonly records: ReadonlyMap<string, SummitRecord>; readonly sourceVersion: string | null }
  | { readonly status: 'invalid'; readonly issues: readonly SotaCsvValidationIssue[] };

const REQUIRED_HEADERS = [
  'SummitCode', 'AssociationName', 'RegionName', 'SummitName', 'AltM', 'Longitude', 'Latitude',
] as const;

export function normalizeSotaReference(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const reference = input.trim().toUpperCase();
  return reference && !/[\s,]/.test(reference) ? reference : null;
}

export function parseSotaSummitCsv(input: string): SotaCsvParseResult {
  let rows: string[][];
  try {
    rows = parseCsvRows(input);
  } catch (error) {
    return { status: 'invalid', issues: [{ row: 1, message: error instanceof Error ? error.message : 'CSV syntax is invalid.' }] };
  }
  const meaningfulRows = rows.filter(row => row.some(value => value.trim() !== ''));
  if (meaningfulRows.length === 0) return { status: 'invalid', issues: [{ row: 1, message: 'CSV contains no header row.' }] };

  const sourceVersion = parseSourceVersion(meaningfulRows[0]);
  const headerRow = sourceVersion ? meaningfulRows[1] : meaningfulRows[0];
  if (!headerRow) return { status: 'invalid', issues: [{ row: 1, message: 'CSV contains no header row.' }] };
  const headers = headerRow.map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '').trim() : value.trim());
  const headerIndexes = new Map(headers.map((header, index) => [header, index]));
  const issues: SotaCsvValidationIssue[] = [];
  for (const header of REQUIRED_HEADERS) {
    if (!headerIndexes.has(header)) issues.push({ row: 1, field: header, message: `Required header '${header}' is missing.` });
  }
  if (issues.length > 0) return { status: 'invalid', issues };

  const records = new Map<string, SummitRecord>();
  const firstDataRow = sourceVersion ? 2 : 1;
  for (let rowIndex = firstDataRow; rowIndex < meaningfulRows.length; rowIndex += 1) {
    const row = meaningfulRows[rowIndex];
    const rowNumber = rowIndex + 1;
    const value = (header: string) => row[headerIndexes.get(header) ?? -1]?.trim() ?? '';
    const reference = normalizeSotaReference(value('SummitCode'));
    const name = value('SummitName');
    if (!reference) issues.push({ row: rowNumber, field: 'SummitCode', message: 'SummitCode is required and must not contain whitespace.' });
    if (!name) issues.push({ row: rowNumber, field: 'SummitName', message: 'SummitName is required.' });
    const latitude = parseCoordinates(value('Latitude'), value('Longitude'))?.lat;
    const longitude = parseCoordinates(value('Latitude'), value('Longitude'))?.lon;
    if (latitude === undefined || longitude === undefined) {
      if (!value('Latitude') || !Number.isFinite(Number(value('Latitude'))) || Number(value('Latitude')) < -90 || Number(value('Latitude')) > 90) {
        issues.push({ row: rowNumber, field: 'Latitude', message: 'Latitude must be a number between -90 and 90.' });
      }
      if (!value('Longitude') || !Number.isFinite(Number(value('Longitude'))) || Number(value('Longitude')) < -180 || Number(value('Longitude')) > 180) {
        issues.push({ row: rowNumber, field: 'Longitude', message: 'Longitude must be a number between -180 and 180.' });
      }
    }
    const elevation = value('AltM');
    const elevationM = elevation === '' ? undefined : Number(elevation);
    if (elevation !== '' && !Number.isFinite(elevationM)) issues.push({ row: rowNumber, field: 'AltM', message: 'AltM must be numeric when present.' });
    if (reference && records.has(reference)) issues.push({ row: rowNumber, field: 'SummitCode', message: `Duplicate SummitCode '${reference}'.` });
    if (reference && name && latitude !== undefined && longitude !== undefined && (elevation === '' || Number.isFinite(elevationM))) {
      records.set(reference, {
        reference, name,
        ...(value('AssociationName') ? { association: value('AssociationName') } : {}),
        ...(value('RegionName') ? { region: value('RegionName') } : {}),
        latitude, longitude,
        ...(elevationM !== undefined ? { elevationM } : {}),
      });
    }
  }
  return issues.length > 0 ? { status: 'invalid', issues } : { status: 'valid', records, sourceVersion };
}

export class LocalSotaSummitDataset {
  readonly state: SotaDatasetState;

  constructor(
    private readonly recordsMap: ReadonlyMap<string, SummitRecord> | null,
    private readonly datasetMetadata: SotaDatasetMetadata | null,
  ) {
    this.state = recordsMap === null || datasetMetadata === null ? 'UNAVAILABLE' : datasetMetadata.stale ? 'STALE' : 'AVAILABLE';
  }

  static unavailable(): LocalSotaSummitDataset {
    return new LocalSotaSummitDataset(null, null);
  }

  get metadata(): SotaDatasetMetadata | null {
    return this.datasetMetadata;
  }

  get records(): ReadonlyMap<string, SummitRecord> | null {
    return this.recordsMap;
  }

  get(reference: string): SummitRecord | null {
    return this.recordsMap?.get(normalizeSotaReference(reference) ?? '') ?? null;
  }
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') { field += '"'; index += 1; } else { quoted = false; afterQuote = true; }
      } else field += character;
      continue;
    }
    if (afterQuote) {
      if (character === ' ' || character === '\t') continue;
      if (character === ',') { row.push(field); field = ''; afterQuote = false; continue; }
      if (character === '\r' || character === '\n') { row.push(field); rows.push(row); row = []; field = ''; afterQuote = false; if (character === '\r' && input[index + 1] === '\n') index += 1; continue; }
      throw new Error('Unexpected characters after a quoted CSV field.');
    }
    if (character === '"' && field === '') { quoted = true; continue; }
    if (character === ',') { row.push(field); field = ''; continue; }
    if (character === '\r' || character === '\n') { row.push(field); rows.push(row); row = []; field = ''; if (character === '\r' && input[index + 1] === '\n') index += 1; continue; }
    field += character;
  }
  if (quoted) throw new Error('Unterminated quoted CSV field.');
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function parseSourceVersion(row: readonly string[]): string | null {
  if (row.length !== 1) return null;
  const match = /^SOTA Summits List \(Date=(\d{2}\/\d{2}\/\d{4})\)$/i.exec(row[0].replace(/^\uFEFF/, '').trim());
  return match?.[1] ?? null;
}