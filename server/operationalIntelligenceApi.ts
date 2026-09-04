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
    if (result.status === 'invalid' || result.status === 'ioError') { response.status(503).json(error('persistence_unavailable', 'Operational intelligence is temporarily unavailable.', result.diagnostics)); return; }
    response.json({ kind: 'operational_intelligence', txContexts: result.txContexts, observations: result.observations, diagnostics: result.diagnostics });
  });
  router.put('/api/activations/:activationId/tx-context', (request, response) => {
    const activation = getActivation(options.activationStore, request.params.activationId, response);
    if (!activation) return;
    if (activation.status !== 'active') { response.status(409).json(error('invalid_lifecycle', 'The Activation must be active to open a TX Context.')); return; }
    try { const result = options.store.openTxContext(activation, request.body); response.status(201).json({ kind: 'tx_context', status: 'opened', context: result.context, diagnostics: result.diagnostics }); }
    catch (errorValue) { respondStoreError(response, errorValue, 'The TX Context request is invalid.'); }
  });
  router.post('/api/activations/:activationId/tx-context/:segmentId/observations', (request, response) => {
    const activation = getActivation(options.activationStore, request.params.activationId, response);
    if (!activation) return;
    if (activation.status !== 'active') { response.status(409).json(error('invalid_lifecycle', 'The Activation must be active to capture an observation.')); return; }
    try { const result = options.store.captureObservation(activation, request.params.segmentId, options.observedRf.getSnapshot()); response.status(201).json({ kind: 'station_signal_observation', status: 'captured', observation: result.observation, diagnostics: result.diagnostics }); }
    catch (errorValue) { respondStoreError(response, errorValue, 'The observation could not be captured.'); }
  });
  return router;
}

function getActivation(store: ActivationStore, activationId: string, response: express.Response) {
  const result = store.get(activationId);
  if (result.status !== 'found') { response.status(hasIoError(result.diagnostics) ? 503 : 404).json(error(hasIoError(result.diagnostics) ? 'persistence_unavailable' : 'not_found', hasIoError(result.diagnostics) ? 'Activations are temporarily unavailable.' : 'The Activation was not found.', result.diagnostics)); return null; }
  return result.activation;
}
function respondStoreError(response: express.Response, value: unknown, fallback: string): void { const code = value && typeof value === 'object' && 'operationalCode' in value ? String(value.operationalCode) : 'invalid_request'; const status = code === 'not_found' ? 404 : code === 'invalid_lifecycle' || code === 'closed_segment' || code === 'non_overlapping_interval' ? 409 : code === 'invalid_callsign' ? 422 : code === 'observed_rf_unavailable' || code === 'storage_unavailable' ? 503 : 422; response.status(status).json(error(code, value instanceof Error ? value.message : fallback)); }
function hasIoError(diagnostics: readonly { readonly code: string }[]): boolean { return diagnostics.some(item => item.code === 'io_error'); }
function error(code: string, message: string, diagnostics: readonly unknown[] = []) { return { kind: 'operational_intelligence_error', code, message, diagnostics }; }
