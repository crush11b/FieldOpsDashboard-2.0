import type { NOAAAlert, WeatherData } from '../src/types';
import type { TelemetrySource } from '../src/telemetry';

export interface OperationsReadinessDisplayEvidence {
  readonly weather: {
    readonly status: 'not_requested' | 'live' | 'unavailable';
    readonly data: WeatherData | null;
    readonly retrievedAtUtc: string | null;
    readonly source: TelemetrySource;
    readonly limitation?: string;
  };
  readonly alerts: {
    readonly status: 'not_requested' | 'live' | 'unavailable';
    readonly active: readonly NOAAAlert[];
    readonly retrievedAtUtc: string | null;
    readonly source: TelemetrySource;
    readonly limitation?: string;
  };
}
