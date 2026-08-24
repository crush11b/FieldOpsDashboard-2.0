import express, { type Router } from 'express';
import { retrieveMissionForecast } from './missionForecast';
import type { MissionForecastStore } from './missionForecastStore';
import type { SmartDeployBriefStore } from './smartDeployBriefStore';

export interface MissionForecastApiOptions { readonly store: MissionForecastStore; readonly briefStore: SmartDeployBriefStore; readonly fetcher?: typeof fetch; readonly now?: () => Date; readonly logger?: Pick<Console, 'warn'>; }
export function createMissionForecastRouter(options: MissionForecastApiOptions): Router {
  const router = express.Router();
  router.get('/api/mission-forecast/brief/:briefId', (request, response) => {
    const brief = options.briefStore.get(request.params.briefId);
    if (brief.status === 'notFound') return brief.diagnostics.some(diagnostic => diagnostic.code === 'io_error') ? persistenceError(response, options.logger) : response.status(404).json(error('brief_not_found', 'The SmartDeploy brief was not found.'));
    if (brief.brief.schemaVersion !== 2) return response.status(409).json(error('unsupported_brief_schema', 'This retained SmartDeploy brief schema is unsupported for mission forecasts.'));
    const retained = options.store.getByBriefId(request.params.briefId);
    if (retained.status === 'found') return response.json({ kind: 'mission_forecast', status: 'retained', refresh: 'not_requested', retainedStatus: 'prior_valid_snapshot', record: retained.record, diagnostics: retained.diagnostics });
    return retained.diagnostics.some(diagnostic => diagnostic.code === 'io_error') ? persistenceError(response, options.logger) : response.json({ kind: 'mission_forecast', status: 'not_requested', refresh: 'not_requested', retainedStatus: 'none', record: null, diagnostics: retained.diagnostics });
  });
  router.post('/api/mission-forecast/brief/:briefId/refresh', async (request, response) => {
    const brief = options.briefStore.get(request.params.briefId);
    if (brief.status === 'notFound') return brief.diagnostics.some(diagnostic => diagnostic.code === 'io_error') ? persistenceError(response, options.logger) : response.status(404).json(error('brief_not_found', 'The SmartDeploy brief was not found.'));
    if (brief.brief.schemaVersion !== 2) return response.status(409).json(error('unsupported_brief_schema', 'This retained SmartDeploy brief schema is unsupported for mission forecasts.'));
    const prior = options.store.getByBriefId(request.params.briefId);
    if (prior.diagnostics.some(diagnostic => diagnostic.code === 'io_error')) return persistenceError(response, options.logger);
    const retrieval = await retrieveMissionForecast(brief.brief, { fetcher: options.fetcher, now: options.now?.() });
    if (retrieval.record) { try { const saved = options.store.save(retrieval.record); return response.json({ kind: 'mission_forecast', status: 'live', refresh: 'succeeded', retainedStatus: prior.status === 'found' ? 'prior_valid_snapshot' : 'none', record: saved.record, diagnostics: [...prior.diagnostics, ...saved.diagnostics] }); } catch { return persistenceError(response, options.logger); } }
    const retained = prior.status === 'found' ? prior.record : null;
    return response.status(retrieval.status === 'planned_coordinates_invalid' || retrieval.status === 'outside_provider_horizon' ? 422 : 503).json({ kind: 'mission_forecast', status: retained ? 'retained_refresh_failed' : retrieval.status, refresh: 'failed', retainedStatus: retained ? 'prior_valid_snapshot' : 'none', record: retained, message: retrieval.message, diagnostics: prior.diagnostics, code: retained ? 'retained_refresh_failed' : retrieval.status });
  });
  return router;
}
function error(code: string, message: string) { return { kind: 'mission_forecast_error', code, message, diagnostics: [] }; }
function persistenceError(response: express.Response, logger: Pick<Console, 'warn'> | undefined) { logger?.warn('Mission forecast persistence operation failed.'); return response.status(503).json(error('persistence_unavailable', 'Mission forecast persistence is temporarily unavailable.')); }