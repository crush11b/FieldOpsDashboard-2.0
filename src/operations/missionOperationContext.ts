import type { Activation } from '../../server/activation';
import type { SmartDeployBriefV2 } from '../../server/smartDeployBrief';

export interface MissionOperationContext {
  readonly planSource: 'retained_smartdeploy_brief';
  readonly identity: { readonly program: string; readonly reference: string; readonly displayName?: string };
  readonly plannedSite: { readonly gridSquare?: string; readonly latitude: number | null; readonly longitude: number | null; readonly description: string };
  readonly missionWindow: { readonly start: string; readonly end: string };
  readonly station: { readonly radio: string; readonly antenna: string; readonly modes: readonly string[]; readonly transmitPowerWatts: number };
  readonly loadout: { readonly loadoutId: string; readonly name: string; readonly itemCount: number; readonly capturedAtUtc: string } | null;
  readonly lifecycle: { readonly activationId: string | null; readonly status: Activation['status'] | 'not_started'; readonly startedAtUtc: string | null; readonly endedAtUtc: string | null };
  readonly objective: Activation['operatingObjective'] | null;
  readonly inconsistencies: readonly string[];
}

export function deriveMissionOperationContext(brief: SmartDeployBriefV2, activation: Activation | null): MissionOperationContext {
  const coordinates = brief.plannedOperatingSite.location.coordinates;
  const inconsistencies: string[] = [];
  if (activation) {
    if (activation.briefId && activation.briefId !== brief.briefId) inconsistencies.push('Activation references a different retained brief.');
    if (activation.type !== brief.activation.program || (activation.reference ?? '') !== brief.activation.reference) inconsistencies.push('Activation identity differs from the retained plan.');
    if (activation.missionWindow && (activation.missionWindow.start !== brief.missionWindow.start || activation.missionWindow.end !== brief.missionWindow.end)) inconsistencies.push('Activation mission-window copy differs from the retained plan; the retained plan remains authoritative.');
    if (activation.plannedLocation && coordinates && (activation.plannedLocation.latitude !== coordinates.lat || activation.plannedLocation.longitude !== coordinates.lon)) inconsistencies.push('Activation planned-location copy differs from the retained plan; the retained plan remains authoritative.');
  }
  return {
    planSource: 'retained_smartdeploy_brief',
    identity: { program: brief.activation.program, reference: brief.activation.reference, ...(brief.activation.displayName ? { displayName: brief.activation.displayName } : {}) },
    plannedSite: { ...(brief.plannedOperatingSite.location.gridSquare ? { gridSquare: brief.plannedOperatingSite.location.gridSquare } : {}), latitude: coordinates?.lat ?? null, longitude: coordinates?.lon ?? null, description: brief.plannedOperatingSite.description },
    missionWindow: { start: brief.missionWindow.start, end: brief.missionWindow.end },
    station: { radio: brief.station.radio.name, antenna: brief.station.antenna.name || brief.station.antenna.type, modes: [...brief.station.selectedModes], transmitPowerWatts: brief.station.transmitPowerWatts },
    loadout: brief.loadoutSnapshot ? { loadoutId: brief.loadoutSnapshot.loadoutId, name: brief.loadoutSnapshot.loadoutName, itemCount: brief.loadoutSnapshot.items.length, capturedAtUtc: brief.loadoutSnapshot.capturedAtUtc } : null,
    lifecycle: { activationId: activation?.activationId ?? null, status: activation?.status ?? 'not_started', startedAtUtc: activation?.startedAtUtc ?? null, endedAtUtc: activation?.endedAtUtc ?? null },
    objective: activation?.operatingObjective ?? null,
    inconsistencies,
  };
}
