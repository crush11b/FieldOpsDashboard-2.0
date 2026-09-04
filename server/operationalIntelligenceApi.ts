import express, { type Router } from 'express';
import type { ActivationStore } from './activationStore';
import { OperationalIntelligenceStore } from './operationalIntelligenceStore';
import type { ObservedRfService } from './observedRf';

export interface OperationalIntelligenceApiOptions {
  readonly store: OperationalIntelligenceStore;
  readonly activationStore: ActivationStore;
  readonly observedRf: ObservedRfService;
}

export function createOperationalIntelligenceRouter(options: OperationalIntelligenceApiOptions): Router {
  const router = express.Router();
  router.get('/api/activations/:activationId/operational-intelligence', (request, response) => {
    const activation = options.activationStore.get(request.params.activationId);
    if (activation.status === 'notFound') { response.status(404).json(error('not_found', 'The Activation was not found.', activation.diagnostics)); return; }
    const result = options.store.list(request.params.activationId);
    if (hasIoError(result.diagnostics)) { response.status(503).json(error('persistence_unavailable', 'Operational intelligence is temporarily unavailable.', result.diagnostics)); return; }
    response.json({ kind: 'operational_intelligence', txContexts: result.txContexts, observations: result.observations, diagnostics: result.diagnostics });
  });
  router.put('/api/activations/:activationId/tx-context', (request, response) => {
    if (!activationExists(options.activationStore, request.params.activationId, response)) return;
    try { const result = options.store.openTxContext(request.params.activationId, request.body); response.status(201).json({ kind: 'tx_context', status: 'opened', context: result.context, diagnostics: result.diagnostics }); }
    catch (errorValue) { response.status(400).json(error('invalid_request', errorValue instanceof Error ? errorValue.message : 'The TX Context request is invalid.')); }
  });
  router.post('/api/activations/:activationId/tx-context/:segmentId/observations', (request, response) => {
    if (!activationExists(options.activationStore, request.params.activationId, response)) return;
    try { const result = options.store.captureObservation(request.params.activationId, request.params.segmentId, options.observedRf.getSnapshot()); response.status(201).json({ kind: 'station_signal_observation', status: 'captured', observation: result.observation, diagnostics: result.diagnostics }); }
    catch (errorValue) { response.status(404).json(error('not_found', errorValue instanceof Error ? errorValue.message : 'The TX Context segment was not found.')); }
  });
  return router;
}

function activationExists(store: ActivationStore, activationId: string, response: express.Response): boolean {
  const result = store.get(activationId);
  if (result.status !== 'found') { response.status(hasIoError(result.diagnostics) ? 503 : 404).json(error(hasIoError(result.diagnostics) ? 'persistence_unavailable' : 'not_found', hasIoError(result.diagnostics) ? 'Activations are temporarily unavailable.' : 'The Activation was not found.', result.diagnostics)); return false; }
  return true;
}
function hasIoError(diagnostics: readonly { readonly code: string }[]): boolean { return diagnostics.some(item => item.code === 'io_error'); }
function error(code: string, message: string, diagnostics: readonly unknown[] = []) { return { kind: 'operational_intelligence_error', code, message, diagnostics }; }