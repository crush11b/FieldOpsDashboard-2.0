import express, { type Router } from 'express';
import type { ObservedRfService } from './observedRf';
import { createLiveBandActivity } from './liveBandActivity';
import { parseCoordinates } from '../src/location/coordinates';
import type { LocationTelemetry } from './locationTelemetryPipe';
import type { OperatingLocation } from '../src/location/operatingLocation';

export interface LiveBandActivityApiDependencies {
  readonly observedRf: Pick<ObservedRfService, 'setOperatingLocation' | 'getSnapshot'>;
  readonly readLocation: () => Promise<LocationTelemetry>;
}

export function createLiveBandActivityRouter(dependencies: LiveBandActivityApiDependencies): Router {
  const router = express.Router();
  router.get('/api/live-band-activity', async (_request, response) => {
    response.set('Cache-Control', 'no-store');
    try {
      const location = await dependencies.readLocation();
      const coordinates = parseCoordinates(location.latitude, location.longitude);
      dependencies.observedRf.setOperatingLocation(coordinates ? {
        coordinates,
        gridSquare: null,
        provenance: 'current',
        status: 'ok',
        source: { type: 'local_telemetry_agent' },
      } as OperatingLocation : null);
    } catch {
      dependencies.observedRf.setOperatingLocation(null);
    }
    response.json(createLiveBandActivity(dependencies.observedRf.getSnapshot()));
  });
  return router;
}
