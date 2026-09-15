import { parseCoordinates, type Coordinates } from './coordinates';

export type MaidenheadPrecision = 4 | 6 | 8;

export interface MaidenheadCell {
  readonly locator: string;
  readonly center: Coordinates;
  readonly longitudeSpanDegrees: number;
  readonly latitudeSpanDegrees: number;
}

const LOCATOR_PATTERN = /^[A-Ra-r]{2}[0-9]{2}(?:[A-Xa-x]{2}(?:[0-9]{2})?)?$/;
const UPPER_BOUND_EPSILON = 1e-10;

export function coordinatesToMaidenhead(
  latitude: number,
  longitude: number,
  precision: MaidenheadPrecision = 6,
): string | null {
  const coordinates = parseCoordinates(latitude, longitude);
  if (!coordinates || ![4, 6, 8].includes(precision)) return null;

  let adjustedLongitude = Math.min(coordinates.lon, 180 - UPPER_BOUND_EPSILON) + 180;
  let adjustedLatitude = Math.min(coordinates.lat, 90 - UPPER_BOUND_EPSILON) + 90;

  const longitudeField = Math.floor(adjustedLongitude / 20);
  const latitudeField = Math.floor(adjustedLatitude / 10);
  adjustedLongitude -= longitudeField * 20;
  adjustedLatitude -= latitudeField * 10;

  const longitudeSquare = Math.floor(adjustedLongitude / 2);
  const latitudeSquare = Math.floor(adjustedLatitude);
  let locator = `${String.fromCharCode(65 + longitudeField)}${String.fromCharCode(65 + latitudeField)}${longitudeSquare}${latitudeSquare}`;
  if (precision === 4) return locator;

  adjustedLongitude -= longitudeSquare * 2;
  adjustedLatitude -= latitudeSquare;
  const longitudeSubsquare = Math.floor(adjustedLongitude * 12);
  const latitudeSubsquare = Math.floor(adjustedLatitude * 24);
  locator += `${String.fromCharCode(97 + longitudeSubsquare)}${String.fromCharCode(97 + latitudeSubsquare)}`;
  if (precision === 6) return locator;

  adjustedLongitude -= longitudeSubsquare / 12;
  adjustedLatitude -= latitudeSubsquare / 24;
  const longitudeExtendedSquare = Math.min(9, Math.floor(adjustedLongitude * 120));
  const latitudeExtendedSquare = Math.min(9, Math.floor(adjustedLatitude * 240));
  return `${locator}${longitudeExtendedSquare}${latitudeExtendedSquare}`;
}

export function normalizeMaidenhead(locator: string): string | null {
  const compact = locator.trim();
  if (!LOCATOR_PATTERN.test(compact)) return null;
  return `${compact.slice(0, 2).toUpperCase()}${compact.slice(2, 4)}${compact.slice(4, 6).toLowerCase()}${compact.slice(6, 8)}`;
}

export function maidenheadToCell(locator: string): MaidenheadCell | null {
  const normalized = normalizeMaidenhead(locator);
  if (!normalized) return null;

  let longitude = (normalized.charCodeAt(0) - 65) * 20 - 180;
  let latitude = (normalized.charCodeAt(1) - 65) * 10 - 90;
  longitude += Number(normalized[2]) * 2;
  latitude += Number(normalized[3]);
  let longitudeSpanDegrees = 2;
  let latitudeSpanDegrees = 1;

  if (normalized.length >= 6) {
    longitude += (normalized.charCodeAt(4) - 97) / 12;
    latitude += (normalized.charCodeAt(5) - 97) / 24;
    longitudeSpanDegrees = 1 / 12;
    latitudeSpanDegrees = 1 / 24;
  }

  if (normalized.length === 8) {
    longitude += Number(normalized[6]) / 120;
    latitude += Number(normalized[7]) / 240;
    longitudeSpanDegrees = 1 / 120;
    latitudeSpanDegrees = 1 / 240;
  }

  return {
    locator: normalized,
    center: {
      lat: latitude + latitudeSpanDegrees / 2,
      lon: longitude + longitudeSpanDegrees / 2,
    },
    longitudeSpanDegrees,
    latitudeSpanDegrees,
  };
}
