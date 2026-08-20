import type { GPSProvenance, GPSStatus } from '../types';
import { toFiniteNumber } from '../utils/numbers';

export interface Coordinates {
  readonly lat: number;
  readonly lon: number;
}

export type CoordinateProvenance = 'current' | 'manual' | 'stale' | 'unavailable';

export interface ProvenancedCoordinates extends Coordinates {
  readonly provenance: Exclude<CoordinateProvenance, 'unavailable'>;
}

export function parseCoordinates(latitude: unknown, longitude: unknown): Coordinates | null {
  const lat = parseCoordinateValue(latitude);
  const lon = parseCoordinateValue(longitude);
  return lat !== null && lat >= -90 && lat <= 90
    && lon !== null && lon >= -180 && lon <= 180
    ? { lat, lon }
    : null;
}

export function parseGpsRequestCoordinates(
  body: Readonly<Record<string, unknown>>,
  query: Readonly<Record<string, unknown>>,
): Coordinates | null {
  return parseCoordinates(
    body.lat ?? body.latitude ?? query.lat ?? query.latitude,
    body.lon ?? body.lng ?? body.longitude ?? query.lon ?? query.lng ?? query.longitude,
  );
}

export function classifyCoordinateProvenance(provenance: GPSProvenance): CoordinateProvenance {
  if (provenance.status === 'cached') {
    return provenance.source.type === 'cached_local_storage' ? 'stale' : 'unavailable';
  }
  if (provenance.status === 'stale') {
    return provenance.source.type === 'browser_geolocation'
      || provenance.source.type === 'serial_nmea'
      || provenance.source.type === 'local_telemetry_agent'
      ? 'stale'
      : 'unavailable';
  }
  if (provenance.status === 'ok') {
    return provenance.source.type === 'browser_geolocation'
      || provenance.source.type === 'serial_nmea'
      || provenance.source.type === 'local_telemetry_agent'
      ? 'current'
      : 'unavailable';
  }
  if (provenance.status !== 'degraded') return 'unavailable';

  switch (provenance.source.type) {
    case 'manual_location':
    case 'preset_location':
    case 'configured_station_location':
      return 'manual';
    default:
      return 'unavailable';
  }
}

export function resolveGpsCoordinates(
  gps: Pick<GPSStatus, 'lat' | 'lon'>,
  provenance: GPSProvenance,
): ProvenancedCoordinates | null {
  const coordinates = parseCoordinates(gps.lat, gps.lon);
  const coordinateProvenance = classifyCoordinateProvenance(provenance);
  return coordinates && coordinateProvenance !== 'unavailable'
    ? { ...coordinates, provenance: coordinateProvenance }
    : null;
}

export function isCurrentOperatingLocation(
  location: ProvenancedCoordinates | null,
): location is ProvenancedCoordinates & { provenance: 'current' | 'manual' } {
  return location?.provenance === 'current' || location?.provenance === 'manual';
}

function parseCoordinateValue(value: unknown): number | null {
  return toFiniteNumber(value);
}
