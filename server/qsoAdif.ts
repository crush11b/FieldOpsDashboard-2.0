import { createActivationAdifExport } from '../src/utils/adif';
import { createQso, type CreateQsoInput, type Qso } from './qso';

export interface AdifParseResult { readonly recordsFound: number; readonly records: readonly CreateQsoInput[]; readonly errors: readonly string[]; }
export interface AdifActivationContext { readonly type: 'POTA' | 'SOTA' | 'General'; readonly reference?: string; readonly stationCallsign?: string; readonly operatorCallsign?: string; readonly myGridSquare?: string; }
export function parseAdif(input: string): AdifParseResult {
  const records: CreateQsoInput[] = []; const errors: string[] = [];
  if (typeof input !== 'string' || input.length > 5_000_000) return { recordsFound: 0, records: [], errors: ['ADIF input is missing or exceeds the 5 MB limit.'] };
  const chunks = input.split(/<EOR\s*(?:\/?>)?/i); let recordsFound = 0;
  for (const chunk of chunks.slice(0, -1)) {
    const fields = parseFields(chunk, errors, recordsFound + 1); if (!Object.keys(fields).length) continue; recordsFound++;
    const date = fields.QSO_DATE; const time = fields.TIME_ON || fields.TIME_OFF; const dateTime = date && time ? toUtc(date, time) : undefined;
    if (!dateTime || !fields.CALL || !fields.MODE || (!fields.BAND && !fields.FREQ)) { errors.push(`Record ${recordsFound} is missing CALL, QSO_DATE/TIME, MODE, or BAND/FREQ.`); continue; }
    records.push({ activationId: '', qsoDateTimeUtc: dateTime, callsign: fields.CALL, band: fields.BAND, frequencyMHz: fields.FREQ ? Number(fields.FREQ) : undefined, mode: fields.MODE, submode: fields.SUBMODE, rstSent: fields.RST_SENT, rstReceived: fields.RST_RCVD, stationCallsign: fields.STATION_CALLSIGN, operatorCallsign: fields.OPERATOR, myGridSquare: fields.MY_GRIDSQUARE, gridSquare: fields.GRIDSQUARE, potaRef: fields.POTA_REF || fields.MY_POTA_REF, sotaRef: fields.SOTA_REF || fields.MY_SOTA_REF, notes: fields.COMMENT, source: 'adif_import' });
  }
  if (chunks.length > 1 && !input.match(/<EOR\s*(?:\/?>)?/i)) errors.push('ADIF contains no end-of-record marker.');
  return { recordsFound, records, errors };
}
export const exportQsos = createActivationAdifExport;
function parseFields(input: string, errors: string[], record: number): Record<string, string> { const fields: Record<string, string> = {}; const pattern = /<([A-Z0-9_]+)\s*:\s*(\d+)(?:\s*:[^>]+)?\s*>([\s\S]*?)/gi; let match: RegExpExecArray | null; while ((match = pattern.exec(input))) { const length = Number(match[2]); const start = pattern.lastIndex; const value = input.slice(start, start + length); if (value.length !== length) errors.push(`Record ${record} contains a truncated ${match[1]} field.`); else fields[match[1].toUpperCase()] = value.trim(); pattern.lastIndex = start + length; } return fields; }
function toUtc(date: string, time: string): string | undefined { if (!/^\d{8}$/.test(date) || !/^\d{4,6}(?:\.\d+)?$/.test(time)) return undefined; const normalized = time.split('.')[0].padEnd(6, '0'); const value = new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${normalized.slice(0,2)}:${normalized.slice(2,4)}:${normalized.slice(4,6)}Z`); return Number.isNaN(value.getTime()) ? undefined : value.toISOString(); }
