import express, { type Router } from 'express';
import type { SmartDeployBrief } from './smartDeployBrief';
import { ACTIVATION_STATUSES, ACTIVATION_TYPES, updateActivationStatus, validateOperatingObjective, type Activation, type ActivationStatus } from './activation';
import type { ActivationStore, ActivationStoreReadResult } from './activationStore';
import type { ActivationNotesStore } from './activationNotesStore';
import type { SmartDeployBriefStore } from './smartDeployBriefStore';

export interface ActivationApiOptions { readonly store: ActivationStore; readonly briefStore: SmartDeployBriefStore; readonly notesStore: ActivationNotesStore; readonly logger?: Pick<Console, 'warn'>; readonly now?: () => Date; }

export function createActivationRouter(options: ActivationApiOptions): Router {
  const router = express.Router();
  router.get('/api/activations', (_request, response) => {
    const result = options.store.list();
    if (hasIoError(result)) { response.status(503).json(error('persistence_unavailable', 'Activations are temporarily unavailable.', result.diagnostics)); return; }
    response.json({ kind: 'activations', status: result.status, activations: result.activations, diagnostics: result.diagnostics });
  });
  router.get('/api/activations/:activationId', (request, response) => {
    const result = options.store.get(request.params.activationId);
    if (result.status === 'notFound') { response.status(hasIoError(result.diagnostics) ? 503 : 404).json(error(hasIoError(result.diagnostics) ? 'persistence_unavailable' : 'not_found', hasIoError(result.diagnostics) ? 'Activations are temporarily unavailable.' : 'The Activation was not found.', result.diagnostics)); return; }
    response.json({ kind: 'activation', activation: result.activation, diagnostics: result.diagnostics });
  });
  router.post('/api/activations/from-brief', (request, response) => {
    const briefId = request.body?.briefId;
    if (typeof briefId !== 'string' || !briefId.trim()) { response.status(400).json(error('invalid_request', 'A SmartDeploy briefId is required.')); return; }
    if (request.body?.operatingObjective !== undefined && !validateOperatingObjective(request.body.operatingObjective)) { response.status(400).json(error('invalid_operating_objective', 'The structured operating objective is invalid.')); return; }
    const briefResult = options.briefStore.get(briefId);
    if (briefResult.status === 'notFound') { response.status(hasIoError(briefResult.diagnostics) ? 503 : 404).json(error(hasIoError(briefResult.diagnostics) ? 'persistence_unavailable' : 'brief_not_found', hasIoError(briefResult.diagnostics) ? 'SmartDeploy briefs are temporarily unavailable.' : 'The SmartDeploy brief was not found.', briefResult.diagnostics)); return; }
    const existing = options.store.list().activations.find(item => item.briefId === briefId);
    if (existing) { response.json({ kind: 'activation', status: 'existing', activation: existing }); return; }
    try {
      const source = sourceFromBrief(briefResult.brief);
      let notesCollectionId: string | undefined;
      const notes = options.notesStore.getByBriefId(briefId).collections[0];
      if (notes) notesCollectionId = notes.collectionId;
      else if (source.type !== 'General') notesCollectionId = options.notesStore.create({ briefId, activation: { program: source.type, reference: source.reference ?? '', ...(source.title ? { displayName: source.title } : {}) } }).collection.collectionId;
      const operatingObjective = request.body?.operatingObjective;
      const created = options.store.create({ ...source, briefId, ...(notesCollectionId ? { notesCollectionId } : {}), ...(operatingObjective === undefined ? {} : { operatingObjective }) });
      response.status(201).json({ kind: 'activation', status: 'created', activation: created.activation, diagnostics: [...briefResult.diagnostics, ...created.diagnostics] });
    } catch (error) { options.logger?.warn('Activation creation failed.'); response.status(422).json(errorPayload('invalid_brief', error instanceof Error ? error.message : 'The SmartDeploy brief could not initialize an Activation.')); }
  });
  router.post('/api/activations', (request, response) => {
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) { response.status(400).json(error('invalid_request', 'Activation data must be an object.')); return; }
    try { const created = options.store.create(request.body); response.status(201).json({ kind: 'activation', status: 'created', activation: created.activation, diagnostics: created.diagnostics }); }
    catch (creationError) { response.status(400).json(errorPayload('invalid_request', creationError instanceof Error ? creationError.message : 'The Activation request is invalid.')); }
  });
  router.patch('/api/activations/:activationId/status', (request, response) => {
    const existing = options.store.get(request.params.activationId);
    if (existing.status === 'notFound') { response.status(404).json(error('not_found', 'The Activation was not found.', existing.diagnostics)); return; }
    const status = request.body?.status;
    if (typeof status !== 'string' || !(ACTIVATION_STATUSES as readonly string[]).includes(status)) { response.status(400).json(error('invalid_status', `Status must be one of: ${ACTIVATION_STATUSES.join(', ')}.`)); return; }
    const allowed = existing.activation.status === 'planned' ? status === 'active' : existing.activation.status === 'active' ? status === 'completed' : false;
    if (!allowed) { response.status(409).json(error('invalid_transition', `An Activation cannot move from ${existing.activation.status} to ${status}.`, existing.diagnostics)); return; }
    try {
      if (status === 'active') {
        const activated = options.store.activate(existing.activation.activationId);
        response.json({ kind: 'activation', status: 'updated', activation: activated.activation, diagnostics: [...existing.diagnostics, ...activated.diagnostics], ...(activated.reconciledActivationIds.length ? { reconciledActivationIds: activated.reconciledActivationIds } : {}) });
        return;
      }
      const saved = options.store.save(updateActivationStatus(existing.activation, status, options.now)); response.json({ kind: 'activation', status: 'updated', activation: saved.activation, diagnostics: saved.diagnostics });
    }
    catch { response.status(503).json(error('persistence_unavailable', 'The Activation could not be updated.', existing.diagnostics)); }
  });
  router.post('/api/activations/reconcile', (request, response) => {
    const activationId = request.body?.keepActivationId;
    if (typeof activationId !== 'string' || !activationId.trim()) { response.status(400).json(error('invalid_request', 'A keepActivationId is required.')); return; }
    try { const reconciled = options.store.reconcileActive(activationId); response.json({ kind: 'activation', status: 'reconciled', activation: reconciled.activation, reconciledActivationIds: reconciled.reconciledActivationIds, diagnostics: reconciled.diagnostics }); }
    catch (reconciliationError) { response.status(409).json(errorPayload('reconciliation_required', reconciliationError instanceof Error ? reconciliationError.message : 'The active Activations could not be reconciled.')); }
  });
  return router;
}

function sourceFromBrief(brief: SmartDeployBrief): { type: 'POTA' | 'SOTA' | 'General'; reference?: string; title?: string; plannedLocation?: { latitude: number; longitude: number; gridSquare?: string }; missionWindow?: { start: string; end: string } } {
  if (brief.schemaVersion === 2) {
    const activation = brief.activation;
    const type = (ACTIVATION_TYPES as readonly string[]).includes(activation.program) ? activation.program as 'POTA' | 'SOTA' : 'General';
    const coordinates = brief.plannedOperatingSite.location.coordinates;
    return { type, reference: activation.reference || undefined, title: activation.displayName, plannedLocation: coordinates ? { latitude: coordinates.lat, longitude: coordinates.lon, ...(brief.plannedOperatingSite.location.gridSquare ? { gridSquare: brief.plannedOperatingSite.location.gridSquare } : {}) } : undefined, missionWindow: { start: brief.missionWindow.start, end: brief.missionWindow.end } };
  }
  const activation = brief.mission.activationTarget;
  const coordinates = brief.mission.operatingLocation.coordinates;
  return { type: (ACTIVATION_TYPES as readonly string[]).includes(activation.program) ? activation.program as 'POTA' | 'SOTA' : 'General', reference: activation.reference || undefined, title: activation.displayName, plannedLocation: coordinates ? { latitude: coordinates.lat, longitude: coordinates.lon, ...(brief.mission.operatingLocation.gridSquare ? { gridSquare: brief.mission.operatingLocation.gridSquare } : {}) } : undefined, missionWindow: brief.mission.missionWindow ? { start: brief.mission.missionWindow.start, end: brief.mission.missionWindow.end } : undefined };
}
function hasIoError(result: ActivationStoreReadResult | { readonly diagnostics: readonly { readonly code: string }[] } | readonly { readonly code: string }[]): boolean { return ('diagnostics' in result ? result.diagnostics : result).some(item => item.code === 'io_error'); }
function error(code: string, message: string, diagnostics: readonly unknown[] = []) { return { kind: 'activation_error', code, message, diagnostics }; }
function errorPayload(code: string, message: string) { return error(code, message); }