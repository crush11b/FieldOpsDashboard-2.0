import express from 'express';
import type { WsjtxListener } from './wsjtx';

export function createWsjtxRouter(listener: WsjtxListener): express.Router {
  const router = express.Router();
  router.get('/api/wsjtx/current', (_request, response) => { response.setHeader('Cache-Control', 'no-store, max-age=0'); response.json({ kind: 'wsjtx_station_state', apiSnapshotAtUtc: new Date().toISOString(), ...listener.getSnapshot() }); });
  router.get('/api/wsjtx/diagnostics', (_request, response) => { response.setHeader('Cache-Control', 'no-store, max-age=0'); response.json({ kind: 'wsjtx_diagnostics', apiSnapshotAtUtc: new Date().toISOString(), ...listener.getDiagnostics() }); });
  return router;
}