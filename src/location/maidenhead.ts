import { parseCoordinates, type Coordinates } from './coordinates';

export type MaidenheadPrecision = 4 | 6 | 8;

export interface MaidenheadBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

export interface MaidenheadLocation {
  readonly locator: string;
  readonly precision: MaidenheadPrecision;
  readonly center: Coordinates;
  readonly bounds: MaidenheadBounds;
  readonly latitudeSpanDegrees: number;
  readonly longitudeSpanDegrees: number;
}

const FIELD_COUNT = 18;
const SUBSQUARE_COUNT = 24;
const UPPER_LATITUDE_EXCLUSIVE = 90 - 1e-12;
const UPPER_LONGITUDE_EXCLUSIVE = 180 - 1e-12;

const LOCATOR_PATTERNS: Readonly<Record<MaidenheadPrecision, RegExp>> = {
  4: /^[A-Ra-r]{2}[0-9]{2}$/,
  6: /^[A-Ra-r]{2}[0-9]{2}[A-Xa-x]{2}$/,
  8: /^[A-Ra-r]{2}[0-9]{2}[A-Xa-x]{2}[0-9]{2}$/,
};

export function latLonToMaidenhead(
  latitude: number,
  longitude: number,
  precision: MaidenheadPrecision = 6,
): string {
  const coordinates = parseCoordinates(latitude, longitude);
  if (!coordinates || !isMaidenheadPrecision(precision)) return '';

  // Geographic coordinates include +90/+180; Maidenhead cells use exclusive
  // upper bounds. Put those exact boundary points in the final valid cell.
  const lat = Math.min(coordinates.lat, UPPER_LATITUDE_EXCLUSIVE);
  const lon = Math.min(coordinates.lon, UPPER_LONGITUDE_EXCLUSIVE);
  let adjustedLon = lon + 180;
  let adjustedLat = lat + 90;

  const fieldLon = Math.floor(adjustedLon / 20);
  const fieldLat = Math.floor(adjustedLat / 10);
  let locator = `${letter(fieldLon, true)}${letter(fieldLat, true)}`;

  adjustedLon -= fieldLon * 20;
  adjustedLat -= fieldLat * 10;
  const squareLon = Math.floor(adjustedLon / 2);
  const squareLat = Math.floor(adjustedLat);
  locator += `${squareLon}${squareLat}`;
  if (precision === 4) return locator;

  adjustedLon -= squareLon * 2;
  adjustedLat -= squareLat;
  const subsquareLongitudeSpan = 2 / SUBSQUARE_COUNT;
  const subsquareLatitudeSpan = 1 / SUBSQUARE_COUNT;
  const subsquareLon = Math.floor(adjustedLon / subsquareLongitudeSpan);
  const subsquareLat = Math.floor(adjustedLat / subsquareLatitudeSpan);
  locator += `${letter(subsquareLon, false)}${letter(subsquareLat, false)}`;
  if (precision === 6) return locator;

  adjustedLon -= subsquareLon * subsquareLongitudeSpan;
  adjustedLat -= subsquareLat * subsquareLatitudeSpan;
  const extendedLon = Math.floor(adjustedLon / (subsquareLongitudeSpan / 10));
  const extendedLat = Math.floor(adjustedLat / (subsquareLatitudeSpan / 10));
  return `${locator}${extendedLon}${extendedLat}`;
}

export function maidenheadToLocation(value: string): MaidenheadLocation | null {
  const locator = value.trim();
  const precision = locator.length as MaidenheadPrecision;
  if (!isMaidenheadPrecision(precision) || !LOCATOR_PATTERNS[precision].test(locator)) return null;

  const fieldLon = locator.toUpperCase().charCodeAt(0) - 65;
  const fieldLat = locator.toUpperCase().charCodeAt(1) - 65;
  if (fieldLon < 0 || fieldLon >= FIELD_COUNT || fieldLat < 0 || fieldLat >= FIELD_COUNT) return null;

  let west = -180 + fieldLon * 20 + Number(locator[2]) * 2;
  let south = -90 + fieldLat * 10 + Number(locator[3]);
  let longitudeSpanDegrees = 2;
  let latitudeSpanDegrees = 1;

  if (precision >= 6) {
    longitudeSpanDegrees /= SUBSQUARE_COUNT;
    latitudeSpanDegrees /= SUBSQUARE_COUNT;
    west += (locator.toLowerCase().charCodeAt(4) - 97) * longitudeSpanDegrees;
    south += (locator.toLowerCase().charCodeAt(5) - 97) * latitudeSpanDegrees;
  }

  if (precision === 8) {
    longitudeSpanDegrees /= 10;
    latitudeSpanDegrees /= 10;
    west += Number(locator[6]) * longitudeSpanDegrees;
    south += Number(locator[7]) * latitudeSpanDegrees;
  }

  const canonicalLocator = precision >= 6
    ? `${locator.slice(0, 2).toUpperCase()}${locator.slice(2, 4)}${locator.slice(4, 6).toLowerCase()}${locator.slice(6)}`
    : locator.toUpperCase();
  const bounds = {
    south,
    west,
    north: south + latitudeSpanDegrees,
    east: west + longitudeSpanDegrees,
  };

  return {
    locator: canonicalLocator,
    precision,
    center: {
      lat: (bounds.south + bounds.north) / 2,
      lon: (bounds.west + bounds.east) / 2,
    },
    bounds,
    latitudeSpanDegrees,
    longitudeSpanDegrees,
  };
}

export function maidenheadToCenter(locator: string): Coordinates | null {
  return maidenheadToLocation(locator)?.center ?? null;
}

export function isMaidenheadLocator(
  value: string,
  precisions: readonly MaidenheadPrecision[] = [4, 6, 8],
): boolean {
  const precision = value.trim().length as MaidenheadPrecision;
  return precisions.includes(precision) && maidenheadToLocation(value) !== null;
}

// Compatibility names for existing callers while all calculations route through
// this shared domain implementation.
export function latLonToGridSquare(lat: number, lon: number): string {
  return latLonToMaidenhead(lat, lon, 6);
}

export function gridSquareToLatLon(grid: string): Coordinates | null {
  return maidenheadToCenter(grid);
}

function isMaidenheadPrecision(value: number): value is MaidenheadPrecision {
  return value === 4 || value === 6 || value === 8;
}

function letter(index: number, uppercase: boolean): string {
  return String.fromCharCode((uppercase ? 65 : 97) + index);
}
