import express, { type Router } from 'express';
import type { ActivationStore } from './activationStore';
import { qsoFingerprint, updateQso, isValidQsoId, type CreateQsoInput } from './qso';
import { exportQsos, parseAdif } from './qsoAdif';
import type { QsoStore } from './qsoStore';

export interface QsoApiOptions { readonly store: QsoStore; readonly activationStore: ActivationStore; readonly logger?: Pick<Console, 'warn'>; readonly now?: () => Date; }
export function createQsoRouter(options: QsoApiOptions): Router {
  const router = express.Router();
  router.get('/api/activations/:activationId/qsos', (request, response) => {
    const activation = options.activationStore.get(request.params.activationId); if (activation.status === 'notFound') return response.status(404).json(error('not_found', 'The Activation was not found.'));
    const result = options.store.listByActivation(request.params.activationId); if (io(result.diagnostics)) return response.status(503).json(error('persistence_unavailable', 'QSOs are temporarily unavailable.', result.diagnostics));
    return response.json({ kind: 'qsos', status: result.status, qsos: result.qsos, diagnostics: result.diagnostics });
  });
  router.post('/api/activations/:activationId/qsos', (request, response) => {
    if (!activationExists(options, request.params.activationId)) return response.status(404).json(error('not_found', 'The Activation was not found.'));
    try { const created = options.store.create({ ...request.body, activationId: request.params.activationId, source: 'manual' }); return response.status(201).json({ kind: 'qso', status: 'created', qso: created.qso, diagnostics: created.diagnostics }); }
    catch (cause) { return response.status(400).json(error('invalid_request', cause instanceof Error ? cause.message : 'The QSO request is invalid.')); }
  });
  router.patch('/api/activations/:activationId/qsos/:qsoId', (request, response) => {
    const existing = options.store.get(request.params.qsoId); if (existing.status === 'notFound' || existing.qso.activationId !== request.params.activationId) return response.status(404).json(error('not_found', 'The QSO was not found.'));
    try { const saved = options.store.save(updateQso(existing.qso, { ...request.body, activationId: request.params.activationId } as CreateQsoInput, { now: options.now })); return response.json({ kind: 'qso', status: 'updated', qso: saved.qso, diagnostics: saved.diagnostics }); }
    catch (cause) { return response.status(400).json(error('invalid_request', cause instanceof Error ? cause.message : 'The QSO request is invalid.')); }
  });
  router.delete('/api/activations/:activationId/qsos/:qsoId', (request, response) => {
    const result = options.store.get(request.params.qsoId); if (result.status === 'notFound' || result.qso.activationId !== request.params.activationId) return response.status(404).json(error('not_found', 'The QSO was not found.'));
    try { const deleted = options.store.delete(request.params.qsoId); return response.json({ kind: 'qso_deleted', qsoId: request.params.qsoId, diagnostics: deleted.diagnostics }); } catch { options.logger?.warn('QSO deletion failed.'); return response.status(503).json(error('persistence_unavailable', 'The QSO could not be deleted.')); }
  });
  router.post('/api/activations/:activationId/qsos/import', (request, response) => {
    if (!activationExists(options, request.params.activationId)) return response.status(404).json(error('not_found', 'The Activation was not found.'));
    const content = request.body?.content; if (typeof content !== 'string' || content.length > 5_000_000) return response.status(400).json(error('invalid_request', 'An ADIF file up to 5 MB is required.'));
    const parsed = parseAdif(content); const fingerprints = new Set(options.store.listByActivation(request.params.activationId).qsos.map(qsoFingerprint)); let imported = 0; let duplicates = 0; const errors = [...parsed.errors];
    for (const input of parsed.records) { const candidate = { ...input, activationId: request.params.activationId }; try { const created = options.store.create(candidate); const fingerprint = qsoFingerprint(created.qso); if (fingerprints.has(fingerprint)) { options.store.delete(created.qso.qsoId); duplicates++; } else { fingerprints.add(fingerprint); imported++; } } catch (cause) { errors.push(cause instanceof Error ? cause.message : 'A record could not be imported.'); } }
    return response.json({ kind: 'qso_import', recordsFound: parsed.recordsFound, imported, skipped: parsed.recordsFound - imported - duplicates, duplicates, errors });
  });
  router.get('/api/activations/:activationId/qsos/export', (request, response) => {
    const activationResult = options.activationStore.get(request.params.activationId); if (activationResult.status === 'notFound') return response.status(404).json(error('not_found', 'The Activation was not found.'));
    const result = options.store.listByActivation(request.params.activationId); if (io(result.diagnostics)) return response.status(503).json(error('persistence_unavailable', 'QSOs are temporarily unavailable.', result.diagnostics));
    const activation = activationResult.activation; const content = exportQsos(result.qsos, { type: activation.type, reference: activation.reference, myGridSquare: activation.plannedLocation?.gridSquare }); const safe = (activation.reference || activation.title || activation.activationId).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80); response.status(200).type('text/plain').set('Content-Disposition', `attachment; filename="fieldops-${safe || 'activation'}.adi"`).send(content);
  });
  return router;
}
function activationExists(options: QsoApiOptions, id: string): boolean { return options.activationStore.get(id).status === 'found'; }
function io(diagnostics: readonly { code: string }[]): boolean { return diagnostics.some(item => item.code === 'io_error'); }
function error(code: string, message: string, diagnostics: readonly unknown[] = []) { return { kind: 'qso_error', code, message, diagnostics }; }
