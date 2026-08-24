import { parseCoordinates } from '../src/location/coordinates';
import type { SmartDeployBriefV2 } from './smartDeployBrief';

export const MISSION_FORECAST_SCHEMA_VERSION = 1 as const;
export const MISSION_FORECAST_PROVIDER_TIMEOUT_MS = 10_000;
export const MISSION_FORECAST_PROVIDER_ID = 'open-meteo-mission-forecast';

export type MissionForecastStatus = 'live' | 'outside_provider_horizon' | 'planned_coordinates_invalid' | 'provider_unavailable' | 'provider_unusable';
export interface MissionForecastPeriod { readonly startsAtUtc: string; readonly endsAtUtc: string; readonly temperatureF: number; readonly precipitationProbability: number; readonly windSpeedMph: number; readonly windDirectionDegrees: number; readonly windDirection: string; readonly windGustMph?: number; readonly weatherCode: number; readonly condition: string; }
export interface MissionForecastRecord { readonly schemaVersion: typeof MISSION_FORECAST_SCHEMA_VERSION; readonly briefId: string; readonly activation: { readonly program: string; readonly reference: string }; readonly plannedSite: { readonly latitude: number; readonly longitude: number; readonly provenance: string }; readonly missionWindow: { readonly start: string; readonly end: string }; readonly provider: { readonly id: typeof MISSION_FORECAST_PROVIDER_ID; readonly name: 'Open-Meteo'; readonly timezone: 'UTC' }; readonly retrievedAtUtc: string; readonly periods: readonly MissionForecastPeriod[]; readonly status: 'live'; readonly sourceUrl: string; readonly limitations: readonly string[]; readonly diagnostics: readonly string[]; readonly updatedAtUtc: string; }
export interface MissionForecastProviderOptions { readonly fetcher?: typeof fetch; readonly now?: Date; readonly timeoutMs?: number; }
export interface MissionForecastRetrieval { readonly status: MissionForecastStatus; readonly record: MissionForecastRecord | null; readonly message: string; }

export async function retrieveMissionForecast(brief: SmartDeployBriefV2, options: MissionForecastProviderOptions = {}): Promise<MissionForecastRetrieval> {
  const coordinates = brief.plannedOperatingSite.location.coordinates
    ? parseCoordinates(brief.plannedOperatingSite.location.coordinates.lat, brief.plannedOperatingSite.location.coordinates.lon)
    : null;
  const start = Date.parse(brief.missionWindow.start);
  const end = Date.parse(brief.missionWindow.end);
  const now = options.now ?? new Date();
  if (!coordinates || !Number.isFinite(start) || !Number.isFinite(end) || end < start || !Number.isFinite(now.getTime())) return { status: 'planned_coordinates_invalid', record: null, message: 'The retained planned site or mission window is invalid; no forecast request was made.' };
  const retrievedAtUtc = now.toISOString();
  const sourceUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coordinates.lat}&longitude=${coordinates.lon}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&forecast_days=16`;
  try {
    const response = await fetchWithTimeout(options.fetcher ?? fetch, options.timeoutMs ?? MISSION_FORECAST_PROVIDER_TIMEOUT_MS)(sourceUrl);
    if (!response.ok) return { status: 'provider_unavailable', record: null, message: 'The terrestrial forecast provider is unavailable.' };
    const body = await response.json() as Record<string, unknown>;
    const hourly = body.hourly;
    if (!isRecord(hourly) || !Array.isArray(hourly.time) || !Array.isArray(hourly.temperature_2m) || !Array.isArray(hourly.precipitation_probability) || !Array.isArray(hourly.wind_speed_10m) || !Array.isArray(hourly.wind_direction_10m) || !Array.isArray(hourly.weather_code)) return unusable();
    const periods: MissionForecastPeriod[] = [];
    for (let index = 0; index < hourly.time.length; index += 1) {
      const periodStart = typeof hourly.time[index] === 'string' ? parseProviderTimestamp(hourly.time[index] as string) : Number.NaN;
      const temperature = hourly.temperature_2m[index]; const precipitation = hourly.precipitation_probability[index]; const windSpeed = hourly.wind_speed_10m[index]; const windDirection = hourly.wind_direction_10m[index]; const weatherCode = hourly.weather_code[index]; const gust = Array.isArray(hourly.wind_gusts_10m) ? hourly.wind_gusts_10m[index] : undefined;
      if (!Number.isFinite(periodStart) || !finite(temperature) || !finite(precipitation) || !finite(windSpeed) || !finite(windDirection) || !finite(weatherCode) || (gust !== undefined && !finite(gust)) || precipitation < 0 || precipitation > 100 || windSpeed < 0 || windDirection < 0 || windDirection >= 360 || weatherCode < 0 || (gust !== undefined && gust < 0)) return unusable();
      if (periodStart > end || periodStart + 3_600_000 <= start) continue;
      periods.push({ startsAtUtc: new Date(periodStart).toISOString(), endsAtUtc: new Date(periodStart + 3_600_000).toISOString(), temperatureF: temperature, precipitationProbability: precipitation, windSpeedMph: windSpeed, windDirectionDegrees: windDirection, windDirection: directionLabel(windDirection), ...(gust === undefined ? {} : { windGustMph: gust }), weatherCode, condition: conditionLabel(weatherCode) });
    }
    if (periods.length === 0) return { status: 'outside_provider_horizon', record: null, message: 'The mission window is outside the terrestrial forecast provider horizon.' };
    return { status: 'live', message: 'Mission forecast retained.', record: { schemaVersion: 1, briefId: brief.briefId, activation: { program: brief.activation.program, reference: brief.activation.reference }, plannedSite: { latitude: coordinates.lat, longitude: coordinates.lon, provenance: brief.plannedOperatingSite.location.provenance }, missionWindow: { start: new Date(start).toISOString(), end: new Date(end).toISOString() }, provider: { id: MISSION_FORECAST_PROVIDER_ID, name: 'Open-Meteo', timezone: 'UTC' }, retrievedAtUtc, periods, status: 'live', sourceUrl, limitations: ['Hourly provider values are retained without interpolation.', 'Forecast data does not establish site access, safety, or operating legality.'], diagnostics: [], updatedAtUtc: retrievedAtUtc } };
  } catch { return { status: 'provider_unavailable', record: null, message: 'The terrestrial forecast provider could not be reached.' }; }
}

export function validateMissionForecastRecord(value: unknown): value is MissionForecastRecord {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.briefId !== 'string' || !isRecord(value.activation) || typeof value.activation.program !== 'string' || typeof value.activation.reference !== 'string' || !isRecord(value.plannedSite) || !finite(value.plannedSite.latitude) || value.plannedSite.latitude < -90 || value.plannedSite.latitude > 90 || !finite(value.plannedSite.longitude) || value.plannedSite.longitude < -180 || value.plannedSite.longitude > 180 || typeof value.plannedSite.provenance !== 'string' || !isRecord(value.missionWindow) || !timestamp(value.missionWindow.start) || !timestamp(value.missionWindow.end) || !isRecord(value.provider) || value.provider.id !== MISSION_FORECAST_PROVIDER_ID || value.provider.name !== 'Open-Meteo' || value.provider.timezone !== 'UTC' || !timestamp(value.retrievedAtUtc) || !Array.isArray(value.periods) || value.status !== 'live' || typeof value.sourceUrl !== 'string' || !Array.isArray(value.limitations) || !value.limitations.every(item => typeof item === 'string') || !Array.isArray(value.diagnostics) || !value.diagnostics.every(item => typeof item === 'string') || !timestamp(value.updatedAtUtc)) return false;
  return value.periods.every(period => isRecord(period) && timestamp(period.startsAtUtc) && timestamp(period.endsAtUtc) && finite(period.temperatureF) && finite(period.precipitationProbability) && period.precipitationProbability >= 0 && period.precipitationProbability <= 100 && finite(period.windSpeedMph) && period.windSpeedMph >= 0 && finite(period.windDirectionDegrees) && period.windDirectionDegrees >= 0 && period.windDirectionDegrees < 360 && typeof period.windDirection === 'string' && finite(period.weatherCode) && period.weatherCode >= 0 && typeof period.condition === 'string' && (period.windGustMph === undefined || (finite(period.windGustMph) && period.windGustMph >= 0)));
}
function unusable(): MissionForecastRetrieval { return { status: 'provider_unusable', record: null, message: 'The terrestrial forecast provider returned unusable data.' }; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function parseProviderTimestamp(value: string): number { return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`); }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function directionLabel(degrees: number): string { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8]; }
function conditionLabel(code: number): string { return code >= 95 ? 'Thunderstorm' : code >= 51 ? 'Precipitation/Rain' : code > 1 ? 'Cloudy' : 'Clear Sky'; }
function fetchWithTimeout(fetcher: typeof fetch, timeoutMs: number): typeof fetch { return async (input, init) => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { return await fetcher(input, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); } }; }