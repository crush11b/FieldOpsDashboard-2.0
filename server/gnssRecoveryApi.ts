import { Router } from 'express';
import { recoverGnssPipe } from './locationTelemetryPipe';

export function createGnssRecoveryRouter(): Router {
  const router = Router();
  router.post('/api/location/recover', async (_request, response) => response.json(await recoverGnssPipe()));
  return router;
}