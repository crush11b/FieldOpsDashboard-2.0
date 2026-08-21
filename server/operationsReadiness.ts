import type { SmartDeployBriefV2 } from './smartDeployBrief';
import type { SystemTelemetry } from '../src/types';
import type { OperatingLocation } from '../src/location/operatingLocation';
import type { TelemetrySource } from '../src/telemetry';

export const READINESS_STATUSES = ['ready', 'attention', 'blocked', 'unknown', 'stale', 'unavailable', 'unsupported'] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];
export const READINESS_PRIORITIES = ['high', 'medium', 'low'] as const;
export type ReadinessPriority = (typeof READINESS_PRIORITIES)[number];

export interface ReadinessFinding {
  readonly id: string;
  readonly status: ReadinessStatus;
  readonly priority: ReadinessPriority;
  readonly message: string;
  readonly source: TelemetrySource;
  readonly observedAtUtc?: string;
  readonly evaluatedAtUtc: string;
  readonly freshness?: 'fresh' | 'stale' | 'unavailable';
  readonly limitation?: string;
  readonly recommendedAction?: string;
}

export interface OperationsReadinessInput {
  readonly evaluatedAtUtc: string;
  readonly plan: {
    readonly brief: SmartDeployBriefV2 | null;
    readonly sotaDataset: { readonly status: 'available' | 'stale' | 'unavailable'; readonly source: TelemetrySource; readonly downloadedAtUtc?: string };
  };
  readonly currentLocation: { readonly status: 'current' | 'manual' | 'stale' | 'unavailable'; readonly provenance: OperatingLocation['provenance']; readonly source: TelemetrySource; readonly observedAtUtc?: string };
  readonly power: {
    readonly status: SystemTelemetry['status'];
    readonly chargePercent: number | null;
    readonly powerSource: SystemTelemetry['powerSource'];
    readonly charging: boolean | null;
    readonly runtimeSeconds: number | null;
    readonly runtimeValid: boolean;
    readonly source: TelemetrySource;
    readonly observedAtUtc: string;
  };
  readonly weather?: { readonly status: 'live' | 'stale' | 'unavailable'; readonly source: TelemetrySource; readonly observedAtUtc?: string };
  readonly alerts?: { readonly status: 'live' | 'stale' | 'unavailable'; readonly active: readonly { readonly id: string; readonly severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor'; readonly title: string }[]; readonly source: TelemetrySource; readonly observedAtUtc?: string };
  readonly propagation: { readonly status: 'modeled' | 'partial' | 'observed-only' | 'stale' | 'unavailable'; readonly source: TelemetrySource; readonly observedAtUtc?: string; readonly limitation?: string };
  readonly checklist?: { readonly completedItems: number; readonly totalItems: number; readonly source: TelemetrySource; readonly updatedAtUtc?: string };
  readonly activationNotes?: { readonly count: number; readonly source: TelemetrySource; readonly updatedAtUtc?: string };
}

export interface OperationsReadinessSummary {
  readonly evaluatedAtUtc: string;
  readonly plan: { readonly status: ReadinessStatus; readonly briefId: string | null; readonly activationReference: string | null; readonly plannedSite: string | null };
  readonly currentLocation: { readonly status: ReadinessStatus; readonly provenance: OperatingLocation['provenance'] };
  readonly toughBook: { readonly status: ReadinessStatus; readonly chargePercent: number | null; readonly powerSource: SystemTelemetry['powerSource']; readonly charging: boolean | null; readonly runtimeEstimateSeconds: number | null };
  readonly stationEndurance: { readonly status: 'unknown'; readonly limitation: string };
  readonly findings: readonly ReadinessFinding[];
  readonly nextActions: readonly string[];
}

const SOURCE = {
  evaluator: { id: 'operations-readiness-evaluator', type: 'derived', name: 'Operations Readiness evaluator' },
  unsupported: { id: 'unsupported', type: 'unsupported', name: 'Unsupported capability' },
} as const satisfies Record<string, TelemetrySource>;

export function buildOperationsReadinessSummary(input: OperationsReadinessInput): OperationsReadinessSummary {
  const findings: ReadinessFinding[] = [];
  const add = (finding: Omit<ReadinessFinding, 'evaluatedAtUtc'>) => findings.push({ ...finding, evaluatedAtUtc: input.evaluatedAtUtc });
  const brief = input.plan.brief;

  if (!brief) {
    add({ id: 'sota-plan-missing', status: 'blocked', priority: 'high', message: 'No retained SOTA SmartDeploy plan is available.', source: SOURCE.evaluator, recommendedAction: 'Create or retain a SOTA SmartDeploy plan before field departure.' });
  } else {
    add({ id: 'sota-plan-retained', status: brief.status === 'complete' ? 'ready' : 'attention', priority: brief.status === 'complete' ? 'low' : 'medium', message: brief.status === 'complete' ? 'A retained SOTA SmartDeploy plan is available.' : `A retained SOTA SmartDeploy plan is available with ${brief.status} evidence.`, source: SOURCE.evaluator, limitation: brief.status === 'complete' ? undefined : 'The retained plan contains incomplete evidence.', recommendedAction: brief.status === 'complete' ? undefined : 'Review the plan limitations before departure.' });
    for (const limitation of brief.limitations) add({ id: `plan-limitation-${limitation.code}`, status: 'attention', priority: 'low', message: limitation.message, source: SOURCE.evaluator, limitation: limitation.message });
  }

  const dataset = input.plan.sotaDataset;
  add({ id: 'sota-dataset-state', status: dataset.status === 'available' ? 'ready' : dataset.status === 'stale' ? 'stale' : 'unavailable', priority: dataset.status === 'available' ? 'low' : 'medium', message: dataset.status === 'available' ? 'SOTA summit data is available.' : dataset.status === 'stale' ? 'SOTA summit data is stale but usable for planning.' : 'SOTA summit data is unavailable.', source: dataset.source, ...(dataset.downloadedAtUtc ? { observedAtUtc: dataset.downloadedAtUtc } : {}), freshness: dataset.status === 'available' ? 'fresh' : dataset.status === 'stale' ? 'stale' : 'unavailable', recommendedAction: dataset.status === 'stale' ? 'Refresh SOTA data when connectivity is available.' : dataset.status === 'unavailable' ? 'Refresh SOTA data before relying on summit lookup.' : undefined });

  const locationStatus: ReadinessStatus = input.currentLocation.status === 'current' ? 'ready' : input.currentLocation.status === 'manual' ? 'attention' : input.currentLocation.status === 'stale' ? 'stale' : 'unavailable';
  add({ id: 'current-location', status: locationStatus, priority: locationStatus === 'unavailable' ? 'high' : locationStatus === 'ready' ? 'low' : 'medium', message: locationStatus === 'ready' ? 'Current operating location is available.' : locationStatus === 'attention' ? 'Current operating location is manually entered.' : locationStatus === 'stale' ? 'Current operating location is stale.' : 'Current operating location is unavailable.', source: input.currentLocation.source, ...(input.currentLocation.observedAtUtc ? { observedAtUtc: input.currentLocation.observedAtUtc } : {}), freshness: locationStatus === 'ready' || locationStatus === 'attention' ? 'fresh' : locationStatus === 'stale' ? 'stale' : 'unavailable', limitation: 'Current device location is separate from the planned operating site.', recommendedAction: locationStatus === 'unavailable' ? 'Acquire GNSS or enter a planned location.' : locationStatus === 'stale' ? 'Confirm the operating location before deployment.' : undefined });

  const powerStatus: ReadinessStatus = input.power.status !== 'Available' || input.power.chargePercent === null ? 'unknown' : 'ready';
  add({ id: 'toughbook-power', status: powerStatus, priority: powerStatus === 'unknown' ? 'medium' : 'low', message: powerStatus === 'ready' ? `ToughBook power is ${input.power.chargePercent}% on ${input.power.powerSource}.` : 'ToughBook power state is unknown.', source: input.power.source, observedAtUtc: input.power.observedAtUtc, freshness: powerStatus === 'ready' ? 'fresh' : 'unavailable', recommendedAction: powerStatus === 'unknown' ? 'Verify ToughBook power locally.' : undefined });
  const runtimeStatus: ReadinessStatus = input.power.runtimeValid && input.power.runtimeSeconds !== null && Number.isFinite(input.power.runtimeSeconds) && input.power.runtimeSeconds >= 0 ? 'ready' : 'unknown';
  add({ id: 'toughbook-runtime-estimate', status: runtimeStatus, priority: runtimeStatus === 'unknown' ? 'medium' : 'low', message: runtimeStatus === 'ready' ? `Windows reports an estimated ${formatDuration(input.power.runtimeSeconds!)} remaining for the ToughBook.` : 'Windows ToughBook runtime estimate is unknown.', source: input.power.source, observedAtUtc: input.power.observedAtUtc, freshness: runtimeStatus === 'ready' ? 'fresh' : 'unavailable', limitation: 'This is a Windows-provided ToughBook estimate, not radio or station endurance.', recommendedAction: runtimeStatus === 'unknown' ? 'Do not use battery percentage as a runtime estimate.' : undefined });
  add({ id: 'station-endurance', status: 'unknown', priority: 'low', message: 'Radio and station endurance are unknown.', source: SOURCE.evaluator, limitation: 'ToughBook runtime does not measure radio, battery-pack, or station endurance.' });

  const weather = input.weather;
  add({ id: 'weather', status: weather?.status === 'live' ? 'ready' : weather?.status === 'stale' ? 'stale' : 'unavailable', priority: weather?.status === 'live' ? 'low' : 'medium', message: weather?.status === 'live' ? 'Current weather is available.' : weather?.status === 'stale' ? 'Weather information is stale.' : 'Weather information is unavailable.', source: weather?.source ?? SOURCE.evaluator, ...(weather?.observedAtUtc ? { observedAtUtc: weather.observedAtUtc } : {}), freshness: weather?.status === 'live' ? 'fresh' : weather?.status === 'stale' ? 'stale' : 'unavailable' });
  const alerts = input.alerts;
  const highestAlert = alerts?.active.slice().sort(compareAlerts)[0];
  const significantAlert = highestAlert && (highestAlert.severity === 'Extreme' || highestAlert.severity === 'Severe');
  const alertStatus: ReadinessStatus = !alerts || alerts.status === 'unavailable'
    ? 'unavailable'
    : alerts.status === 'stale'
      ? 'stale'
      : highestAlert
        ? 'attention'
        : 'ready';
  const alertPriority: ReadinessPriority = significantAlert ? 'high' : alertStatus === 'ready' ? 'low' : 'medium';
  const alertMessage = !alerts || alerts.status === 'unavailable'
    ? 'Weather alerts are unavailable.'
    : alerts.status === 'stale'
      ? highestAlert
        ? `Weather alert evidence is stale; a ${highestAlert.severity.toLowerCase()} alert was retained but is not confirmed current: ${highestAlert.title}.`
        : 'Weather alerts are stale.'
      : highestAlert
        ? `Active ${highestAlert.severity.toLowerCase()} weather alert: ${highestAlert.title}.`
        : 'No active weather alerts are present in the available alert set.';
  add({ id: 'weather-alerts', status: alertStatus, priority: alertPriority, message: alertMessage, source: alerts?.source ?? SOURCE.evaluator, ...(alerts?.observedAtUtc ? { observedAtUtc: alerts.observedAtUtc } : {}), freshness: alerts?.status === 'live' ? 'fresh' : alerts?.status === 'stale' ? 'stale' : 'unavailable', recommendedAction: significantAlert ? 'Review the alert and current conditions before operating.' : alertStatus === 'stale' ? 'Refresh authoritative weather information before operating.' : undefined });

  const propagationStatus: ReadinessStatus = input.propagation.status === 'modeled' ? 'attention' : input.propagation.status === 'partial' || input.propagation.status === 'observed-only' ? 'attention' : input.propagation.status === 'stale' ? 'stale' : 'unavailable';
  add({ id: 'propagation-evidence', status: propagationStatus, priority: propagationStatus === 'unavailable' ? 'medium' : 'low', message: input.propagation.status === 'modeled' ? 'Propagation guidance is modeled and is not a guarantee.' : input.propagation.status === 'partial' ? 'Propagation guidance is partial.' : input.propagation.status === 'observed-only' ? 'Propagation evidence is observational only.' : input.propagation.status === 'stale' ? 'Propagation evidence is stale.' : 'Propagation guidance is unavailable.', source: input.propagation.source, ...(input.propagation.observedAtUtc ? { observedAtUtc: input.propagation.observedAtUtc } : {}), freshness: input.propagation.status === 'stale' ? 'stale' : input.propagation.status === 'unavailable' ? 'unavailable' : 'fresh', limitation: input.propagation.limitation ?? 'Propagation evidence does not guarantee operating success.' });

  const checklist = input.checklist;
  const checklistComplete = checklist && checklist.totalItems > 0 && checklist.completedItems >= checklist.totalItems;
  add({ id: 'field-readiness-checklist', status: !checklist ? 'unknown' : checklistComplete ? 'ready' : 'attention', priority: !checklist || !checklistComplete ? 'medium' : 'low', message: !checklist ? 'Field Readiness Checklist has not been created.' : checklistComplete ? `Field Readiness Checklist is complete (${checklist.completedItems}/${checklist.totalItems}).` : `Field Readiness Checklist is incomplete (${checklist.completedItems}/${checklist.totalItems}).`, source: checklist?.source ?? SOURCE.evaluator, ...(checklist?.updatedAtUtc ? { observedAtUtc: checklist.updatedAtUtc } : {}), limitation: 'Checklist completion is a readiness indicator, not proof of safety, permission, legality, or equipment presence.', recommendedAction: !checklist || !checklistComplete ? 'Review and complete the readiness checklist.' : undefined });
  const notes = input.activationNotes;
  add({ id: 'activation-notes', status: notes ? 'ready' : 'unknown', priority: notes ? 'low' : 'medium', message: notes ? `Activation Notes are available (${notes.count} recorded).` : 'Activation Notes metadata is unavailable.', source: notes?.source ?? SOURCE.evaluator, ...(notes?.updatedAtUtc ? { observedAtUtc: notes.updatedAtUtc } : {}), freshness: notes ? 'fresh' : 'unavailable', recommendedAction: notes ? undefined : 'Confirm the activation notes collection is available.' });
  add({ id: 'clock-synchronization', status: 'unknown', priority: 'medium', message: 'Clock synchronization cannot currently be verified.', source: SOURCE.unsupported, limitation: 'No Windows clock-synchronization telemetry is available; system time, GPS time, and checklist state are not evidence.' });
  add({ id: 'local-nvis', status: 'unsupported', priority: 'low', message: 'Local/NVIS evaluation is unsupported.', source: SOURCE.unsupported, limitation: 'No Local/NVIS prediction or recommendation is implemented.' });

  const ordered = [...findings].sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || left.id.localeCompare(right.id));
  return {
    evaluatedAtUtc: input.evaluatedAtUtc,
    plan: { status: brief ? brief.status === 'complete' ? 'ready' : 'attention' : 'blocked', briefId: brief?.briefId ?? null, activationReference: brief?.activation.reference ?? null, plannedSite: brief?.plannedOperatingSite.description ?? null },
    currentLocation: { status: locationStatus, provenance: input.currentLocation.provenance },
    toughBook: { status: powerStatus === 'ready' && runtimeStatus === 'ready' ? 'ready' : powerStatus, chargePercent: input.power.chargePercent, powerSource: input.power.powerSource, charging: input.power.charging, runtimeEstimateSeconds: runtimeStatus === 'ready' ? input.power.runtimeSeconds : null },
    stationEndurance: { status: 'unknown', limitation: 'ToughBook runtime does not measure radio or station endurance.' },
    findings: ordered,
    nextActions: ordered.filter(finding => finding.recommendedAction).map(finding => finding.recommendedAction!),
  };
}

function priorityRank(priority: ReadinessPriority): number { return priority === 'high' ? 0 : priority === 'medium' ? 1 : 2; }
function compareAlerts(left: OperationsReadinessInput['alerts'] extends { active: infer Alerts } ? Alerts extends readonly (infer Alert)[] ? Alert : never : never, right: OperationsReadinessInput['alerts'] extends { active: infer Alerts } ? Alerts extends readonly (infer Alert)[] ? Alert : never : never): number {
  const severityOrder = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 } as const;
  return severityOrder[left.severity] - severityOrder[right.severity] || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}
function formatDuration(seconds: number): string { const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`; }
