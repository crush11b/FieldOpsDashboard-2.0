import express, { type Router } from 'express';
import { normalizeSmartDeployPlanningRequest, type SmartDeployPlanningRequest } from '../src/planning/smartDeployPlanning';
import { composeMissionEvidence, type MissionEvidence } from './missionEvidence';
import { executeMissionWindowPropagation, type MissionWindowPropagationResult } from './missionWindowPropagation';
import { PotaActivationTargetResolver, type PotaTargetResolution } from './potaTargetResolver';
import { SpaceWeatherService } from './spaceWeather';
import { ObservedRfService } from './observedRf';
import { generateSmartDeployBrief, type SmartDeployBrief } from './smartDeployBrief';
import {
  SmartDeployBriefStore,
  type SmartDeployBriefStoreReadResult,
} from './smartDeployBriefStore';

export interface SmartDeployGenerationRequest {
  readonly potaReference: unknown;
  readonly missionWindow: unknown;
  readonly operatingLocation: unknown;
  readonly equipment: unknown;
  readonly objective?: unknown;
}

export interface SmartDeployGenerationSuccess {
  readonly kind: 'smartdeploy_generation';
  readonly status: SmartDeployBrief['status'];
  readonly brief: SmartDeployBrief;
  readonly persistence: { readonly status: 'saved' | 'warning'; readonly warning?: string };
  readonly pota: Pick<PotaTargetResolution, 'status' | 'reference' | 'retrievedAtUtc' | 'refreshAttemptedAtUtc'>;
}

export interface SmartDeployGenerationFailure {
  readonly kind: 'smartdeploy_error';
  readonly code: 'invalid_request' | 'pota_invalid' | 'pota_unknown' | 'pota_unavailable' | 'generation_failed';
  readonly message: string;
  readonly issues?: readonly { readonly path: string; readonly code: string; readonly message: string }[];
  readonly pota?: Pick<PotaTargetResolution, 'status' | 'reference' | 'refreshAttemptedAtUtc'>;
}

export interface SmartDeployServiceOptions {
  readonly resolver?: PotaActivationTargetResolver;
  readonly spaceWeather?: SpaceWeatherService;
  readonly observedRf?: ObservedRfService;
  readonly store: SmartDeployBriefStore;
  readonly now?: () => Date;
  readonly propagate?: (request: { readonly planningRequest: SmartDeployPlanningRequest; readonly ssn: number }) => Promise<MissionWindowPropagationResult>;
  readonly compose?: (request: { readonly planningRequest: SmartDeployPlanningRequest; readonly propagation: MissionWindowPropagationResult; readonly observedRf: ReturnType<ObservedRfService['getSnapshot']> | null }, now: () => Date) => MissionEvidence;
  readonly generate?: (request: { readonly planningRequest: SmartDeployPlanningRequest; readonly missionEvidence: MissionEvidence }, now: () => Date) => SmartDeployBrief;
}

export class SmartDeployService {
  private readonly resolver: PotaActivationTargetResolver;
  private readonly spaceWeather: SpaceWeatherService;
  private readonly observedRf: ObservedRfService;
  private readonly now: () => Date;
  private readonly propagate: NonNullable<SmartDeployServiceOptions['propagate']>;
  private readonly compose: NonNullable<SmartDeployServiceOptions['compose']>;
  private readonly generate: NonNullable<SmartDeployServiceOptions['generate']>;

  constructor(private readonly options: SmartDeployServiceOptions) {
    this.resolver = options.resolver ?? new PotaActivationTargetResolver();
    this.spaceWeather = options.spaceWeather ?? new SpaceWeatherService();
    this.observedRf = options.observedRf ?? new ObservedRfService();
    this.now = options.now ?? (() => new Date());
    this.propagate = options.propagate ?? (request => executeMissionWindowPropagation(request, this.now));
    this.compose = options.compose ?? ((request, now) => composeMissionEvidence(request, now));
    this.generate = options.generate ?? ((request, now) => generateSmartDeployBrief(request, { now }));
  }

  async generateBrief(input: unknown): Promise<SmartDeployGenerationSuccess | SmartDeployGenerationFailure> {
    if (!isRecord(input)) return invalidFailure('Request must be an object.');
    const request = input as unknown as SmartDeployGenerationRequest;
    const resolution = await this.resolver.resolve(request.potaReference);
    if (resolution.status === 'invalid') return { kind: 'smartdeploy_error', code: 'pota_invalid', message: 'Enter a valid POTA park reference, such as US-1234.', pota: resolution };
    if (resolution.status === 'unknown') return { kind: 'smartdeploy_error', code: 'pota_unknown', message: 'The POTA park reference was not found.', pota: resolution };
    if (resolution.status === 'unavailable' || !resolution.target) return { kind: 'smartdeploy_error', code: 'pota_unavailable', message: 'The POTA source is currently unavailable. No brief was generated.', pota: resolution };

    const normalized = normalizeSmartDeployPlanningRequest({
      activationTarget: resolution.target,
      operatingLocation: request.operatingLocation,
      missionWindow: request.missionWindow,
      equipment: request.equipment,
      objective: request.objective,
    });
    if (!normalized.valid || !normalized.request) {
      return {
        kind: 'smartdeploy_error',
        code: 'invalid_request',
        message: 'The SmartDeploy mission request is invalid.',
        issues: normalized.issues,
        pota: resolution,
      };
    }

    try {
      this.observedRf.setOperatingLocation(normalized.request.operatingLocation);
      const weather = await this.spaceWeather.getSnapshot();
      const modelSsn = weather.modelSsn;
      const hasLongLivedModelInput = modelSsn?.modelInput?.semanticBasis === 'noaa_smoothed_monthly_ssn'
        && modelSsn.modelInput.validity === 'long_lived_model_input';
      const ssn = hasLongLivedModelInput && typeof modelSsn.value === 'number' && Number.isFinite(modelSsn.value)
        ? modelSsn.value
        : Number.NaN;
      const propagation = await this.propagate({ planningRequest: normalized.request, ssn });
      const observedRf = this.observedRf.getSnapshot();
      const baseEvidence = this.compose({ planningRequest: normalized.request, propagation, observedRf }, this.now);
      const missionEvidence = {
        ...baseEvidence,
        limitations: [
          ...baseEvidence.limitations,
          'Propagation modeling uses a long-lived smoothed monthly SSN model input; mission-window space-weather forecasting is not included in Slice 1.',
          ...(resolution.status === 'stale' ? ['POTA target data is stale and was used without a successful refresh.'] : []),
        ],
      };
      const brief = this.generate({ planningRequest: normalized.request, missionEvidence }, this.now);
      try {
        this.options.store.save(brief);
        return { kind: 'smartdeploy_generation', status: brief.status, brief, persistence: { status: 'saved' }, pota: resolution };
      } catch {
        return {
          kind: 'smartdeploy_generation',
          status: brief.status,
          brief,
          persistence: { status: 'warning', warning: 'Plan generated, but the local brief could not be saved. It may not be available after restart.' },
          pota: resolution,
        };
      }
    } catch {
      return { kind: 'smartdeploy_error', code: 'generation_failed', message: 'SmartDeploy evidence could not be generated. No brief was saved.', pota: resolution };
    }
  }
}

export interface SmartDeployRouterOptions {
  readonly service: SmartDeployService;
  readonly store: SmartDeployBriefStore;
}

export function createSmartDeployRouter(options: SmartDeployRouterOptions): Router {
  const router = express.Router();
  router.post('/api/smartdeploy/generate', async (request, response) => {
    const result = await options.service.generateBrief(request.body);
    if (result.kind === 'smartdeploy_error') {
      const status = result.code === 'pota_unknown' ? 404 : result.code === 'pota_unavailable' || result.code === 'generation_failed' ? 503 : 400;
      response.status(status).json(result);
      return;
    }
    response.json(result);
  });

  router.get('/api/smartdeploy/briefs', (_request, response) => response.json(storeListPayload(options.store.list())));
  router.get('/api/smartdeploy/briefs/:id', (request, response) => {
    const result = options.store.get(request.params.id);
    if (result.status === 'notFound') {
      response.status(404).json({ kind: 'smartdeploy_store_error', code: 'not_found', message: 'The SmartDeploy brief was not found.', diagnostics: result.diagnostics });
      return;
    }
    response.json({ kind: 'smartdeploy_brief', brief: result.brief, diagnostics: result.diagnostics });
  });
  router.delete('/api/smartdeploy/briefs/:id', (request, response) => {
    const result = options.store.delete(request.params.id);
    if (result.status === 'notFound') {
      response.status(404).json({ kind: 'smartdeploy_store_error', code: 'not_found', message: 'The SmartDeploy brief was not found.', diagnostics: result.diagnostics });
      return;
    }
    response.json({ kind: 'smartdeploy_deleted', briefId: result.brief.briefId, diagnostics: result.diagnostics });
  });
  return router;
}

function storeListPayload(result: SmartDeployBriefStoreReadResult) {
  return { kind: 'smartdeploy_briefs', status: result.status, briefs: result.briefs, diagnostics: result.diagnostics };
}

function invalidFailure(message: string): SmartDeployGenerationFailure {
  return { kind: 'smartdeploy_error', code: 'invalid_request', message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}