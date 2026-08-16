import type { Coordinates } from './coordinates';

export type SolarEventName =
  | 'astronomicalDawn'
  | 'nauticalDawn'
  | 'civilDawn'
  | 'sunrise'
  | 'sunset'
  | 'civilDusk'
  | 'nauticalDusk'
  | 'astronomicalDusk';

export interface SolarEvents {
  readonly date: string;
  readonly events: Readonly<Record<SolarEventName, Date | null>>;
}

const ZENITHS: Readonly<Record<SolarEventName, number>> = {
  astronomicalDawn: 108,
  nauticalDawn: 102,
  civilDawn: 96,
  sunrise: 90.833,
  sunset: 90.833,
  civilDusk: 96,
  nauticalDusk: 102,
  astronomicalDusk: 108,
};

export function parseSolarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  return new Date(timestamp).toISOString().slice(0, 10) === value ? value : null;
}

export function calculateSolarEvents(coordinates: Coordinates, dateValue: unknown): SolarEvents | null {
  const date = parseSolarDate(dateValue);
  if (!date) return null;

  const [year, month, day] = date.split('-').map(Number);
  const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86_400_000);
  const solarNoon = solarNoonUtcMinutes(coordinates.lon, dayOfYear);
  const events = {} as Record<SolarEventName, Date | null>;

  for (const eventName of Object.keys(ZENITHS) as SolarEventName[]) {
    const hourAngle = hourAngleDegrees(coordinates.lat, solarDeclination(dayOfYear), ZENITHS[eventName]);
    if (hourAngle === null) {
      events[eventName] = null;
      continue;
    }
    const minutes = eventName.endsWith('Dawn') || eventName === 'sunrise'
      ? solarNoon - hourAngle * 4
      : solarNoon + hourAngle * 4;
    events[eventName] = new Date(Date.UTC(year, month - 1, day) + minutes * 60_000);
  }

  return { date, events };
}

function solarNoonUtcMinutes(longitude: number, dayOfYear: number): number {
  return 720 - 4 * longitude - equationOfTime(dayOfYear);
}

function equationOfTime(dayOfYear: number): number {
  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1 + 0.5);
  return 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
}

function solarDeclination(dayOfYear: number): number {
  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1 + 0.5);
  return 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
}

function hourAngleDegrees(latitude: number, declination: number, zenith: number): number | null {
  const latitudeRadians = toRadians(latitude);
  const cosine = (Math.cos(toRadians(zenith)) - Math.sin(latitudeRadians) * Math.sin(declination))
    / (Math.cos(latitudeRadians) * Math.cos(declination));
  if (cosine > 1 || cosine < -1) return null;
  return toDegrees(Math.acos(cosine));
}

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function toDegrees(radians: number): number {
  return radians * 180 / Math.PI;
}