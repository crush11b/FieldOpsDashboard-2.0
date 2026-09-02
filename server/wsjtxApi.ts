import express from 'express';
import type { WsjtxListener } from './wsjtx';

export function createWsjtxRouter(listener: WsjtxListener): express.Router {
  const router = express.Router();
  let currentRequestId = 0;
  router.get('/api/wsjtx/current', (_request, response) => { const requestId = ++currentRequestId; const receivedAtUtc = new Date().toISOString(); listener.recordCurrentRequest(requestId, receivedAtUtc); response.setHeader('Cache-Control', 'no-store, max-age=0'); const producedAtUtc = new Date().toISOString(); listener.recordCurrentResponse(producedAtUtc); response.json({ kind: 'wsjtx_station_state', apiSnapshotAtUtc: producedAtUtc, timing: { requestId, requestReceivedAtUtc: receivedAtUtc, responseProducedAtUtc: producedAtUtc }, ...listener.getSnapshot() }); });
  router.get('/api/wsjtx/diagnostics', (_request, response) => { response.setHeader('Cache-Control', 'no-store, max-age=0'); response.json({ kind: 'wsjtx_diagnostics', apiSnapshotAtUtc: new Date().toISOString(), ...listener.getDiagnostics() }); });
  return router;
}