import type { Activation } from './activation';
import type { ActivationNotesCollection } from './activationNotes';
import type { ActivationNotesStore } from './activationNotesStore';
import type { MissionForecastRecord } from './missionForecast';
import type { MissionForecastStore } from './missionForecastStore';
import type { Qso } from './qso';
import type { QsoStore } from './qsoStore';
import type { RetainedSpaceWeatherSnapshot } from './spaceWeatherSnapshot';
import type { SpaceWeatherSnapshotStore } from './spaceWeatherSnapshotStore';
import type { SmartDeployBrief, SmartDeployBriefV2 } from './smartDeployBrief';
import type { SmartDeployBriefStore } from './smartDeployBriefStore';

export type ReviewEvidenceState = 'available' | 'retained' | 'current' | 'stale' | 'unavailable' | 'unknown' | 'unsupported' | 'error';
export interface ActivationReview {
  readonly kind: 'activation_review';
  readonly reviewVersion: 1;
  readonly reviewedAtUtc: string;
  readonly activation: Pick<Activation, 'activationId' | 'type' | 'reference' | 'title' | 'status' | 'createdAtUtc' | 'updatedAtUtc' | 'startedAtUtc' | 'endedAtUtc' | 'operatingObjective' | 'briefId' | 'notesCollectionId'>;
  readonly plan: { readonly state: ReviewEvidenceState; readonly briefId: string | null; readonly type: string; readonly reference: string | null; readonly displayName: string | null; readonly plannedLocation: { readonly latitude: number; readonly longitude: number; readonly gridSquare?: string } | null; readonly missionWindow: { readonly start: string; readonly end: string } | null; readonly bands: readonly string[]; readonly modes: readonly string[]; readonly powerWatts: number | null; readonly sequence: string | null; readonly briefAssociation: ReviewEvidenceState };
  readonly environment: { readonly forecast: { readonly state: ReviewEvidenceState; readonly record: MissionForecastRecord | null }; readonly alerts: { readonly state: ReviewEvidenceState; readonly message: string }; readonly spaceWeather: { readonly state: ReviewEvidenceState; readonly record: RetainedSpaceWeatherSnapshot | null } };
  readonly propagation: { readonly state: ReviewEvidenceState; readonly modeled: unknown | null; readonly observedRf: unknown | null; readonly source: string };
  readonly results: { readonly state: ReviewEvidenceState; readonly total: number; readonly inWindowTotal: number; readonly outsideWindowTotal: number; readonly byBand: Readonly<Record<string, number>>; readonly byMode: Readonly<Record<string, number>>; readonly firstQsoUtc: string | null; readonly lastQsoUtc: string | null; readonly uniqueCallsigns: number; readonly manual: number; readonly wsjtx: number; readonly adifImported: number; readonly qsos: readonly Qso[] };
  readonly notes: { readonly state: ReviewEvidenceState; readonly collection: ActivationNotesCollection | null };
  readonly findings: readonly string[];
  readonly diagnostics: readonly string[];
}

export interface ActivationReviewDependencies {
  readonly activation: Activation;
  readonly briefStore: SmartDeployBriefStore;
  readonly notesStore: ActivationNotesStore;
  readonly forecastStore: MissionForecastStore;
  readonly spaceWeatherStore: SpaceWeatherSnapshotStore;
  readonly qsoStore: QsoStore;
  readonly now?: () => Date;
}

export function assembleActivationReview(dependencies: ActivationReviewDependencies): ActivationReview {
  const { activation } = dependencies;
  const reviewedAtUtc = (dependencies.now ?? (() => new Date()))().toISOString();
  const briefResult = activation.briefId ? dependencies.briefStore.get(activation.briefId) : null;
  const brief = briefResult?.status === 'found' ? briefResult.brief : null;
  const diagnostics = [
    ...(briefResult?.diagnostics ?? []).map(item => item.message),
  ];
  const plan = planFrom(activation, brief);
  const forecastResult = brief ? dependencies.forecastStore.getByBriefId(brief.briefId) : null;
  const spaceWeatherResult = brief ? dependencies.spaceWeatherStore.getByBriefId(brief.briefId) : null;
  const noteResult = activation.notesCollectionId ? dependencies.notesStore.get(activation.notesCollectionId) : activation.briefId ? dependencies.notesStore.getByBriefId(activation.briefId) : null;
  const qsoResult = dependencies.qsoStore.listByActivation(activation.activationId);
  const qsos = [...qsoResult.qsos].sort((left, right) => left.qsoDateTimeUtc.localeCompare(right.qsoDateTimeUtc));
  const missionWindow = plan.missionWindow;
  const inWindowQsos = missionWindow ? qsos.filter(qso => isWithinWindow(qso.qsoDateTimeUtc, missionWindow.start, missionWindow.end)) : qsos;
  const outsideWindowQsos = missionWindow ? qsos.filter(qso => !isWithinWindow(qso.qsoDateTimeUtc, missionWindow.start, missionWindow.end)) : [];
  const findings: string[] = [];
  if (!qsos.length) findings.push('No QSOs logged.');
  if (!brief) findings.push('No SmartDeploy brief is associated with this Activation.');
  if (!forecastResult || forecastResult.status !== 'found') findings.push('No retained mission forecast is available; refresh it when connected.');
  if (!spaceWeatherResult || spaceWeatherResult.status !== 'found') findings.push('No retained space-weather evidence is available.');
  if (!noteResult || noteResult.status !== 'found') findings.push('No Activation Notes are present.');
  if (activation.status !== 'completed') findings.push(`Results are provisional while the Activation is ${activation.status}.`);
  if (outsideWindowQsos.length) findings.push(`${outsideWindowQsos.length} associated QSO${outsideWindowQsos.length === 1 ? '' : 's'} fall${outsideWindowQsos.length === 1 ? 's' : ''} outside the retained planned mission window.`);
  const plannedBands = plan.bands;
  for (const band of plannedBands) if (!qsos.some(qso => qso.band === band)) findings.push(`Planned ${band} operation has no logged ${band} contacts.`);
  for (const band of Object.keys(countBy(qsos, qso => qso.band))) if (!plannedBands.includes(band)) findings.push(`Logged contacts include unplanned band ${band}.`);
  if (qsos.some(qso => qso.source === 'adif_import')) findings.push(`${qsos.filter(qso => qso.source === 'adif_import').length} of ${qsos.length} QSOs were imported from ADIF.`);
  if (noteResult?.status === 'found' && noteResult.collection.notes.length > 0) findings.push('Activation Notes are present.');
  return {
    kind: 'activation_review', reviewVersion: 1, reviewedAtUtc,
    activation: { activationId: activation.activationId, type: activation.type, reference: activation.reference, title: activation.title, status: activation.status, createdAtUtc: activation.createdAtUtc, updatedAtUtc: activation.updatedAtUtc, startedAtUtc: activation.startedAtUtc, endedAtUtc: activation.endedAtUtc, operatingObjective: activation.operatingObjective, briefId: activation.briefId, notesCollectionId: activation.notesCollectionId },
    plan,
    environment: {
      forecast: { state: forecastResult?.status === 'found' ? 'retained' : 'unavailable', record: forecastResult?.status === 'found' ? forecastResult.record : null },
      alerts: { state: 'unavailable', message: 'No retained alert evidence is available for this Activation.' },
      spaceWeather: { state: spaceWeatherResult?.status === 'found' ? 'retained' : 'unavailable', record: spaceWeatherResult?.status === 'found' ? spaceWeatherResult.record : null },
    },
    propagation: propagationFrom(brief),
    results: { state: qsoResult.diagnostics.some(item => item.code === 'io_error') ? 'error' : qsos.length ? 'available' : 'unknown', total: qsos.length, inWindowTotal: inWindowQsos.length, outsideWindowTotal: outsideWindowQsos.length, byBand: countBy(qsos, qso => qso.band), byMode: countBy(qsos, qso => qso.mode), firstQsoUtc: inWindowQsos[0]?.qsoDateTimeUtc ?? null, lastQsoUtc: inWindowQsos.at(-1)?.qsoDateTimeUtc ?? null, uniqueCallsigns: new Set(qsos.map(qso => qso.callsign)).size, manual: qsos.filter(qso => qso.source === 'manual').length, wsjtx: qsos.filter(qso => qso.source === 'wsjtx').length, adifImported: qsos.filter(qso => qso.source === 'adif_import').length, qsos },
    notes: { state: noteResult?.status === 'found' ? noteResult.collection.notes.length ? 'available' : 'unknown' : 'unavailable', collection: noteResult?.status === 'found' ? noteResult.collection : null },
    findings, diagnostics,
  };
}

function planFrom(activation: Activation, brief: SmartDeployBrief | null): ActivationReview['plan'] {
  if (!brief) return { state: 'unavailable', briefId: null, type: activation.type, reference: activation.reference ?? null, displayName: activation.title ?? null, plannedLocation: activation.plannedLocation ? { latitude: activation.plannedLocation.latitude, longitude: activation.plannedLocation.longitude, ...(activation.plannedLocation.gridSquare ? { gridSquare: activation.plannedLocation.gridSquare } : {}) } : null, missionWindow: activation.missionWindow ?? null, bands: [], modes: [], powerWatts: null, sequence: null, briefAssociation: 'unavailable' };
  if (brief.schemaVersion === 2) return { state: 'retained', briefId: brief.briefId, type: brief.activation.program, reference: brief.activation.reference || null, displayName: brief.activation.displayName ?? null, plannedLocation: brief.plannedOperatingSite.location.coordinates ? { latitude: brief.plannedOperatingSite.location.coordinates.lat, longitude: brief.plannedOperatingSite.location.coordinates.lon, ...(brief.plannedOperatingSite.location.gridSquare ? { gridSquare: brief.plannedOperatingSite.location.gridSquare } : {}) } : null, missionWindow: { start: brief.missionWindow.start, end: brief.missionWindow.end }, bands: bandsFromBrief(brief), modes: [...brief.station.selectedModes], powerWatts: brief.station.transmitPowerWatts, sequence: brief.objective ?? null, briefAssociation: 'retained' };
  return { state: 'retained', briefId: brief.briefId, type: brief.mission.activationTarget.program, reference: brief.mission.activationTarget.reference || null, displayName: brief.mission.activationTarget.displayName ?? null, plannedLocation: brief.mission.operatingLocation.coordinates ? { latitude: brief.mission.operatingLocation.coordinates.lat, longitude: brief.mission.operatingLocation.coordinates.lon, ...(brief.mission.operatingLocation.gridSquare ? { gridSquare: brief.mission.operatingLocation.gridSquare } : {}) } : null, missionWindow: brief.mission.missionWindow ? { start: brief.mission.missionWindow.start, end: brief.mission.missionWindow.end } : null, bands: [], modes: [...brief.mission.equipment.modes], powerWatts: brief.mission.equipment.transmitPowerWatts, sequence: brief.mission.objective ?? null, briefAssociation: 'retained' };
}
function bandsFromBrief(_brief: SmartDeployBriefV2): string[] { return []; }
function propagationFrom(brief: SmartDeployBrief | null): ActivationReview['propagation'] { if (!brief) return { state: 'unavailable', modeled: null, observedRf: null, source: 'No retained SmartDeploy brief.' }; return { state: brief.sections.propagation.status === 'unavailable' ? 'unavailable' : 'retained', modeled: brief.sections.propagation.evidence, observedRf: brief.sections.observedRf.evidence, source: 'Retained SmartDeploy brief; modeled propagation is not observed RF.' }; }
function countBy(qsos: readonly Qso[], selector: (qso: Qso) => string): Readonly<Record<string, number>> { return qsos.reduce<Record<string, number>>((counts, qso) => { const key = selector(qso); counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}); }
function isWithinWindow(timestamp: string, start: string, end: string): boolean { const value = Date.parse(timestamp); return Number.isFinite(value) && value >= Date.parse(start) && value <= Date.parse(end); }