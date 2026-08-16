import type { Coordinates } from './coordinates';

const EARTH_RADIUS_KM = 6371;
const MILES_PER_KILOMETER = 0.621371;
// Five meters suppresses meaningless sub-meter GPS jitter without hiding nearby targets.
const SAME_POINT_DISTANCE_THRESHOLD_KM = 0.005;

export function calculateDistanceKm(origin: Coordinates, destination: Coordinates): number {
  const latitudeDelta = toRadians(destination.lat - origin.lat);
  const longitudeDelta = toRadians(destination.lon - origin.lon);
  const originLatitude = toRadians(origin.lat);
  const destinationLatitude = toRadians(destination.lat);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(destinationLatitude)
    * Math.sin(longitudeDelta / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function calculateDistanceMiles(origin: Coordinates, destination: Coordinates): number {
  return calculateDistanceKm(origin, destination) * MILES_PER_KILOMETER;
}

export function calculateInitialBearing(origin: Coordinates, destination: Coordinates): number | null {
  if (areSamePoint(origin, destination)) return null;

  const originLatitude = toRadians(origin.lat);
  const destinationLatitude = toRadians(destination.lat);
  const longitudeDelta = toRadians(destination.lon - origin.lon);
  const y = Math.sin(longitudeDelta) * Math.cos(destinationLatitude);
  const x = Math.cos(originLatitude) * Math.sin(destinationLatitude)
    - Math.sin(originLatitude) * Math.cos(destinationLatitude) * Math.cos(longitudeDelta);

  return normalizeBearing(toDegrees(Math.atan2(y, x)));
}

export function compassDirection(bearing: number | null): string {
  if (bearing === null || !Number.isFinite(bearing)) return 'N/A';
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions[Math.round(normalizeBearing(bearing) / 45) % directions.length];
}

export function areSamePoint(origin: Coordinates, destination: Coordinates): boolean {
  return calculateDistanceKm(origin, destination) <= SAME_POINT_DISTANCE_THRESHOLD_KM;
}

function normalizeBearing(bearing: number): number {
  return (bearing + 360) % 360;
}

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function toDegrees(radians: number): number {
  return radians * 180 / Math.PI;
}