import type { GPSProvenance, GPSStatus } from '../types';
import type { TelemetrySource, TelemetryStatus, TelemetryTimestamps } from '../telemetry';
import {
  classifyCoordinateProvenance,
  parseCoordinates,
  type CoordinateProvenance,
  type Coordinates,
} from './coordinates';
import { latLonToGridSquare } from '../types';

export interface OperatingLocation {
  readonly coordinates: Coordinates | null;
  readonly gridSquare: string | null;
  readonly provenance: CoordinateProvenance;
  readonly status: TelemetryStatus;
  readonly source: TelemetrySource;
  readonly timestamps?: TelemetryTimestamps;
  readonly planningSemantics?: 'provider_reference_default' | 'operator_selected_current_device';
}

export function resolveOperatingLocation(
  gps: Pick<GPSStatus, 'lat' | 'lon' | 'gridSquare'>,
  provenance: GPSProvenance,
): OperatingLocation {
  const coordinates = parseCoordinates(gps.lat, gps.lon);
  const coordinateProvenance = classifyCoordinateProvenance(provenance);
  const usableCoordinates = coordinates && coordinateProvenance !== 'unavailable' ? coordinates : null;

  return {
    coordinates: usableCoordinates,
    gridSquare: usableCoordinates
      ? latLonToGridSquare(usableCoordinates.lat, usableCoordinates.lon)
      : null,
    provenance: usableCoordinates ? coordinateProvenance : 'unavailable',
    status: provenance.status,
    source: provenance.source,
    timestamps: provenance.timestamps,
  };
}
