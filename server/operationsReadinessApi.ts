import express, { type Router } from 'express';
import { isValidActivationNotesId } from './activationNotes';
import { readGnssTimePipe, type GnssTimeEvidence } from './locationTelemetryPipe';
import type { MissionForecastStoreGetResult } from './missionForecastStore';
import { assembleOperationsReadiness, type OperationsReadinessAssemblyDependencies, type OperationsReadinessAssemblyOptions, type OperationsReadinessAssemblyResult } from './operationsReadinessAssembly';

export interface OperationsReadinessApiOptions {
  readonly assembly?: (briefId: string, options?: OperationsReadinessAssemblyOptions) => Promise<OperationsReadinessAssemblyResult>;
  readonly dependencies?: OperationsReadinessAssemblyDependencies;
  readonly offlineEvidence?: { readonly readGnssTime?: () => Promise<GnssTimeEvidence>; readonly readMissionForecast: (briefId: string) => MissionForecastStoreGetResult; readonly verifyP533: () => Promise<{ readonly files: number }> };
}

export function createOperationsReadinessRouter(options: OperationsReadinessApiOptions): Router {
  if (!options.assembly && !options.dependencies) throw new Error('Operations Readiness API requires an assembly or dependencies.');
  const assembly = options.assembly ?? ((briefId: string, assemblyOptions?: OperationsReadinessAssemblyOptions) => assembleOperationsReadiness(briefId, options.dependencies!, assemblyOptions));
  const router = express.Router();

  router.get('/api/operations-readiness/:briefId', async (request, response) => {
    const briefId = request.params.briefId;
    if (!isValidActivationNotesId(briefId)) {
      response.status(400).json(errorPayload('invalid_id', 'The SmartDeploy brief ID is invalid.'));
      return;
    }
    try {
      const includeLiveWeather = request.query.includeLiveWeather === 'true';
      const result = await assembly(briefId, { includeLiveWeather });
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
      response.json({ kind: 'operations_readiness', briefId, summary: result.summary, displayEvidence: result.displayEvidence, diagnostics: result.diagnostics });
    } catch {
      response.status(500).json(errorPayload('readiness_internal_error', 'Operations Readiness encountered an unexpected internal error.'));
    }
  });
  router.post('/api/offline-preparation/:briefId', async (request, response) => {
    const briefId = request.params.briefId;
    if (!isValidActivationNotesId(briefId)) { response.status(400).json(errorPayload('invalid_id', 'The SmartDeploy brief ID is invalid.')); return; }
    try {
      const [result, gnssTime] = await Promise.all([assembly(briefId, { includeLiveWeather: true }), (options.offlineEvidence?.readGnssTime ?? readGnssTimePipe)()]);
      if (result.status !== 'ok') { response.status(result.status === 'notFound' ? 404 : result.status === 'unsupported' ? 422 : 503).json(errorPayload('offline_preparation_unavailable', 'Offline Preparation could not evaluate all retained evidence.', result.diagnostics)); return; }
      const finding = (id: string) => result.summary.findings.find(item => item.id === id);
      const checks: { id: string; status: string; message: string }[] = ['plan-retained', 'current-location', 'clock-synchronization', 'mission-window', 'weather', 'weather-alerts', 'propagation-evidence', 'sota-dataset-state'].map(id => { const item = finding(id); return { id, status: item?.status ?? 'unknown', message: item?.message ?? 'This evidence is not available in the current readiness view.' }; });
      checks.splice(3, 0, { id: 'gnss-time', status: gnssTime.status === 'Available' ? 'ready' : gnssTime.status === 'Malformed' ? 'attention' : 'unavailable', message: gnssTime.status === 'Available' ? `Fresh GNSS UTC is available from ${gnssTime.sentenceType}.` : gnssTime.error ?? 'Fresh GNSS UTC is unavailable.' });
      const forecast = options.offlineEvidence?.readMissionForecast(briefId);
      checks.push(forecast?.status === 'found'
        ? { id: 'mission-forecast', status: 'ready', message: `Retained - forecast available for brief ${forecast.record.briefId}; captured ${forecast.record.retrievedAtUtc}. Stored mission-window coverage is ${forecast.record.missionWindow.start} through ${forecast.record.missionWindow.end}; current-plan coverage is not independently re-derived here.` }
        : { id: 'mission-forecast', status: 'unavailable', message: forecast ? 'Unavailable - no retained mission forecast exists for this activation.' : 'Unavailable - mission forecast store was not configured.' });
      try { const verified = options.offlineEvidence ? await options.offlineEvidence.verifyP533() : null; checks.push(verified ? { id: 'offline-p533', status: 'ready', message: `Available - offline P.533 runtime verified (${verified.files} runtime files).` } : { id: 'offline-p533', status: 'unavailable', message: 'Unavailable - offline P.533 verification is not configured.' }); }
      catch (error) { checks.push({ id: 'offline-p533', status: 'error', message: error instanceof Error ? `Error - ${error.message}` : 'Error - P.533 verification failed.' }); }
      response.json({ kind: 'offline_preparation', briefId, activationReference: result.summary.plan.activationReference, checks, diagnostics: result.diagnostics, evaluatedAtUtc: result.summary.evaluatedAtUtc });
    } catch { response.status(500).json(errorPayload('offline_preparation_internal_error', 'Offline Preparation encountered an unexpected internal error.')); }
  });
  return router;
}

function errorPayload(code: string, message: string, diagnostics: OperationsReadinessAssemblyResult['diagnostics'] = []) {
  return { kind: 'operations_readiness_error', code, message, diagnostics };
}
