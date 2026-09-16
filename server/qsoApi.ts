import express, { type Router } from 'express';
import type { ActivationStore } from './activationStore';
import { qsoFingerprint, updateQso, isValidQsoId, type CreateQsoInput } from './qso';
import { exportQsos, parseAdif } from './qsoAdif';
import type { QsoStore } from './qsoStore';
import { activeAssociations, normalizeAssociations } from './operationEntities';

export interface QsoApiOptions { readonly store: QsoStore; readonly activationStore: ActivationStore; readonly logger?: Pick<Console, 'warn'>; readonly now?: () => Date; }
export function createQsoRouter(options: QsoApiOptions): Router {
  const router = express.Router();
  router.get('/api/activations/:activationId/qsos', (request, response) => {
    const activation = options.activationStore.get(request.params.activationId); if (activation.status === 'notFound') return response.status(404).json(error('not_found', 'The Activation was not found.'));
    const result = options.store.listByActivation(request.params.activationId); if (io(result.diagnostics)) return response.status(503).json(error('persistence_unavailable', 'QSOs are temporarily unavailable.', result.diagnostics));
    return response.json({ kind: 'qsos', status: result.status, qsos: result.qsos, diagnostics: result.diagnostics });
  });
  router.post('/api/activations/:activationId/qsos', (request, response) => {
    const activation = options.activationStore.get(request.params.activationId); if (activation.status === 'notFound') return response.status(404).json(error('not_found', 'The Activation was not found.'));
    try { const created = options.store.create({ ...request.body, activationId: request.params.activationId, entityAssociations: activation.activation.entityState ? activeAssociations(activation.activation.entityState) : undefined, source: 'manual' }); return response.status(201).json({ kind: 'qso', status: 'created', qso: created.qso, diagnostics: created.diagnostics }); }
    catch (cause) { return response.status(400).json(error('invalid_request', cause instanceof Error ? cause.message : 'The QSO request is invalid.')); }
  });
  router.patch('/api/activations/:activationId/qsos/:qsoId', (request, response) => {
    const existing = options.store.get(request.params.qsoId); if (existing.status === 'notFound' || existing.qso.activationId !== request.params.activationId) return response.status(404).json(error('not_found', 'The QSO was not found.'));
    try { const body = request.body?.entityAssociations === undefined ? request.body : { ...request.body, entityAssociations: normalizeAssociations({ schemaVersion: 1, entities: request.body.entityAssociations.entities.map((item: unknown) => ({ ...(item as object), source: 'operator_edit' })) }) }; const saved = options.store.save(updateQso(existing.qso, { ...body, activationId: request.params.activationId } as CreateQsoInput, { now: options.now })); return response.json({ kind: 'qso', status: 'updated', qso: saved.qso, diagnostics: saved.diagnostics }); }
    catch (cause) { return response.status(400).json(error('invalid_request', cause instanceof Error ? cause.message : 'The QSO request is invalid.')); }
  });
  router.delete('/api/activations/:activationId/qsos/:qsoId', (request, response) => {
    const result = options.store.get(request.params.qsoId); if (result.status === 'notFound' || result.qso.activationId !== request.params.activationId) return response.status(404).json(error('not_found', 'The QSO was not found.'));
    try { const deleted = options.store.delete(request.params.qsoId); return response.json({ kind: 'qso_deleted', qsoId: request.params.qsoId, diagnostics: deleted.diagnostics }); } catch { options.logger?.warn('QSO deletion failed.'); return response.status(503).json(error('persistence_unavailable', 'The QSO could not be deleted.')); }
  });
  router.post('/api/activations/:activationId/qsos/import', (request, response) => {
    const activation = options.activationStore.get(request.params.activationId); if (activation.status === 'notFound') return response.status(404).json(error('not_found', 'The Activation was not found.'));
    const content = request.body?.content; if (typeof content !== 'string' || content.length > 5_000_000) return response.status(400).json(error('invalid_request', 'An ADIF file up to 5 MB is required.'));
    const parsed = parseAdif(content); const existing = options.store.listByActivation(request.params.activationId).qsos; const byFingerprint = new Map(existing.map(qso => [qsoFingerprint(qso), qso])); let imported = 0; let duplicates = 0; const errors = [...parsed.errors];
    for (const input of parsed.records) { try { const importedAssociations = normalizeAssociations(undefined, { potaRef: input.potaRef, sotaRef: input.sotaRef }); const associations = importedAssociations.entities.length ? { schemaVersion: 1 as const, entities: importedAssociations.entities.map(item => ({ ...item, source: 'adif_import' as const })) } : activation.activation.entityState ? activeAssociations(activation.activation.entityState, 'adif_import') : importedAssociations; const candidate = { ...input, activationId: request.params.activationId, entityAssociations: associations }; const diagnostic = options.store.create(candidate); const fingerprint = qsoFingerprint(diagnostic.qso); const duplicate = byFingerprint.get(fingerprint); if (duplicate) { options.store.delete(diagnostic.qso.qsoId); const merged = normalizeAssociations({ schemaVersion: 1, entities: [...duplicate.entityAssociations.entities, ...diagnostic.qso.entityAssociations.entities] }); if (JSON.stringify(merged) !== JSON.stringify(duplicate.entityAssociations)) options.store.save({ ...duplicate, entityAssociations: merged, updatedAtUtc: (options.now ?? (() => new Date()))().toISOString() }); duplicates++; } else { byFingerprint.set(fingerprint, diagnostic.qso); imported++; } } catch (cause) { errors.push(cause instanceof Error ? cause.message : 'A record could not be imported.'); } }
    return response.json({ kind: 'qso_import', recordsFound: parsed.recordsFound, imported, skipped: parsed.recordsFound - imported - duplicates, duplicates, errors });
  });
  router.get('/api/activations/:activationId/qsos/export', (request, response) => {
    const activationResult = options.activationStore.get(request.params.activationId); if (activationResult.status === 'notFound') return response.status(404).json(error('not_found', 'The Activation was not found.'));
    const result = options.store.listByActivation(request.params.activationId); if (io(result.diagnostics)) return response.status(503).json(error('persistence_unavailable', 'QSOs are temporarily unavailable.', result.diagnostics));
    if (result.qsos.some(qso => countProgram(qso.entityAssociations.entities, 'POTA') > 1 || countProgram(qso.entityAssociations.entities, 'SOTA') > 1)) return response.status(409).json(error('multi_reference_export_unresolved', 'This log contains multiple references for one program. FieldOps will not silently omit them; program-specific export semantics require approval.'));
    const activation = activationResult.activation; const projected = result.qsos.map(qso => ({ ...qso, potaRef: qso.entityAssociations.entities.find(item => item.program === 'POTA')?.reference, sotaRef: qso.entityAssociations.entities.find(item => item.program === 'SOTA')?.reference })); const content = exportQsos(projected, { type: activation.type, reference: activation.reference, myGridSquare: activation.plannedLocation?.gridSquare }); const safe = (activation.reference || activation.title || activation.activationId).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80); response.status(200).type('text/plain').set('Content-Disposition', `attachment; filename="fieldops-${safe || 'activation'}.adi"`).send(content);
  });
  return router;
}
function activationExists(options: QsoApiOptions, id: string): boolean { return options.activationStore.get(id).status === 'found'; }
function io(diagnostics: readonly { code: string }[]): boolean { return diagnostics.some(item => item.code === 'io_error'); }
function error(code: string, message: string, diagnostics: readonly unknown[] = []) { return { kind: 'qso_error', code, message, diagnostics }; }
function countProgram(values: readonly { program: string }[], program: string): number { return values.filter(item => item.program === program).length; }
