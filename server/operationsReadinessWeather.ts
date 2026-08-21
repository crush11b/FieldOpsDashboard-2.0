import type { OperationsReadinessDisplayEvidence } from './operationsReadinessDisplayEvidence';
import type { OperationsReadinessInput } from './operationsReadiness';
import type { SmartDeployBriefV2 } from './smartDeployBrief';
import {
  getActiveAlertsApiResponse,
  getCurrentWeatherApiResponse,
  parseWeatherCoordinates,
} from './weather';
import type { TelemetrySource } from '../src/telemetry';

export type OperationsReadinessWeatherDiagnosticCode =
  | 'planned_site_coordinates_unavailable'
  | 'planned_site_weather_unavailable'
  | 'planned_site_alerts_unavailable';

export interface OperationsReadinessWeatherDiagnostic {
  readonly code: OperationsReadinessWeatherDiagnosticCode;
  readonly message: string;
}

export interface OperationsReadinessWeatherEnrichment {
  readonly weather: NonNullable<OperationsReadinessInput['weather']>;
  readonly alerts: NonNullable<OperationsReadinessInput['alerts']>;
  readonly displayEvidence: OperationsReadinessDisplayEvidence;
  readonly diagnostics: readonly OperationsReadinessWeatherDiagnostic[];
}

export interface OperationsReadinessWeatherOptions {
  readonly fetcher?: typeof fetch;
  readonly now?: Date;
  readonly timeoutMs?: number;
}

export const OPERATIONS_READINESS_WEATHER_TIMEOUT_MS = 10_000;

const WEATHER_SOURCE: TelemetrySource = {
  id: 'open-meteo-current-weather',
  type: 'weather_provider',
  name: 'Open-Meteo current weather',
};

const ALERTS_SOURCE: TelemetrySource = {
  id: 'noaa-nws-active-alerts',
  type: 'weather_alert_provider',
  name: 'NOAA/NWS active alerts',
};

const LIVE_EVIDENCE_LIMITATION = 'Provider request succeeded, but no freshness threshold or provider observation timestamp is established.';

export async function enrichOperationsReadinessWeather(
  brief: SmartDeployBriefV2,
  options: OperationsReadinessWeatherOptions = {},
): Promise<OperationsReadinessWeatherEnrichment> {
  const coordinates = brief.plannedOperatingSite.location.coordinates;
  const parsed = parseWeatherCoordinates(coordinates?.lat, coordinates?.lon);
  if (!parsed) {
    const limitation = 'The retained planned operating site has no valid coordinates; live weather and alerts were not requested.';
    return unavailableEnrichment([{
      code: 'planned_site_coordinates_unavailable',
      message: limitation,
    }], limitation);
  }

  const fetcher = withTimeout(options.fetcher ?? fetch, options.timeoutMs ?? OPERATIONS_READINESS_WEATHER_TIMEOUT_MS);
  const now = options.now ?? new Date();
  const [weatherResult, alertsResult] = await Promise.all([
    getCurrentWeatherApiResponse(parsed.latitude, parsed.longitude, fetcher, now),
    getActiveAlertsApiResponse(parsed.latitude, parsed.longitude, fetcher, now),
  ]);
  const diagnostics: OperationsReadinessWeatherDiagnostic[] = [];
  if (weatherResult.weatherStatus === 'unavailable') diagnostics.push({
    code: 'planned_site_weather_unavailable',
    message: 'Live weather for the retained planned operating site is unavailable.',
  });
  if (alertsResult.alertsStatus === 'unavailable') diagnostics.push({
    code: 'planned_site_alerts_unavailable',
    message: 'Live weather alerts for the retained planned operating site are unavailable.',
  });
  const provenanceLimitation = plannedSiteProvenanceLimitation(brief);
  const retrievedAtUtc = validTimestamp(now) ? now.toISOString() : null;

  return {
    weather: {
      status: weatherResult.weatherStatus,
      source: WEATHER_SOURCE,
      limitation: joinLimitations(evidenceLimitation(weatherResult.weatherStatus), provenanceLimitation),
    },
    alerts: {
      status: alertsResult.alertsStatus,
      active: alertsResult.alerts ?? [],
      source: ALERTS_SOURCE,
      limitation: joinLimitations(evidenceLimitation(alertsResult.alertsStatus), provenanceLimitation),
    },
    displayEvidence: {
      weather: {
        status: weatherResult.weatherStatus,
        data: weatherResult.weather,
        retrievedAtUtc: weatherResult.weatherStatus === 'live' ? retrievedAtUtc : null,
        source: WEATHER_SOURCE,
        limitation: joinLimitations(evidenceLimitation(weatherResult.weatherStatus), provenanceLimitation),
      },
      alerts: {
        status: alertsResult.alertsStatus,
        active: alertsResult.alerts ?? [],
        retrievedAtUtc: alertsResult.alertsStatus === 'live' ? retrievedAtUtc : null,
        source: ALERTS_SOURCE,
        limitation: joinLimitations(evidenceLimitation(alertsResult.alertsStatus), provenanceLimitation),
      },
    },
    diagnostics,
  };
}

function evidenceLimitation(status: 'live' | 'unavailable'): string {
  return status === 'live'
    ? LIVE_EVIDENCE_LIMITATION
    : 'The provider did not return usable data for the retained planned operating site.';
}

function plannedSiteProvenanceLimitation(brief: SmartDeployBriefV2): string | undefined {
  const location = brief.plannedOperatingSite.location;
  if (location.planningSemantics === 'provider_reference_default') {
    return 'The planned site uses a provider reference coordinate and may not be the exact station setup point.';
  }
  if (location.source?.type === 'manual_planned_site_grid') {
    return 'The planned site was derived from the center of the entered Maidenhead grid and may not be the exact station setup point.';
  }
  return undefined;
}

function joinLimitations(primary: string, secondary: string | undefined): string {
  return secondary ? `${primary} ${secondary}` : primary;
}

function unavailableEnrichment(
  diagnostics: readonly OperationsReadinessWeatherDiagnostic[],
  limitation: string | undefined,
): OperationsReadinessWeatherEnrichment {
  return {
    weather: { status: 'unavailable', source: WEATHER_SOURCE, ...(limitation ? { limitation } : {}) },
    alerts: { status: 'unavailable', active: [], source: ALERTS_SOURCE, ...(limitation ? { limitation } : {}) },
    displayEvidence: {
      weather: { status: 'unavailable', data: null, retrievedAtUtc: null, source: WEATHER_SOURCE, ...(limitation ? { limitation } : {}) },
      alerts: { status: 'unavailable', active: [], retrievedAtUtc: null, source: ALERTS_SOURCE, ...(limitation ? { limitation } : {}) },
    },
    diagnostics,
  };
}

function validTimestamp(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function withTimeout(fetcher: typeof fetch, timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetcher(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };
}
