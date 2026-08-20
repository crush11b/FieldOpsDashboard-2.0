import express, { type Router } from 'express';
import { SotaSummitDataStore } from './sotaSummitDataStore';

export function createSotaSummitDataRouter(store: SotaSummitDataStore): Router {
  const router = express.Router();
  router.get('/api/sota-data/status', (_request, response) => {
    response.json({ kind: 'sota_data_status', ...store.status });
  });
  router.post('/api/sota-data/refresh', async (_request, response) => {
    const result = await store.refresh();
    response.status(result.status === 'refreshed' ? 200 : 503).json({ kind: 'sota_data_refresh', ...result });
  });
  return router;
}