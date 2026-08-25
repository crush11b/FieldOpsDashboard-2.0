import { Router } from 'express';
import { readClockStatusPipe, readGnssTimePipe, synchronizeClockPipe } from './locationTelemetryPipe';

export function createClockRouter(): Router {
  const router = Router();
  router.get('/api/clock/status', async (_request, response) => response.json(await readClockStatusPipe()));
  router.get('/api/clock/gnss', async (_request, response) => response.json(await readGnssTimePipe()));
  router.post('/api/clock/synchronize', async (request, response) => response.json(await synchronizeClockPipe(request.body?.confirmed === true)));
  return router;
}