import type { ActivationNotesStore } from './activationNotesStore';
import { buildOperationsReadinessSummary, type OperationsReadinessInput, type OperationsReadinessSummary } from './operationsReadiness';
import type { OperationsReadinessDisplayEvidence } from './operationsReadinessDisplayEvidence';
import type { FieldReadinessChecklist } from './fieldReadinessChecklist';
import type { FieldReadinessChecklistStore } from './fieldReadinessChecklistStore';
import type { ClockSynchronizationEvidence, LocationTelemetry } from './locationTelemetryPipe';
import type { SmartDeployBrief, SmartDeployBriefV2 } from './smartDeployBrief';
import type { SmartDeployBriefStore } from './smartDeployBriefStore';
import { SOTA_SUMMIT_SOURCE_NAME, SOTA_SUMMIT_SOURCE_TYPE, type LocalSotaSummitDataset } from './sotaSummitDataset';
import type { SystemTelemetry } from '../src/types';
import type { TelemetrySource } from '../src/telemetry';
import type { OperationsReadinessWeatherEnrichment } from './operationsReadinessWeather';

export type OperationsReadinessDiagnosticCode =
  | 'brief_store_unavailable'
  | 'sota_dataset_unavailable'
  | 'evaluation_clock_unavailable'
  | 'local_weather_alerts_unavailable'
  | 'unsupported_brief_schema'
  | 'checklist_unavailable'
  | 'activation_notes_unavailable'
  | 'location_telemetry_unavailable'
  | 'system_telemetry_unavailable'
  | 'system_observation_timestamp_unavailable'
  | 'malformed_location_telemetry'
  | 'malformed_system_telemetry'
  | 'weather_enrichment_unavailable'
  | 'planned_site_coordinates_unavailable'
  | 'planned_site_weather_unavailable'
  | 'planned_site_alerts_unavailable';

export interface OperationsReadinessDiagnostic {
  readonly code: OperationsReadinessDiagnosticCode;
  readonly message: string;
}

export interface OperationsReadinessAssemblyDependencies {
  readonly briefStore: Pick<SmartDeployBriefStore, 'get'>;
  readonly sotaDatasetReader: () => LocalSotaSummitDataset;
  readonly checklistStore: Pick<FieldReadinessChecklistStore, 'getByBriefId'>;
  readonly activationNotesStore: Pick<ActivationNotesStore, 'getByBriefId'>;
  readonly readLocation: () => Promise<LocationTelemetry>;
  readonly readClockStatus?: () => Promise<ClockSynchronizationEvidence>;
  readonly readSystem: () => Promise<SystemTelemetry>;
  readonly enrichWeather?: (brief: SmartDeployBriefV2) => Promise<OperationsReadinessWeatherEnrichment>;
  readonly now: () => Date;
}

export interface OperationsReadinessAssemblyOptions {
  readonly includeLiveWeather?: boolean;
}

export type OperationsReadinessAssemblyResult =
  | { readonly status: 'ok'; readonly summary: OperationsReadinessSummary; readonly displayEvidence: OperationsReadinessDisplayEvidence; readonly diagnostics: readonly OperationsReadinessDiagnostic[] }
  | { readonly status: 'notFound'; readonly diagnostics: readonly OperationsReadinessDiagnostic[] }
  | { readonly status: 'unsupported'; readonly diagnostics: readonly OperationsReadinessDiagnostic[] }
  | { readonly status: 'unavailable'; readonly diagnostics: readonly OperationsReadinessDiagnostic[] };

const SOURCE = {
  evaluator: { id: 'operations-readiness-assembly', type: 'derived', name: 'Operations Readiness assembly' },
  localLocation: { id: 'local-location-telemetry', type: 'local_telemetry_pipe', name: 'Local location telemetry' },
  localSystem: { id: 'local-system-telemetry', type: 'local_telemetry_pipe', name: 'Local system telemetry' },
  retainedPropagation: { id: 'retained-smartdeploy-propagation', type: 'retained_smartdeploy_evidence', name: 'Retained SmartDeploy propagation evidence' },
  sotaDataset: { id: 'sota-summit-database', type: 'sota_official_summit_csv', name: 'Official Summits on the Air summit database' },
} as const satisfies Record<string, TelemetrySource>;

const LOCAL_ONLY_LIMITATION = 'No live provider request was performed; Operations Readiness is using local retained evidence only.';
const LIVE_ENRICHMENT_UNAVAILABLE_LIMITATION = 'Live weather and alerts enrichment is unavailable; no live provider evidence was retrieved.';

export async function assembleOperationsReadiness(
  briefId: string,
  dependencies: OperationsReadinessAssemblyDependencies,
  options: OperationsReadinessAssemblyOptions = {},
): Promise<OperationsReadinessAssemblyResult> {
  let briefResult: ReturnType<SmartDeployBriefStore['get']>;
  try {
    briefResult = dependencies.briefStore.get(briefId);
  } catch {
    return unavailable('brief_store_unavailable', 'The retained SmartDeploy brief store is unavailable.');
  }

  if (briefResult.status === 'notFound') {
    return hasIndeterminateBriefDiagnostic(briefResult.diagnostics)
      ? unavailable('brief_store_unavailable', 'The retained SmartDeploy brief store is unavailable.')
      : { status: 'notFound', diagnostics: [] };
  }
  if (briefResult.brief.schemaVersion !== 2) return { status: 'unsupported', diagnostics: [{ code: 'unsupported_brief_schema', message: 'The retained SmartDeploy brief schema is unsupported for Operations Readiness.' }] };
  const evaluatedAtUtc = readEvaluationTime(dependencies.now);
  if (!evaluatedAtUtc) return unavailable('evaluation_clock_unavailable', 'The Operations Readiness evaluation clock is unavailable.');

  const diagnostics: OperationsReadinessDiagnostic[] = [];
  const [location, system, clock] = await Promise.all([
    readLocation(dependencies.readLocation, diagnostics),
    readSystem(dependencies.readSystem, diagnostics, evaluatedAtUtc),
    readClock(dependencies.readClockStatus, diagnostics),
  ]);
  const dataset = readDataset(dependencies.sotaDatasetReader, diagnostics);
  const checklist = readChecklist(dependencies.checklistStore, briefId, diagnostics);
  const activationNotes = readActivationNotes(dependencies.activationNotesStore, briefId, diagnostics);
  let weather: OperationsReadinessInput['weather'] = { status: 'unavailable', source: SOURCE.evaluator };
  let alerts: OperationsReadinessInput['alerts'] = { status: 'unavailable', active: [], source: SOURCE.evaluator };
  let displayEvidence = notRequestedDisplayEvidence();
  if (options.includeLiveWeather) {
    displayEvidence = unavailableDisplayEvidence();
    if (!dependencies.enrichWeather) {
      displayEvidence = unavailableDisplayEvidence(LIVE_ENRICHMENT_UNAVAILABLE_LIMITATION);
      diagnostics.push({ code: 'weather_enrichment_unavailable', message: 'Live weather and alerts enrichment is unavailable.' });
    } else {
      try {
        const enrichment = await dependencies.enrichWeather(briefResult.brief);
        weather = enrichment.weather;
        alerts = enrichment.alerts;
        displayEvidence = enrichment.displayEvidence;
        for (const diagnostic of enrichment.diagnostics) diagnostics.push(diagnostic);
      } catch {
        displayEvidence = unavailableDisplayEvidence(LIVE_ENRICHMENT_UNAVAILABLE_LIMITATION);
        diagnostics.push({ code: 'weather_enrichment_unavailable', message: 'Live weather and alerts enrichment is unavailable.' });
      }
    }
  }

  const summary = buildOperationsReadinessSummary({
    evaluatedAtUtc,
    plan: { brief: briefResult.brief, sotaDataset: dataset },
    currentLocation: location,
    power: system,
    weather,
    alerts,
    propagation: propagationInput(briefResult.brief, briefId),
    ...(checklist ? { checklist } : {}),
    ...(activationNotes ? { activationNotes } : {}),
    ...(clock ? { clock } : {}),
  });
  if (!options.includeLiveWeather) diagnostics.push({ code: 'local_weather_alerts_unavailable', message: 'Current weather and alerts are not retained by this local readiness assembly; no live weather request was performed.' });
  return { status: 'ok', summary, displayEvidence, diagnostics };
}

function notRequestedDisplayEvidence(): OperationsReadinessDisplayEvidence {
  return {
    weather: { status: 'not_requested', data: null, retrievedAtUtc: null, source: SOURCE.evaluator, limitation: LOCAL_ONLY_LIMITATION },
    alerts: { status: 'not_requested', active: [], retrievedAtUtc: null, source: SOURCE.evaluator, limitation: LOCAL_ONLY_LIMITATION },
  };
}

function unavailableDisplayEvidence(limitation?: string): OperationsReadinessDisplayEvidence {
  return {
    weather: { status: 'unavailable', data: null, retrievedAtUtc: null, source: SOURCE.evaluator, ...(limitation ? { limitation } : {}) },
    alerts: { status: 'unavailable', active: [], retrievedAtUtc: null, source: SOURCE.evaluator, ...(limitation ? { limitation } : {}) },
  };
}

function readDataset(reader: () => LocalSotaSummitDataset, diagnostics: OperationsReadinessDiagnostic[]): OperationsReadinessInput['plan']['sotaDataset'] {
  try {
    const dataset = reader();
    const status = dataset.state === 'AVAILABLE' ? 'available' : dataset.state === 'STALE' ? 'stale' : 'unavailable';
    return { status, source: dataset.metadata ? { id: dataset.metadata.sourceId, type: SOTA_SUMMIT_SOURCE_TYPE, name: dataset.metadata.sourceName || SOTA_SUMMIT_SOURCE_NAME } : SOURCE.sotaDataset, ...(dataset.metadata?.downloadedAtUtc ? { downloadedAtUtc: dataset.metadata.downloadedAtUtc } : {}) };
  } catch {
    diagnostics.push({ code: 'sota_dataset_unavailable', message: 'The retained SOTA dataset state is unavailable.' });
    return { status: 'unavailable', source: SOURCE.sotaDataset };
  }
}

function readChecklist(store: Pick<FieldReadinessChecklistStore, 'getByBriefId'>, briefId: string, diagnostics: OperationsReadinessDiagnostic[]): OperationsReadinessInput['checklist'] | undefined {
  try {
    const result = store.getByBriefId(briefId);
    if (hasStoreFailure(result.diagnostics)) {
      diagnostics.push({ code: 'checklist_unavailable', message: 'Field Readiness Checklist evidence is unavailable.' });
      return undefined;
    }
    const checklist = result.checklists[0];
    return checklist ? checklistInput(checklist) : undefined;
  } catch {
    diagnostics.push({ code: 'checklist_unavailable', message: 'Field Readiness Checklist evidence is unavailable.' });
    return undefined;
  }
}

function readActivationNotes(store: Pick<ActivationNotesStore, 'getByBriefId'>, briefId: string, diagnostics: OperationsReadinessDiagnostic[]): OperationsReadinessInput['activationNotes'] | undefined {
  try {
    const result = store.getByBriefId(briefId);
    if (hasStoreFailure(result.diagnostics)) {
      diagnostics.push({ code: 'activation_notes_unavailable', message: 'Activation Notes evidence is unavailable.' });
      return undefined;
    }
    const collection = result.collections[0];
    return collection ? { count: collection.notes.length, source: notesSource(briefId), updatedAtUtc: collection.updatedAtUtc } : { count: 0, source: notesSource(briefId) };
  } catch {
    diagnostics.push({ code: 'activation_notes_unavailable', message: 'Activation Notes evidence is unavailable.' });
    return undefined;
  }
}

async function readLocation(reader: () => Promise<LocationTelemetry>, diagnostics: OperationsReadinessDiagnostic[]): Promise<OperationsReadinessInput['currentLocation']> {
  try {
    const value = await reader();
    const source = { ...SOURCE.localLocation, id: typeof value.source === 'string' && value.source ? value.source : SOURCE.localLocation.id };
    const observedAtUtc = validTimestamp(value.timestampUtc) ? value.timestampUtc! : undefined;
    if (value.status === 'Available' && finiteCoordinate(value.latitude, -90, 90) && finiteCoordinate(value.longitude, -180, 180) && observedAtUtc) return { status: 'current', provenance: 'current', source, observedAtUtc };
    if (value.status === 'Available') diagnostics.push({ code: 'malformed_location_telemetry', message: 'Location telemetry reported Available without valid coordinates or observation timestamp.' });
    else if (value.status === 'Error') diagnostics.push({ code: 'malformed_location_telemetry', message: 'Location telemetry returned an error or invalid coordinates.' });
    else diagnostics.push({ code: 'location_telemetry_unavailable', message: 'Current location telemetry is unavailable.' });
    return { status: 'unavailable', provenance: 'unavailable', source, ...(observedAtUtc ? { observedAtUtc } : {}) };
  } catch {
    diagnostics.push({ code: 'location_telemetry_unavailable', message: 'Current location telemetry is unavailable.' });
    return { status: 'unavailable', provenance: 'unavailable', source: SOURCE.localLocation };
  }
}

async function readClock(reader: (() => Promise<ClockSynchronizationEvidence>) | undefined, diagnostics: OperationsReadinessDiagnostic[]): Promise<OperationsReadinessInput['clock']> {
  if (!reader) return undefined;
  try {
    const value = await reader();
    const status = value.status === 'Synchronized' ? 'synchronized' : value.status === 'NotSynchronized' ? 'not_synchronized' : value.status === 'Unavailable' ? 'unavailable' : value.status === 'Error' ? 'error' : 'unknown';
    if (status === 'unavailable' || status === 'error') diagnostics.push({ code: 'location_telemetry_unavailable', message: value.attemptMessage ?? 'Clock synchronization evidence is unavailable.' });
    return { status, source: { id: 'local-clock-telemetry', type: 'local_telemetry_pipe', name: 'Local clock synchronization telemetry' }, ...(value.lastSuccessfulSynchronizationUtc ? { observedAtUtc: value.lastSuccessfulSynchronizationUtc } : {}), lastSuccessfulSynchronizationUtc: value.lastSuccessfulSynchronizationUtc, offsetBeforeSynchronizationSeconds: value.offsetBeforeSynchronizationSeconds, message: value.attemptMessage };
  } catch {
    diagnostics.push({ code: 'location_telemetry_unavailable', message: 'Clock synchronization evidence is unavailable.' });
    return { status: 'unavailable', source: { id: 'local-clock-telemetry', type: 'local_telemetry_pipe', name: 'Local clock synchronization telemetry' }, message: 'The FieldOps Agent is unavailable.' };
  }
}

async function readSystem(reader: () => Promise<SystemTelemetry>, diagnostics: OperationsReadinessDiagnostic[], evaluatedAtUtc: string): Promise<OperationsReadinessInput['power']> {
  try {
    const value = await reader();
    const status = value.status === 'Available' || value.status === 'Unavailable' || value.status === 'Error' ? value.status : 'Unavailable';
    const validCharge = status === 'Available' && typeof value.chargePercent === 'number' && Number.isFinite(value.chargePercent) && value.chargePercent >= 0 && value.chargePercent <= 100 ? value.chargePercent : null;
    const validPowerSource = value.powerSource === 'AC' || value.powerSource === 'Battery' || value.powerSource === 'Unknown';
    const validCharging = typeof value.charging === 'boolean';
    const validRuntime = status === 'Available' && typeof value.remainingRuntimeSeconds === 'number' && Number.isFinite(value.remainingRuntimeSeconds) && value.remainingRuntimeSeconds >= 0;
    const validObservedAtUtc = validTimestamp(value.observedAtUtc);
    if (value.status !== 'Available' && value.status !== 'Unavailable' && value.status !== 'Error') diagnostics.push({ code: 'malformed_system_telemetry', message: 'System telemetry returned an invalid status.' });
    const malformedAvailableField = status === 'Available' && (
      (value.chargePercent !== null && validCharge === null)
      || !validPowerSource
      || (value.charging !== null && !validCharging)
      || (value.remainingRuntimeSeconds !== null && !validRuntime)
    );
    if (status === 'Available' && (!validObservedAtUtc || malformedAvailableField)) diagnostics.push({ code: 'malformed_system_telemetry', message: !validObservedAtUtc ? 'Available system telemetry has no valid hardware-observation timestamp.' : 'Available system telemetry contains one or more malformed power fields.' });
    if (status === 'Available' && !validObservedAtUtc) {
      diagnostics.push({ code: 'system_observation_timestamp_unavailable', message: 'No valid hardware-observation timestamp was available for the unavailable system telemetry.' });
      return { status: 'Unavailable', chargePercent: null, powerSource: 'Unknown', charging: null, runtimeSeconds: null, runtimeValid: false, source: SOURCE.localSystem, observedAtUtc: evaluatedAtUtc };
    }
    if (status !== 'Available') {
      diagnostics.push({ code: 'system_telemetry_unavailable', message: 'ToughBook system telemetry is unavailable.' });
      if (!validObservedAtUtc) diagnostics.push({ code: 'system_observation_timestamp_unavailable', message: 'No valid hardware-observation timestamp was available for the unavailable system telemetry.' });
      return { status, chargePercent: null, powerSource: 'Unknown', charging: null, runtimeSeconds: null, runtimeValid: false, source: SOURCE.localSystem, observedAtUtc: validObservedAtUtc ? value.observedAtUtc : evaluatedAtUtc };
    }
    return { status, chargePercent: validCharge, powerSource: validPowerSource ? value.powerSource : 'Unknown', charging: validCharging ? value.charging : null, runtimeSeconds: validRuntime ? value.remainingRuntimeSeconds : null, runtimeValid: validRuntime, source: { ...SOURCE.localSystem, id: typeof value.source === 'string' && value.source ? value.source : SOURCE.localSystem.id }, observedAtUtc: value.observedAtUtc };
  } catch {
    diagnostics.push({ code: 'system_telemetry_unavailable', message: 'ToughBook system telemetry is unavailable.' });
    diagnostics.push({ code: 'system_observation_timestamp_unavailable', message: 'No valid hardware-observation timestamp was available for the unavailable system telemetry.' });
    return { status: 'Unavailable', chargePercent: null, powerSource: 'Unknown', charging: null, runtimeSeconds: null, runtimeValid: false, source: SOURCE.localSystem, observedAtUtc: evaluatedAtUtc };
  }
}

function propagationInput(brief: SmartDeployBriefV2, briefId: string): OperationsReadinessInput['propagation'] {
  const section = brief.sections?.propagation;
  const rawStatus = section?.status;
  const status: OperationsReadinessInput['propagation']['status'] = rawStatus === 'complete' || rawStatus === 'derived' || rawStatus === 'available' ? 'modeled' : rawStatus === 'partial' ? 'partial' : rawStatus === 'stale' ? 'stale' : 'unavailable';
  const evidence = section?.evidence as { readonly generatedAtUtc?: unknown; readonly summary?: { readonly limitations?: readonly unknown[] } } | undefined;
  const limitation = evidence?.summary?.limitations?.filter((value): value is string => typeof value === 'string').join(' ') || undefined;
  return { status, source: { ...SOURCE.retainedPropagation, id: `smartdeploy-brief:${briefId}:propagation` }, ...(validTimestamp(evidence?.generatedAtUtc) ? { observedAtUtc: evidence?.generatedAtUtc } : {}), ...(limitation ? { limitation } : {}) };
}

function checklistInput(checklist: FieldReadinessChecklist): NonNullable<OperationsReadinessInput['checklist']> {
  const items = checklist.sections.flatMap(section => section.items);
  return { completedItems: items.filter(item => item.completed).length, totalItems: items.length, source: { id: `smartdeploy-brief:${checklist.briefId}:checklist`, type: 'retained_checklist', name: 'Retained Field Readiness Checklist' }, updatedAtUtc: checklist.updatedAtUtc };
}

function notesSource(briefId: string): TelemetrySource { return { id: `smartdeploy-brief:${briefId}:activation-notes`, type: 'retained_activation_notes', name: 'Retained Activation Notes' }; }
function hasStoreFailure(diagnostics: readonly { readonly code: string }[]): boolean { return diagnostics.some(diagnostic => diagnostic.code === 'io_error' || diagnostic.code === 'corrupt' || diagnostic.code === 'unsupported_store_version'); }
function hasIndeterminateBriefDiagnostic(diagnostics: readonly { readonly code: string }[]): boolean { return diagnostics.some(diagnostic => diagnostic.code === 'io_error' || diagnostic.code === 'corrupt' || diagnostic.code === 'unsupported_store_version'); }
function validTimestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function finiteCoordinate(value: unknown, minimum: number, maximum: number): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum; }
function readEvaluationTime(now: () => Date): string | null { try { const value = now(); return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null; } catch { return null; } }
function unavailable(code: OperationsReadinessDiagnosticCode, message: string): OperationsReadinessAssemblyResult { return { status: 'unavailable', diagnostics: [{ code, message }] }; }
