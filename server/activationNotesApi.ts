import express, { type Router } from 'express';
import type { SmartDeployBrief } from './smartDeployBrief';
import type { SmartDeployBriefStore } from './smartDeployBriefStore';
import {
  ACTIVATION_NOTES_MAX_NOTE_TEXT_LENGTH,
  ACTIVATION_NOTES_MAX_DISPLAY_NAME_LENGTH,
  ACTIVATION_NOTES_MAX_NOTES_PER_COLLECTION,
  ACTIVATION_NOTES_MAX_REFERENCE_LENGTH,
  ACTIVATION_NOTES_NOTE_KINDS,
  isValidActivationNotesId,
  type ActivationNotesCollection,
  type AddActivationNoteInput,
} from './activationNotes';
import type {
  ActivationNotesStore,
  ActivationNotesStoreDiagnostic,
  ActivationNotesStoreReadResult,
} from './activationNotesStore';

export interface ActivationNotesApiOptions {
  readonly store: ActivationNotesStore;
  readonly briefStore: SmartDeployBriefStore;
  readonly logger?: Pick<Console, 'warn'>;
}

export function createActivationNotesRouter(options: ActivationNotesApiOptions): Router {
  const router = express.Router();

  router.get('/api/activation-notes', (_request, response) => {
    const result = options.store.list();
    if (hasIoError(result.diagnostics)) {
      logPersistenceFailure(options.logger);
      response.status(503).json(errorPayload('persistence_unavailable', 'Activation Notes are temporarily unavailable.', result.diagnostics));
      return;
    }
    response.json({ kind: 'activation_notes_collections', status: result.status, collections: result.collections, diagnostics: result.diagnostics });
  });

  router.get('/api/activation-notes/brief/:briefId', (request, response) => {
    const briefId = request.params.briefId;
    if (!isValidActivationNotesId(briefId)) {
      response.status(400).json(errorPayload('invalid_id', 'The SmartDeploy brief ID is invalid.'));
      return;
    }
    const result = options.store.getByBriefId(briefId);
    if (hasIoErrorResult(result)) {
      logPersistenceFailure(options.logger);
      response.status(503).json(errorPayload('persistence_unavailable', 'Activation Notes are temporarily unavailable.', result.diagnostics));
      return;
    }
    const collection = result.collections[0];
    if (!collection) {
      response.status(404).json(errorPayload('not_found', 'No Activation Notes collection exists for this SmartDeploy brief.', result.diagnostics));
      return;
    }
    response.json(collectionPayload(collection, 'existing', result.diagnostics));
  });

  router.post('/api/activation-notes', (request, response) => {
    const body = request.body;
    if (!hasExactKeys(body, ['briefId']) || !isValidActivationNotesId(body.briefId)) {
      response.status(400).json(errorPayload('invalid_request', 'A valid SmartDeploy briefId is required; activation identity is derived from the retained brief.'));
      return;
    }

    const briefResult = options.briefStore.get(body.briefId);
    if (briefResult.status === 'notFound') {
      if (hasIoError(briefResult.diagnostics)) {
        logPersistenceFailure(options.logger);
        response.status(503).json(errorPayload('persistence_unavailable', 'SmartDeploy briefs are temporarily unavailable.', briefResult.diagnostics));
        return;
      }
      response.status(404).json(errorPayload('brief_not_found', 'The SmartDeploy brief was not found.', briefResult.diagnostics));
      return;
    }
    const existing = options.store.getByBriefId(body.briefId);
    if (hasIoErrorResult(existing)) {
      logPersistenceFailure(options.logger);
      response.status(503).json(errorPayload('persistence_unavailable', 'Activation Notes are temporarily unavailable.', existing.diagnostics));
      return;
    }
    if (existing.collections[0]) {
      response.json(collectionPayload(existing.collections[0], 'existing', existing.diagnostics));
      return;
    }

    const activation = activationIdentityFromBrief(briefResult.brief);
    if (!activation) {
      response.status(422).json(errorPayload('invalid_brief', 'The retained SmartDeploy brief has no usable activation identity.', briefResult.diagnostics));
      return;
    }
    try {
      const created = options.store.create({ briefId: body.briefId, activation });
      response.status(201).json(collectionPayload(created.collection, 'created', [...briefResult.diagnostics, ...created.diagnostics]));
    } catch {
      logPersistenceFailure(options.logger);
      response.status(503).json(errorPayload('persistence_unavailable', 'Activation Notes could not be persisted.', [...briefResult.diagnostics, ...existing.diagnostics]));
    }
  });

  router.post('/api/activation-notes/:collectionId/notes', (request, response) => {
    const collectionId = request.params.collectionId;
    if (!isValidActivationNotesId(collectionId) || !hasExactKeys(request.body, ['kind', 'text']) || !validNoteInput(request.body)) {
      response.status(400).json(errorPayload('invalid_request', 'A valid collection ID, note kind, and note text are required.'));
      return;
    }
    const existing = options.store.get(collectionId);
    if (existing.status === 'notFound') {
      if (hasIoError(existing.diagnostics)) {
        logPersistenceFailure(options.logger);
        response.status(503).json(errorPayload('persistence_unavailable', 'Activation Notes are temporarily unavailable.', existing.diagnostics));
      } else {
        response.status(404).json(errorPayload('collection_not_found', 'The Activation Notes collection was not found.', existing.diagnostics));
      }
      return;
    }
    if (existing.collection.notes.length >= ACTIVATION_NOTES_MAX_NOTES_PER_COLLECTION) {
      response.status(400).json(errorPayload('notes_limit_reached', 'The Activation Notes collection has reached its note limit.', existing.diagnostics));
      return;
    }
    try {
      const result = options.store.appendNote(collectionId, request.body as AddActivationNoteInput);
      response.json(collectionPayload(result.collection, 'updated', result.diagnostics));
    } catch {
      logPersistenceFailure(options.logger);
      response.status(503).json(errorPayload('persistence_unavailable', 'The Activation Note could not be persisted.', existing.diagnostics));
    }
  });

  router.delete('/api/activation-notes/:collectionId', (request, response) => {
    const collectionId = request.params.collectionId;
    if (!isValidActivationNotesId(collectionId)) {
      response.status(400).json(errorPayload('invalid_id', 'The Activation Notes collection ID is invalid.'));
      return;
    }
    const existing = options.store.get(collectionId);
    if (existing.status === 'notFound') {
      if (hasIoError(existing.diagnostics)) {
        logPersistenceFailure(options.logger);
        response.status(503).json(errorPayload('persistence_unavailable', 'Activation Notes are temporarily unavailable.', existing.diagnostics));
      } else {
        response.status(404).json(errorPayload('collection_not_found', 'The Activation Notes collection was not found.', existing.diagnostics));
      }
      return;
    }
    try {
      const result = options.store.delete(collectionId);
      response.json({ kind: 'activation_notes_deleted', collectionId: result.status === 'deleted' ? result.collection.collectionId : collectionId, diagnostics: result.diagnostics });
    } catch {
      logPersistenceFailure(options.logger);
      response.status(503).json(errorPayload('persistence_unavailable', 'The Activation Notes collection could not be deleted.', existing.diagnostics));
    }
  });

  return router;
}

function activationIdentityFromBrief(brief: SmartDeployBrief): { program: string; reference: string; displayName?: string } | null {
  const activation = brief.schemaVersion === 2 ? brief.activation : brief.mission.activationTarget;
  if (!activation || typeof activation.program !== 'string' || typeof activation.reference !== 'string') return null;
  const program = activation.program.trim().toUpperCase();
  const reference = activation.reference.trim();
  const displayName = typeof activation.displayName === 'string' ? activation.displayName.trim() : '';
  if ((program !== 'POTA' && program !== 'SOTA') || !reference || reference.length > ACTIVATION_NOTES_MAX_REFERENCE_LENGTH || (displayName && displayName.length > ACTIVATION_NOTES_MAX_DISPLAY_NAME_LENGTH)) return null;
  return { program, reference, ...(displayName ? { displayName } : {}) };
}

function validNoteInput(input: unknown): input is AddActivationNoteInput {
  if (!isRecord(input) || typeof input.kind !== 'string' || typeof input.text !== 'string') return false;
  const text = input.text.replace(/\r\n?/g, '\n').trim();
  return (ACTIVATION_NOTES_NOTE_KINDS as readonly string[]).includes(input.kind.trim())
    && text.length > 0
    && text.length <= ACTIVATION_NOTES_MAX_NOTE_TEXT_LENGTH;
}

function hasExactKeys(input: unknown, keys: readonly string[]): input is Record<string, any> {
  if (!isRecord(input)) return false;
  const actual = Object.keys(input);
  return actual.length === keys.length && keys.every(key => actual.includes(key));
}

type ApiDiagnostic = { readonly code: string; readonly message: string; readonly briefId?: string; readonly collectionId?: string };

function collectionPayload(collection: ActivationNotesCollection, status: 'created' | 'existing' | 'updated', diagnostics: readonly ApiDiagnostic[]) {
  return { kind: 'activation_notes_collection', status, collection, diagnostics };
}

function errorPayload(code: string, message: string, diagnostics: readonly ApiDiagnostic[] = []) {
  return { kind: 'activation_notes_error', code, message, diagnostics };
}

function hasIoErrorResult(result: ActivationNotesStoreReadResult | { readonly diagnostics: readonly ApiDiagnostic[] }): boolean {
  return hasIoError(result.diagnostics);
}

function hasIoError(diagnostics: readonly ApiDiagnostic[]): boolean {
  return diagnostics.some(diagnostic => diagnostic.code === 'io_error');
}

function logPersistenceFailure(logger: Pick<Console, 'warn'> | undefined): void {
  (logger ?? console).warn('Activation Notes persistence operation failed.');
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}