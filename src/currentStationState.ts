export const CURRENT_STATION_SOURCES = ['manual'] as const;
export type CurrentStationSource = (typeof CURRENT_STATION_SOURCES)[number];

export const CURRENT_STATION_STATUSES = ['available', 'unavailable', 'unknown'] as const;
export type CurrentStationStatus = (typeof CURRENT_STATION_STATUSES)[number];

export interface CurrentStationState {
  readonly band: string;
  readonly frequencyMHz: number | null;
  readonly mode: string;
  readonly submode?: string;
  readonly source: CurrentStationSource;
  readonly operatorUpdatedAtUtc: string;
  readonly freshness: 'operator_set';
  readonly status: CurrentStationStatus;
  readonly limitation: string;
}

export interface ManualOperatingContext {
  readonly band: string;
  readonly frequencyMHz: string;
  readonly mode: string;
}

export function createManualCurrentStationState(context: ManualOperatingContext, now = () => new Date()): CurrentStationState {
  const frequency = context.frequencyMHz.trim() ? Number(context.frequencyMHz) : null;
  const timestamp = now();
  return {
    band: context.band,
    frequencyMHz: frequency !== null && Number.isFinite(frequency) ? frequency : null,
    mode: context.mode,
    source: 'manual',
    operatorUpdatedAtUtc: timestamp.toISOString(),
    freshness: 'operator_set',
    status: 'available',
    limitation: 'Operator-entered operating context; not radio, CAT, WSJT-X, or RF confirmation.',
  };
}