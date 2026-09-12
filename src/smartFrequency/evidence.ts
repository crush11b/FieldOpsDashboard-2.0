import { classifyObservedRfBand } from '../propagation/observedRf';
import { PROPAGATION_GUIDANCE_BANDS, PROPAGATION_MODES, type PropagationGuidanceBand, type PropagationMode } from '../propagation/domain';

export const SMART_FREQUENCY_EVIDENCE_FAMILIES = ['modeled-propagation', 'general-observed-rf', 'station-specific-reception', 'attributed-activity-spot', 'actual-qso-result', 'digital-activity-reference', 'frequency-occupancy-observation'] as const;
export type SmartFrequencyEvidenceFamily = typeof SMART_FREQUENCY_EVIDENCE_FAMILIES[number];
export const SMART_FREQUENCY_EVIDENCE_STATES = ['live', 'cached', 'stale', 'unavailable', 'modeled'] as const;
export type SmartFrequencyEvidenceState = typeof SMART_FREQUENCY_EVIDENCE_STATES[number];
export type SmartFrequencySupportStatus = 'supported' | 'partial' | 'unsupported' | 'unknown';
export type SmartFrequencyPermittedUse = 'approved' | 'restricted' | 'not-established' | 'unknown';
export type SmartFrequencyLocationScope = { readonly kind: 'global' } | { readonly kind: 'region'; readonly regionId: string } | { readonly kind: 'maidenhead-grid'; readonly grid4: string };
export type DigitalActivityMode = 'FT8' | 'FT4' | 'JS8' | 'RTTY';

export interface SmartFrequencySourceReference { readonly sourceId: string; readonly sourceName: string; readonly providerName: string; readonly attribution: string; readonly permittedUse: SmartFrequencyPermittedUse; readonly supportStatus: SmartFrequencySupportStatus; }
export interface SmartFrequencyCacheSemantics { readonly cacheAllowed: boolean; readonly cachedAvailable: boolean; readonly offlineAvailable: boolean; readonly freshnessWindowSeconds: number | null; }
export interface SmartFrequencyObservationWindow { readonly startsAtUtc: string; readonly endsAtUtc: string; }
export interface SmartFrequencyFrequencyRange { readonly lowerHz: number; readonly upperHz: number; }

interface SmartFrequencyEvidenceBase {
  readonly evidenceId: string;
  readonly family: SmartFrequencyEvidenceFamily;
  readonly state: SmartFrequencyEvidenceState;
  readonly source: SmartFrequencySourceReference;
  readonly band: PropagationGuidanceBand | null;
  readonly frequencyHz: number | null;
  readonly modeScope: PropagationMode | 'all' | null;
  readonly locationScope: SmartFrequencyLocationScope;
  readonly observedAtUtc: string | null;
  readonly receivedAtUtc: string | null;
  readonly expiresAtUtc: string | null;
  readonly cache: SmartFrequencyCacheSemantics;
  readonly limitations: readonly string[];
  readonly semantics: string;
}
type ConcreteModeEvidenceBase = Omit<SmartFrequencyEvidenceBase, 'band' | 'modeScope'> & { readonly band: PropagationGuidanceBand; readonly modeScope: PropagationMode; };
type ConcreteModeFrequencyEvidenceBase = Omit<ConcreteModeEvidenceBase, 'frequencyHz'> & { readonly frequencyHz: number; };
type GeneralObservedRfEvidenceBase = Omit<SmartFrequencyEvidenceBase, 'band' | 'modeScope'> & { readonly band: PropagationGuidanceBand; readonly modeScope: PropagationMode | 'all'; };
export interface ModeledPropagationEvidence extends ConcreteModeEvidenceBase { readonly family: 'modeled-propagation'; readonly semantics: 'propagation-opportunity-not-occupancy'; readonly modelIdentity: string; readonly modelRevision: string; readonly modelEvaluationAtUtc: string; }
export interface GeneralObservedRfEvidence extends GeneralObservedRfEvidenceBase { readonly family: 'general-observed-rf'; readonly semantics: 'digital-reception-not-ssb-occupancy'; readonly observationWindow: SmartFrequencyObservationWindow; readonly observationCount: number; }
export interface StationSpecificReceptionEvidence extends ConcreteModeEvidenceBase { readonly family: 'station-specific-reception'; readonly semantics: 'station-specific-reception-not-general-occupancy'; readonly stationId: string; readonly observationWindow: SmartFrequencyObservationWindow; readonly reportCount: number; }
export interface AttributedActivitySpotEvidence extends ConcreteModeFrequencyEvidenceBase { readonly family: 'attributed-activity-spot'; readonly semantics: 'activity-or-intent-not-occupancy'; readonly program: 'POTA' | 'SOTA'; readonly spotId: string; readonly activationReference: string; readonly activatorCallsign: string; readonly spotterCallsign?: string; }
export interface ActualQsoResultEvidence extends ConcreteModeEvidenceBase { readonly family: 'actual-qso-result'; readonly semantics: 'historical-station-specific-success'; readonly qsoId: string; readonly localCallsign: string; readonly remoteCallsign: string; }
export interface DigitalActivityReferenceEvidence extends SmartFrequencyEvidenceBase { readonly family: 'digital-activity-reference'; readonly semantics: 'established-digital-activity-reference'; readonly referenceId: string; readonly band: PropagationGuidanceBand; readonly frequencyHz: number; readonly modeScope: DigitalActivityMode; }
export interface FrequencyOccupancyObservationEvidence extends Omit<SmartFrequencyEvidenceBase, 'band' | 'frequencyHz'> { readonly family: 'frequency-occupancy-observation'; readonly band: PropagationGuidanceBand; readonly frequencyHz: number; readonly semantics: 'direct-frequency-occupancy-or-interference-observation'; readonly observationCount: number; readonly observationWindow: SmartFrequencyObservationWindow; readonly observingStationId: string; readonly observationFrequencyRange: SmartFrequencyFrequencyRange; readonly occupiedFrequencyRange: SmartFrequencyFrequencyRange | null; }
export type SmartFrequencyEvidenceRecord = ModeledPropagationEvidence | GeneralObservedRfEvidence | StationSpecificReceptionEvidence | AttributedActivitySpotEvidence | ActualQsoResultEvidence | DigitalActivityReferenceEvidence | FrequencyOccupancyObservationEvidence;
export interface SmartFrequencyValidationResult { readonly valid: boolean; readonly evidence: SmartFrequencyEvidenceRecord | null; readonly issues: readonly string[]; }

export const MAX_FRESHNESS_SECONDS = 31_536_000;
const MAX_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 512;
const MAX_LIMITATIONS = 16;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const CALLSIGN_PATTERN = /^[A-Z0-9][A-Z0-9\-/]{0,31}$/;
const GRID4_PATTERN = /^[A-R]{2}[0-9]{2}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SEMANTICS: Readonly<Record<SmartFrequencyEvidenceFamily, string>> = { 'modeled-propagation': 'propagation-opportunity-not-occupancy', 'general-observed-rf': 'digital-reception-not-ssb-occupancy', 'station-specific-reception': 'station-specific-reception-not-general-occupancy', 'attributed-activity-spot': 'activity-or-intent-not-occupancy', 'actual-qso-result': 'historical-station-specific-success', 'digital-activity-reference': 'established-digital-activity-reference', 'frequency-occupancy-observation': 'direct-frequency-occupancy-or-interference-observation' };
const COMMON_KEYS = ['evidenceId', 'family', 'state', 'source', 'band', 'frequencyHz', 'modeScope', 'locationScope', 'observedAtUtc', 'receivedAtUtc', 'expiresAtUtc', 'cache', 'limitations', 'semantics'];
const SOURCE_KEYS = ['sourceId', 'sourceName', 'providerName', 'attribution', 'permittedUse', 'supportStatus'];
const CACHE_KEYS = ['cacheAllowed', 'cachedAvailable', 'offlineAvailable', 'freshnessWindowSeconds'];
const LOCATION_KEYS: Readonly<Record<string, readonly string[]>> = { global: ['kind'], region: ['kind', 'regionId'], 'maidenhead-grid': ['kind', 'grid4'] };
const FAMILY_KEYS: Readonly<Record<SmartFrequencyEvidenceFamily, readonly string[]>> = { 'modeled-propagation': ['modelIdentity', 'modelRevision', 'modelEvaluationAtUtc'], 'general-observed-rf': ['observationWindow', 'observationCount'], 'station-specific-reception': ['stationId', 'observationWindow', 'reportCount'], 'attributed-activity-spot': ['program', 'spotId', 'activationReference', 'activatorCallsign', 'spotterCallsign'], 'actual-qso-result': ['qsoId', 'localCallsign', 'remoteCallsign'], 'digital-activity-reference': ['referenceId'], 'frequency-occupancy-observation': ['observationCount', 'observationWindow', 'observingStationId', 'observationFrequencyRange', 'occupiedFrequencyRange'] };

export function validateSmartFrequencyEvidence(value: unknown): SmartFrequencyValidationResult {
  const issues: string[] = [];
  if (!isRecord(value)) return invalid(['Evidence must be an object.']);
  const family = value.family;
  if (!isFamily(family)) issues.push('family is unsupported.');
  rejectUnknownKeys(value, isFamily(family) ? [...COMMON_KEYS, ...FAMILY_KEYS[family]] : COMMON_KEYS, 'Evidence', issues);
  if (!isId(value.evidenceId)) issues.push('evidenceId is malformed.');
  if (!isState(value.state)) issues.push('state is unsupported.');
  if (!isRecord(value.source)) issues.push('source is required.'); else validateSource(value.source, issues);
  if (!isNullableBand(value.band)) issues.push('band is unsupported.');
  if (!isNullableFrequency(value.frequencyHz)) issues.push('frequencyHz must be a positive integer in Hz or null.');
  if (!isModeScope(value.modeScope)) issues.push('modeScope is unsupported.');
  if (!isLocationScope(value.locationScope)) issues.push('locationScope is malformed or contains undeclared data.');
  for (const field of ['observedAtUtc', 'receivedAtUtc', 'expiresAtUtc']) if (!isNullableTimestamp(value[field])) issues.push(`${field} must be a UTC timestamp or null.`);
  if (!isRecord(value.cache)) issues.push('cache semantics are required.'); else validateCache(value.cache, issues);
  if (!Array.isArray(value.limitations) || value.limitations.length > MAX_LIMITATIONS || !value.limitations.every(isText)) issues.push('limitations are bounded text.');
  if (isFamily(family)) { if (value.semantics !== SEMANTICS[family]) issues.push('semantics do not match the evidence family.'); validateFamily(family, value, issues); }
  validateStateCoherence(value, family, issues);
  validateTimestampCoherence(value, family, issues);
  validateFrequencyTruth(value, family, issues);
  return issues.length ? invalid(issues) : { valid: true, evidence: value as SmartFrequencyEvidenceRecord, issues: [] };
}
export function isSmartFrequencyEvidence(value: unknown): value is SmartFrequencyEvidenceRecord { return validateSmartFrequencyEvidence(value).valid; }

function validateSource(value: Record<string, unknown>, issues: string[]): void { rejectUnknownKeys(value, SOURCE_KEYS, 'Source', issues); for (const field of ['sourceId', 'sourceName', 'providerName', 'attribution']) if (!isText(value[field])) issues.push(`${field} is required bounded text.`); if (!isPermittedUse(value.permittedUse)) issues.push('permittedUse is unsupported.'); if (!isSupportStatus(value.supportStatus)) issues.push('supportStatus is unsupported.'); }
function validateCache(value: Record<string, unknown>, issues: string[]): void { rejectUnknownKeys(value, CACHE_KEYS, 'Cache', issues); if (typeof value.cacheAllowed !== 'boolean' || typeof value.cachedAvailable !== 'boolean' || typeof value.offlineAvailable !== 'boolean') issues.push('cache booleans are required.'); if (value.freshnessWindowSeconds !== null && (!isPositiveInteger(value.freshnessWindowSeconds) || value.freshnessWindowSeconds > MAX_FRESHNESS_SECONDS)) issues.push('freshnessWindowSeconds must be greater than zero and within the maximum.'); if (value.cachedAvailable === true && value.cacheAllowed !== true) issues.push('cachedAvailable requires cacheAllowed.'); }
function validateStateCoherence(value: Record<string, unknown>, family: unknown, issues: string[]): void { if (value.state === 'modeled' && family !== 'modeled-propagation') issues.push('modeled state is reserved for modeled propagation.'); if (value.state === 'cached' || value.state === 'stale') { if (!isRecord(value.cache) || value.cache.cacheAllowed !== true || value.cache.cachedAvailable !== true) issues.push(`${value.state} evidence requires cacheAllowed and cachedAvailable.`); } }
function validateFamily(family: SmartFrequencyEvidenceFamily, value: Record<string, unknown>, issues: string[]): void {
  for (const key of FAMILY_KEYS[family]) if (key !== 'spotterCallsign' && value[key] === undefined) issues.push(`${key} is required for ${family}.`);
  if (family === 'modeled-propagation') { requireBandAndMode(value, false, issues); for (const key of ['modelIdentity', 'modelRevision']) if (!isText(value[key])) issues.push(`${key} is required bounded text.`); if (!isTimestamp(value.modelEvaluationAtUtc)) issues.push('modelEvaluationAtUtc must be a UTC timestamp.'); }
  if (family === 'general-observed-rf') { if (!isBand(value.band)) issues.push('general observed RF requires a band.'); if (value.modeScope === null || (!isPropagationMode(value.modeScope) && value.modeScope !== 'all')) issues.push('general observed RF requires a non-null mode scope.'); validateObservationWindow(value.observationWindow, issues); validateCount(value.observationCount, 'observation count', issues); }
  if (family === 'station-specific-reception') { requireBandAndMode(value, false, issues); if (!isId(value.stationId)) issues.push('stationId is malformed.'); validateObservationWindow(value.observationWindow, issues); validateCount(value.reportCount, 'report count', issues); }
  if (family === 'attributed-activity-spot') { requireBandAndMode(value, true, issues); if (!isId(value.spotId)) issues.push('spotId is malformed.'); if (!isText(value.activationReference)) issues.push('activationReference is required bounded text.'); for (const key of ['activatorCallsign', 'spotterCallsign']) if (value[key] !== undefined && !isCallsign(value[key])) issues.push(`${key} is malformed.`); if (!isTimestamp(value.observedAtUtc)) issues.push('spots require observedAtUtc.'); }
  if (family === 'actual-qso-result') { requireBandAndMode(value, false, issues); if (!isId(value.qsoId)) issues.push('qsoId is malformed.'); for (const key of ['localCallsign', 'remoteCallsign']) if (!isCallsign(value[key])) issues.push(`${key} is malformed.`); if (!isTimestamp(value.observedAtUtc)) issues.push('QSO results require observedAtUtc.'); }
  if (family === 'digital-activity-reference') { if (!isBand(value.band) || !isPositiveInteger(value.frequencyHz) || !isDigitalMode(value.modeScope)) issues.push('digital references require band, integer frequencyHz, and a concrete digital mode.'); if (!isId(value.referenceId)) issues.push('referenceId is malformed.'); }
  if (family === 'frequency-occupancy-observation') { if (!isBand(value.band) || !isPositiveInteger(value.frequencyHz)) issues.push('occupancy observations require band and frequencyHz.'); if (!isId(value.observingStationId)) issues.push('observingStationId is malformed.'); validateObservationWindow(value.observationWindow, issues); validateCount(value.observationCount, 'observation count', issues); validateRange(value.observationFrequencyRange, 'observationFrequencyRange', issues); if (value.occupiedFrequencyRange !== null && !isRecord(value.occupiedFrequencyRange)) issues.push('occupiedFrequencyRange must be a range or null.'); else if (isRecord(value.occupiedFrequencyRange)) validateRange(value.occupiedFrequencyRange, 'occupiedFrequencyRange', issues); if (value.observationCount === 0 && value.occupiedFrequencyRange !== null) issues.push('zero observations require occupiedFrequencyRange to be null.'); if (isNonNegativeInteger(value.observationCount) && value.observationCount > 0 && !isRecord(value.occupiedFrequencyRange)) issues.push('positive observations require occupiedFrequencyRange.'); }
  if (isRecord(value.observationWindow)) rejectUnknownKeys(value.observationWindow, ['startsAtUtc', 'endsAtUtc'], 'Observation window', issues);
}
function requireBandAndMode(value: Record<string, unknown>, requireFrequency: boolean, issues: string[]): void { if (!isBand(value.band)) issues.push('evidence requires a band.'); if (requireFrequency && !isPositiveInteger(value.frequencyHz)) issues.push('evidence requires a positive integer frequencyHz.'); if (!isPropagationMode(value.modeScope)) issues.push('evidence requires a concrete propagation mode.'); }
function validateObservationWindow(value: unknown, issues: string[]): void { if (!isRecord(value) || !isTimestamp(value.startsAtUtc) || !isTimestamp(value.endsAtUtc)) { issues.push('observationWindow must contain UTC start and end timestamps.'); return; } if (Date.parse(value.startsAtUtc) > Date.parse(value.endsAtUtc)) issues.push('observation-window start cannot follow its end.'); }
function validateRange(value: unknown, label: string, issues: string[]): void { if (!isRecord(value)) { issues.push(`${label} is required.`); return; } rejectUnknownKeys(value, ['lowerHz', 'upperHz'], label, issues); if (!isPositiveInteger(value.lowerHz) || !isPositiveInteger(value.upperHz) || value.lowerHz > value.upperHz) issues.push(`${label} must be ordered positive integer Hz values.`); }
function validateTimestampCoherence(value: Record<string, unknown>, family: unknown, issues: string[]): void { const state = value.state; if (state !== 'unavailable') { if (family === 'modeled-propagation') { if (!isTimestamp(value.modelEvaluationAtUtc)) issues.push('modeled evidence requires modelEvaluationAtUtc.'); } else if (!isTimestamp(value.observedAtUtc)) issues.push('active evidence requires observedAtUtc.'); if (state === 'live' || state === 'cached' || state === 'stale') if (!isTimestamp(value.receivedAtUtc)) issues.push(`${state} evidence requires receivedAtUtc.`); } if (isTimestamp(value.receivedAtUtc) && isTimestamp(value.observedAtUtc) && Date.parse(value.receivedAtUtc) < Date.parse(value.observedAtUtc)) issues.push('receivedAtUtc cannot precede observedAtUtc.'); const evidenceTimes = [value.observedAtUtc, value.modelEvaluationAtUtc, value.receivedAtUtc].filter(isTimestamp); const expiresAtUtc = value.expiresAtUtc; if (isTimestamp(expiresAtUtc) && evidenceTimes.some(time => Date.parse(expiresAtUtc) < Date.parse(time))) issues.push('expiresAtUtc cannot precede an evidence timestamp.'); if (isRecord(value.observationWindow) && isTimestamp(value.observationWindow.endsAtUtc) && isTimestamp(value.receivedAtUtc) && Date.parse(value.observationWindow.endsAtUtc) > Date.parse(value.receivedAtUtc)) issues.push('observation-window end cannot follow receivedAtUtc.'); }
function validateFrequencyTruth(value: Record<string, unknown>, family: unknown, issues: string[]): void { if (isBand(value.band) && isPositiveInteger(value.frequencyHz) && classifyObservedRfBand(value.frequencyHz, value.band) !== value.band) issues.push('frequencyHz does not belong to the declared band.'); if (family === 'frequency-occupancy-observation' && isBand(value.band) && isPositiveInteger(value.frequencyHz)) { const range = value.observationFrequencyRange; if (isRecord(range) && isPositiveInteger(range.lowerHz) && isPositiveInteger(range.upperHz) && (range.lowerHz > value.frequencyHz || value.frequencyHz > range.upperHz)) issues.push('frequencyHz must be within observationFrequencyRange.'); if (isRecord(range) && isPositiveInteger(range.lowerHz) && isPositiveInteger(range.upperHz) && (classifyObservedRfBand(range.lowerHz, value.band) !== value.band || classifyObservedRfBand(range.upperHz, value.band) !== value.band)) issues.push('observationFrequencyRange must remain within its declared band.'); const occupied = value.occupiedFrequencyRange; if (isRecord(occupied) && isPositiveInteger(occupied.lowerHz) && isPositiveInteger(occupied.upperHz) && (isRecord(range) && (occupied.lowerHz < range.lowerHz || occupied.upperHz > range.upperHz))) issues.push('occupiedFrequencyRange must be contained within observationFrequencyRange.'); if (isRecord(occupied) && isPositiveInteger(occupied.lowerHz) && isPositiveInteger(occupied.upperHz) && (classifyObservedRfBand(occupied.lowerHz, value.band) !== value.band || classifyObservedRfBand(occupied.upperHz, value.band) !== value.band)) issues.push('occupiedFrequencyRange must remain within its declared band.'); } }
function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string, issues: string[]): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(`${label} contains undeclared property ${key}.`); }
function validateCount(value: unknown, label: string, issues: string[]): void { if (!isNonNegativeInteger(value)) issues.push(`${label} must be a non-negative integer.`); }
function isLocationScope(value: unknown): value is SmartFrequencyLocationScope { if (!isRecord(value) || typeof value.kind !== 'string' || !(value.kind in LOCATION_KEYS)) return false; const issues: string[] = []; rejectUnknownKeys(value, LOCATION_KEYS[value.kind], 'Location scope', issues); if (issues.length) return false; if (value.kind === 'global') return true; if (value.kind === 'region') return isText(value.regionId); return typeof value.grid4 === 'string' && GRID4_PATTERN.test(value.grid4.toUpperCase()); }
function isFamily(value: unknown): value is SmartFrequencyEvidenceFamily { return typeof value === 'string' && (SMART_FREQUENCY_EVIDENCE_FAMILIES as readonly string[]).includes(value); }
function isState(value: unknown): value is SmartFrequencyEvidenceState { return typeof value === 'string' && (SMART_FREQUENCY_EVIDENCE_STATES as readonly string[]).includes(value); }
function isPermittedUse(value: unknown): value is SmartFrequencyPermittedUse { return value === 'approved' || value === 'restricted' || value === 'not-established' || value === 'unknown'; }
function isSupportStatus(value: unknown): value is SmartFrequencySupportStatus { return value === 'supported' || value === 'partial' || value === 'unsupported' || value === 'unknown'; }
function isModeScope(value: unknown): value is PropagationMode | 'all' | null { return value === null || value === 'all' || isPropagationMode(value); }
function isPropagationMode(value: unknown): value is PropagationMode { return typeof value === 'string' && (PROPAGATION_MODES as readonly string[]).includes(value); }
function isDigitalMode(value: unknown): value is DigitalActivityMode { return value === 'FT8' || value === 'FT4' || value === 'JS8' || value === 'RTTY'; }
function isBand(value: unknown): value is PropagationGuidanceBand { return typeof value === 'string' && (PROPAGATION_GUIDANCE_BANDS as readonly string[]).includes(value); }
function isNullableBand(value: unknown): value is PropagationGuidanceBand | null { return value === null || isBand(value); }
function isNullableFrequency(value: unknown): value is number | null { return value === null || isPositiveInteger(value); }
function isNullableTimestamp(value: unknown): value is string | null { return value === null || isTimestamp(value); }
function isTimestamp(value: unknown): value is string { return typeof value === 'string' && UTC_PATTERN.test(value) && Number.isFinite(Date.parse(value)); }
function isPositiveInteger(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value > 0 && value <= 1_000_000_000; }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000; }
function isId(value: unknown): value is string { return typeof value === 'string' && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value); }
function isCallsign(value: unknown): value is string { return typeof value === 'string' && value.length <= 32 && CALLSIGN_PATTERN.test(value.trim().toUpperCase()); }
function isText(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH; }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function invalid(issues: readonly string[]): SmartFrequencyValidationResult { return { valid: false, evidence: null, issues }; }
