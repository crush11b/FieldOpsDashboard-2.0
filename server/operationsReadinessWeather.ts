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
  readonly diagnostics: readonly OperationsReadinessWeatherDiagnostic[];
}

export interface OperationsReadinessWeatherOptions {
  readonly fetcher?: typeof fetch;
  readonly now?: Date;
}

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
    return unavailableEnrichment([{
      code: 'planned_site_coordinates_unavailable',
      message: 'The retained planned operating site has no valid coordinates; live weather and alerts were not requested.',
    }]);
  }

  const fetcher = options.fetcher ?? fetch;
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

  return {
    weather: {
      status: weatherResult.weatherStatus,
      source: WEATHER_SOURCE,
      limitation: evidenceLimitation(weatherResult.weatherStatus),
    },
    alerts: {
      status: alertsResult.alertsStatus,
      active: alertsResult.alerts ?? [],
      source: ALERTS_SOURCE,
      limitation: evidenceLimitation(alertsResult.alertsStatus),
    },
    diagnostics,
  };
}

function evidenceLimitation(status: 'live' | 'unavailable'): string {
  return status === 'live'
    ? LIVE_EVIDENCE_LIMITATION
    : 'The provider did not return usable data for the retained planned operating site.';
}

function unavailableEnrichment(
  diagnostics: readonly OperationsReadinessWeatherDiagnostic[],
): OperationsReadinessWeatherEnrichment {
  return {
    weather: { status: 'unavailable', source: WEATHER_SOURCE },
    alerts: { status: 'unavailable', active: [], source: ALERTS_SOURCE },
    diagnostics,
  };
}
