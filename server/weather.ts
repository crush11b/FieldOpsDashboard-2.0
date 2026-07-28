import type { NOAAAlert, WeatherData } from '../src/types';

export type ExternalDataStatus = 'live' | 'unavailable';

export interface WeatherApiResponse {
  readonly weather: WeatherData | null;
  readonly weatherStatus: ExternalDataStatus;
  readonly alerts: readonly NOAAAlert[] | null;
  readonly alertsStatus: ExternalDataStatus;
}

export interface WeatherCoordinates {
  readonly latitude: number;
  readonly longitude: number;
}

const NWS_HEADERS = {
  'User-Agent': 'FieldOpsDashboard/2.1.0 (contact@fieldops.radio)',
  Accept: 'application/geo+json',
};

export async function getWeatherApiResponse(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<WeatherApiResponse> {
  const [current, activeAlerts] = await Promise.all([
    getCurrentWeatherApiResponse(latitude, longitude, fetcher, now),
    getActiveAlertsApiResponse(latitude, longitude, fetcher, now),
  ]);

  return {
    ...current,
    ...activeAlerts,
  };
}

export async function getCurrentWeatherApiResponse(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<Pick<WeatherApiResponse, 'weather' | 'weatherStatus'>> {
  const coordinateLabel = `${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°`;
  const [locationName, weather] = await Promise.all([
    fetchLocationName(latitude, longitude, coordinateLabel, fetcher),
    fetchCurrentWeather(latitude, longitude, fetcher, now),
  ]);
  return {
    weather: weather ? { ...weather, locationName } : null,
    weatherStatus: weather ? 'live' : 'unavailable',
  };
}

export async function getActiveAlertsApiResponse(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<Pick<WeatherApiResponse, 'alerts' | 'alertsStatus'>> {
  const alerts = await fetchActiveAlerts(latitude, longitude, fetcher, now);
  return {
    alerts,
    alertsStatus: alerts ? 'live' : 'unavailable',
  };
}

export function parseWeatherCoordinates(latitude: unknown, longitude: unknown): WeatherCoordinates | null {
  const parsedLatitude = typeof latitude === 'string' && latitude.trim() !== '' ? Number(latitude) : NaN;
  const parsedLongitude = typeof longitude === 'string' && longitude.trim() !== '' ? Number(longitude) : NaN;
  return Number.isFinite(parsedLatitude) && parsedLatitude >= -90 && parsedLatitude <= 90
    && Number.isFinite(parsedLongitude) && parsedLongitude >= -180 && parsedLongitude <= 180
    ? { latitude: parsedLatitude, longitude: parsedLongitude }
    : null;
}

async function fetchLocationName(
  latitude: number,
  longitude: number,
  fallback: string,
  fetcher: typeof fetch,
): Promise<string> {
  try {
    const response = await fetcher(
      `https://api.weather.gov/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`,
      { headers: NWS_HEADERS },
    );
    if (!response.ok) return fallback;
    const body = await response.json() as Record<string, any>;
    const location = body.properties?.relativeLocation?.properties;
    return location?.city && location?.state ? `${location.city}, ${location.state}` : fallback;
  } catch {
    return fallback;
  }
}

async function fetchActiveAlerts(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch,
  now: Date,
): Promise<NOAAAlert[] | null> {
  try {
    const response = await fetcher(
      `https://api.weather.gov/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`,
      { headers: NWS_HEADERS },
    );
    if (!response.ok) return null;
    const body = await response.json() as Record<string, any>;
    if (!Array.isArray(body.features)) return null;
    const alerts: NOAAAlert[] = [];
    const seenIds = new Set<string>();
    for (const feature of body.features) {
      if (!isRecord(feature) || !isRecord(feature.properties)) return null;
      const properties = feature.properties;
      const id = stringValue(feature.id ?? properties.id);
      const title = stringValue(properties.event ?? properties.headline);
      const description = stringValue(properties.description ?? properties.headline);
      const area = stringValue(properties.areaDesc);
      if (!id || !title || !description || !area) return null;
      if (seenIds.has(id)) continue;
      const expiresAt = parseTimestamp(properties.expires);
      if (expiresAt !== null && expiresAt <= now.getTime()) continue;
      seenIds.add(id);
      alerts.push({
        id,
        severity: normalizeSeverity(properties.severity),
        title,
        description,
        area,
        expires: formatAlertTime(properties.expires, 'Until further notice'),
        issued: formatAlertTime(properties.onset ?? properties.sent, 'Recently'),
      });
    }
    return alerts;
  } catch {
    return null;
  }
}

async function fetchCurrentWeather(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch,
  now: Date,
): Promise<Omit<WeatherData, 'locationName'> | null> {
  try {
    const response = await fetcher(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,surface_pressure,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_hours=12`,
    );
    if (!response.ok) return null;
    const body = await response.json() as Record<string, any>;
    const current = body.current ?? body.current_weather;
    const tempF = finiteNumber(current?.temperature_2m ?? current?.temperature);
    const humidity = finiteNumber(current?.relative_humidity_2m);
    const pressureHpa = finiteNumber(current?.pressure_msl ?? current?.surface_pressure);
    const windMph = finiteNumber(current?.wind_speed_10m ?? current?.windspeed);
    const windDegrees = finiteNumber(current?.wind_direction_10m ?? current?.winddirection);
    const weatherCode = finiteNumber(current?.weather_code ?? current?.weathercode);
    const uvIndex = finiteNumber(current?.uv_index);
    if ([tempF, humidity, pressureHpa, windMph, windDegrees, weatherCode, uvIndex].some((value) => value === null)) {
      return null;
    }
    if (humidity! < 0 || humidity! > 100 || pressureHpa! <= 0 || windMph! < 0
      || weatherCode! < 0 || uvIndex! < 0) {
      return null;
    }

    const roundedTempF = Math.round(tempF!);
    const roundedHumidity = Math.round(humidity!);
    const windGust = finiteNumber(current?.wind_gusts_10m);
    return {
      tempF: roundedTempF,
      tempC: Math.round((roundedTempF - 32) * (5 / 9)),
      humidity: roundedHumidity,
      pressureInHg: Math.round(pressureHpa! * 0.02953 * 100) / 100,
      pressureHpa: Math.round(pressureHpa!),
      windMph: Math.round(windMph!),
      ...(windGust === null ? {} : { windGustMph: Math.round(windGust) }),
      windDir: directionLabel(windDegrees!),
      condition: conditionLabel(weatherCode!),
      icon: weatherCode! > 50 ? 'rain' : 'sun',
      dewPointF: Math.round(roundedTempF - ((100 - roundedHumidity) / 5) * 1.8),
      uvIndex: Math.round(uvIndex!),
      lastUpdated: now.toISOString(),
      cached: false,
      hourlyForecast: parseHourlyForecast(body.hourly, now),
    };
  } catch {
    return null;
  }
}

function parseHourlyForecast(hourly: Record<string, any> | undefined, now: Date) {
  if (!hourly || !Array.isArray(hourly.time)) return [];
  const start = Math.max(0, hourly.time.findIndex((time: string) => Date.parse(time) >= now.getTime() - 3_600_000));
  return hourly.time.slice(start, start + 6).flatMap((time: string, offset: number) => {
    if (typeof time !== 'string' || !Number.isFinite(Date.parse(time))) return [];
    const index = start + offset;
    const tempF = finiteNumber(hourly.temperature_2m?.[index]);
    const precipProb = finiteNumber(hourly.precipitation_probability?.[index]);
    const windMph = finiteNumber(hourly.wind_speed_10m?.[index]);
    const weatherCode = finiteNumber(hourly.weather_code?.[index]);
    if ([tempF, precipProb, windMph, weatherCode].some((value) => value === null)) return [];
    return [{
      time: new Date(time).toLocaleTimeString([], { hour: 'numeric' }),
      tempF: Math.round(tempF!),
      precipProb: Math.round(precipProb!),
      windMph: Math.round(windMph!),
      weatherCode: Math.round(weatherCode!),
    }];
  });
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function directionLabel(degrees: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normalized = ((degrees % 360) + 360) % 360;
  return directions[Math.round(normalized / 45) % directions.length];
}

function conditionLabel(code: number): string {
  return code > 50 ? 'Precipitation/Rain' : code > 0 ? 'Partly Cloudy' : 'Clear Sky';
}

function normalizeSeverity(value: unknown): NOAAAlert['severity'] {
  return value === 'Extreme' || value === 'Severe' || value === 'Minor' ? value : 'Moderate';
}

function formatAlertTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return fallback;
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
