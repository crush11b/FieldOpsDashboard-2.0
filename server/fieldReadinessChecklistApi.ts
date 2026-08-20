import express, { type Router } from 'express';
import type { SmartDeployBriefStore } from './smartDeployBriefStore';
import {
  isValidFieldReadinessChecklistId,
  isValidFieldReadinessChecklistItemId,
  type FieldReadinessChecklist,
} from './fieldReadinessChecklist';
import type {
  FieldReadinessChecklistStore,
  FieldReadinessChecklistStoreDiagnostic,
} from './fieldReadinessChecklistStore';

export interface FieldReadinessChecklistApiOptions {
  readonly store: FieldReadinessChecklistStore;
  readonly briefStore: SmartDeployBriefStore;
  readonly logger?: Pick<Console, 'warn'>;
}

export function createFieldReadinessChecklistRouter(options: FieldReadinessChecklistApiOptions): Router {
  const router = express.Router();

  router.get('/api/field-checklists/brief/:briefId', (request, response) => {
    const briefId = request.params.briefId;
    if (!isValidFieldReadinessChecklistId(briefId)) {
      response.status(400).json(errorPayload('invalid_id', 'The SmartDeploy brief ID is invalid.'));
      return;
    }
    const result = options.store.getByBriefId(briefId);
    if (hasIoError(result.diagnostics)) {
      logPersistenceFailure(options.logger);
      response.status(503).json(errorPayload('persistence_unavailable', 'Field Readiness Checklist persistence is temporarily unavailable.', result.diagnostics));
      return;
    }
    const checklist = result.checklists[0];
    if (!checklist) {
      response.status(404).json(errorPayload('not_found', 'No Field Readiness Checklist exists for this SmartDeploy brief.', result.diagnostics));
      return;
    }
    response.json(checklistPayload(checklist, 'existing', result.diagnostics));
  });

  router.post('/api/field-checklists', (request, response) => {
    const body = request.body;
    if (!hasExactKeys(body, ['briefId']) || !isValidFieldReadinessChecklistId(body.briefId)) {
      response.status(400).json(errorPayload('invalid_request', 'A valid SmartDeploy briefId is required.'));
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
    if (hasIoError(existing.diagnostics)) {
      logPersistenceFailure(options.logger);
      response.status(503).json(errorPayload('persistence_unavailable', 'Field Readiness Checklist persistence is temporarily unavailable.', existing.diagnostics));
      return;
    }
    if (existing.checklists[0]) {
      response.json(checklistPayload(existing.checklists[0], 'existing', existing.diagnostics));
      return;
    }
    try {
      const created = options.store.createForBrief(body.briefId);
      response.status(201).json(checklistPayload(created.checklist, 'created', [...briefResult.diagnostics, ...created.diagnostics]));
    } catch {
      logPersistenceFailure(options.logger);
      response.status(503).json(errorPayload('persistence_unavailable', 'The Field Readiness Checklist could not be persisted.', [...briefResult.diagnostics, ...existing.diagnostics]));
    }
  });

  router.put('/api/field-checklists/:checklistId/items/:itemId', (request, response) => {
    const { checklistId, itemId } = request.params;
    if (!isValidFieldReadinessChecklistId(checklistId) || !isValidFieldReadinessChecklistItemId(itemId) || !hasExactKeys(request.body, ['completed']) || typeof request.body.completed !== 'boolean') {
      response.status(400).json(errorPayload('invalid_request', 'A valid checklist ID, item ID, and boolean completed value are required.'));
      return;
    }
    const existing = options.store.get(checklistId);
    if (existing.status === 'notFound') {
      if (hasIoError(existing.diagnostics)) {
        logPersistenceFailure(options.logger);
        response.status(503).json(errorPayload('persistence_unavailable', 'Field Readiness Checklist persistence is temporarily unavailable.', existing.diagnostics));
      } else response.status(404).json(errorPayload('checklist_not_found', 'The Field Readiness Checklist was not found.', existing.diagnostics));
      return;
    }
    try {
      const updated = options.store.updateItem(checklistId, itemId, request.body.completed);
      response.json(checklistPayload(updated.checklist, 'updated', updated.diagnostics));
    } catch {
      logPersistenceFailure(options.logger);
      response.status(503).json(errorPayload('persistence_unavailable', 'The Field Readiness Checklist could not be persisted.', existing.diagnostics));
    }
  });

  router.post('/api/field-checklists/:checklistId/reset', (request, response) => {
    const checklistId = request.params.checklistId;
    if (!isValidFieldReadinessChecklistId(checklistId) || !hasExactKeys(request.body, [])) {
      response.status(400).json(errorPayload('invalid_request', 'A valid checklist ID and empty request body are required.'));
      return;
    }
    const existing = options.store.get(checklistId);
    if (existing.status === 'notFound') {
      if (hasIoError(existing.diagnostics)) {
        logPersistenceFailure(options.logger);
        response.status(503).json(errorPayload('persistence_unavailable', 'Field Readiness Checklist persistence is temporarily unavailable.', existing.diagnostics));
      } else response.status(404).json(errorPayload('checklist_not_found', 'The Field Readiness Checklist was not found.', existing.diagnostics));
      return;
    }
    try {
      const reset = options.store.reset(checklistId);
      response.json(checklistPayload(reset.checklist, 'reset', reset.diagnostics));
    } catch {
      logPersistenceFailure(options.logger);
      response.status(503).json(errorPayload('persistence_unavailable', 'The Field Readiness Checklist could not be reset.', existing.diagnostics));
    }
  });

  return router;
}

function checklistPayload(checklist: FieldReadinessChecklist, status: 'created' | 'existing' | 'updated' | 'reset', diagnostics: readonly ApiDiagnostic[]) {
  return { kind: 'field_readiness_checklist', status, checklist, diagnostics };
}

type ApiDiagnostic = { readonly code: string; readonly message: string; readonly briefId?: string; readonly checklistId?: string };

function errorPayload(code: string, message: string, diagnostics: readonly ApiDiagnostic[] = []) {
  return { kind: 'field_readiness_checklist_error', code, message, diagnostics };
}

function hasIoError(diagnostics: readonly ApiDiagnostic[]): boolean {
  return diagnostics.some(diagnostic => diagnostic.code === 'io_error');
}

function logPersistenceFailure(logger: Pick<Console, 'warn'> | undefined): void {
  (logger ?? console).warn('Field Readiness Checklist persistence operation failed.');
}

function hasExactKeys(input: unknown, keys: readonly string[]): input is Record<string, any> {
  if (!isRecord(input)) return false;
  const actual = Object.keys(input);
  return actual.length === keys.length && keys.every(key => actual.includes(key));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}