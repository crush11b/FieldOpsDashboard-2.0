import express from 'express';
import type { WsjtxListener } from './wsjtx';

export function createWsjtxRouter(listener: WsjtxListener): express.Router {
  const router = express.Router();
  router.get('/api/wsjtx/current', (_request, response) => response.json({ kind: 'wsjtx_station_state', ...listener.getSnapshot() }));
  return router;
}