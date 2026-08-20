import type { Coordinates } from '../location/coordinates';
import { calculateDistanceKm } from '../location/geography';

export const WEATHER_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
export const NOAA_ALERT_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
export const WEATHER_LOCATION_MOVEMENT_THRESHOLD_KM = 1;

export function hasMeaningfulWeatherMovement(
  previous: Coordinates | null,
  next: Coordinates,
): boolean {
  return previous === null
    || calculateDistanceKm(previous, next) >= WEATHER_LOCATION_MOVEMENT_THRESHOLD_KM;
}