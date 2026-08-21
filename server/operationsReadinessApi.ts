import express, { type Router } from 'express';
import { isValidActivationNotesId } from './activationNotes';
import { assembleOperationsReadiness, type OperationsReadinessAssemblyDependencies, type OperationsReadinessAssemblyResult } from './operationsReadinessAssembly';

export interface OperationsReadinessApiOptions {
  readonly assembly?: (briefId: string) => Promise<OperationsReadinessAssemblyResult>;
  readonly dependencies?: OperationsReadinessAssemblyDependencies;
}

export function createOperationsReadinessRouter(options: OperationsReadinessApiOptions): Router {
  if (!options.assembly && !options.dependencies) throw new Error('Operations Readiness API requires an assembly or dependencies.');
  const assembly = options.assembly ?? ((briefId: string) => assembleOperationsReadiness(briefId, options.dependencies!));
  const router = express.Router();

  router.get('/api/operations-readiness/:briefId', async (request, response) => {
    const briefId = request.params.briefId;
    if (!isValidActivationNotesId(briefId)) {
      response.status(400).json(errorPayload('invalid_id', 'The SmartDeploy brief ID is invalid.'));
      return;
    }
    try {
      const result = await assembly(briefId);
      if (result.status === 'notFound') {
        response.status(404).json(errorPayload('brief_not_found', 'The retained SmartDeploy brief was not found.', result.diagnostics));
        return;
      }
      if (result.status === 'unsupported') {
        response.status(422).json(errorPayload('unsupported_brief_schema', 'The retained SmartDeploy brief schema is unsupported for Operations Readiness.', result.diagnostics));
        return;
      }
      if (result.status === 'unavailable') {
        response.status(503).json(errorPayload('readiness_unavailable', 'Operations Readiness could not be evaluated from the retained local evidence.', result.diagnostics));
        return;
      }
      response.json({ kind: 'operations_readiness', briefId, summary: result.summary, diagnostics: result.diagnostics });
    } catch {
      response.status(503).json(errorPayload('readiness_unavailable', 'Operations Readiness could not be evaluated from the retained local evidence.'));
    }
  });
  return router;
}

function errorPayload(code: string, message: string, diagnostics: OperationsReadinessAssemblyResult['diagnostics'] = []) {
  return { kind: 'operations_readiness_error', code, message, diagnostics };
}
