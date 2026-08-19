import express, { type Router } from 'express';
import { normalizeSmartDeployPlanningRequest, resolvePlannedOperatingLocation, toSmartDeployExecutionRequest, type SmartDeployExecutionRequest } from '../src/planning/smartDeployPlanning';
import type { OperatingLocation } from '../src/location/operatingLocation';
import { composeMissionEvidence, type MissionEvidence } from './missionEvidence';
import { executeMissionWindowPropagation, type MissionWindowPropagationResult } from './missionWindowPropagation';
import { normalizeActivationTargetRequest, type ActivationTargetResolution, type ActivationTargetResolver } from './activationTargetResolver';
import { PotaActivationTargetResolver, type PotaTargetResolution } from './potaTargetResolver';
import { LocalSotaSummitDataset } from './sotaSummitDataset';
import { SotaActivationTargetResolver, type SotaTargetResolution } from './sotaTargetResolver';
import { SpaceWeatherService } from './spaceWeather';
import { ObservedRfService } from './observedRf';
import { generateSmartDeployBrief, type SmartDeployBrief } from './smartDeployBrief';
import {
  SmartDeployBriefStore,
  type SmartDeployBriefStoreReadResult,
} from './smartDeployBriefStore';

export interface SmartDeployGenerationRequest {
  readonly targetRequest?: unknown;
  readonly potaReference?: unknown;
  readonly activationTarget: unknown;
  readonly plannedOperatingLocation: unknown;
  readonly currentDeviceLocation?: unknown;
  readonly plannedOperatingLocationSelection?: unknown;
  readonly missionWindow: unknown;
  readonly propagationObjective: unknown;
  readonly equipment: unknown;
  readonly objective?: unknown;
}

export interface SmartDeployGenerationSuccess {
  readonly kind: 'smartdeploy_generation';
  readonly status: SmartDeployBrief['status'];
  readonly brief: SmartDeployBrief;
  readonly persistence: { readonly status: 'saved' | 'warning'; readonly warning?: string };
  readonly pota?: Pick<PotaTargetResolution, 'status' | 'reference' | 'retrievedAtUtc' | 'refreshAttemptedAtUtc'>;
  readonly sota?: Pick<SotaTargetResolution, 'status' | 'reference' | 'retrievedAtUtc' | 'refreshAttemptedAtUtc'>;
}

export interface SmartDeployGenerationFailure {
  readonly kind: 'smartdeploy_error';
  readonly code: 'invalid_request' | 'unsupported_target_program' | 'pota_invalid' | 'pota_unknown' | 'pota_unavailable' | 'sota_invalid' | 'sota_unknown' | 'sota_unavailable' | 'generation_failed';
  readonly message: string;
  readonly issues?: readonly { readonly path: string; readonly code: string; readonly message: string }[];
  readonly pota?: Pick<PotaTargetResolution, 'status' | 'reference' | 'refreshAttemptedAtUtc'>;
  readonly sota?: Pick<SotaTargetResolution, 'status' | 'reference' | 'refreshAttemptedAtUtc'>;
}

export interface SmartDeployServiceOptions {
  readonly resolver?: ActivationTargetResolver;
  readonly sotaResolver?: SotaActivationTargetResolver;
  readonly spaceWeather?: SpaceWeatherService;
  readonly observedRf?: ObservedRfService;
  readonly store: SmartDeployBriefStore;
  readonly now?: () => Date;
  readonly propagate?: (request: { readonly planningRequest: SmartDeployExecutionRequest; readonly ssn: number }) => Promise<MissionWindowPropagationResult>;
  readonly compose?: (request: { readonly planningRequest: SmartDeployExecutionRequest; readonly propagation: MissionWindowPropagationResult; readonly observedRf: ReturnType<ObservedRfService['getSnapshot']> | null }, now: () => Date) => MissionEvidence;
  readonly generate?: (request: { readonly planningRequest: SmartDeployExecutionRequest; readonly missionEvidence: MissionEvidence }, now: () => Date) => SmartDeployBrief;
}

export class SmartDeployService {
  private readonly resolver: ActivationTargetResolver;
  private readonly sotaResolver: SotaActivationTargetResolver;
  private readonly spaceWeather: SpaceWeatherService;
  private readonly observedRf: ObservedRfService;
  private readonly now: () => Date;
  private readonly propagate: NonNullable<SmartDeployServiceOptions['propagate']>;
  private readonly compose: NonNullable<SmartDeployServiceOptions['compose']>;
  private readonly generate: NonNullable<SmartDeployServiceOptions['generate']>;

  constructor(private readonly options: SmartDeployServiceOptions) {
    this.resolver = options.resolver ?? new PotaActivationTargetResolver();
    this.sotaResolver = options.sotaResolver ?? new SotaActivationTargetResolver(LocalSotaSummitDataset.unavailable());
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
    const targetRequest = normalizeActivationTargetRequest(request.targetRequest)
      ?? (request.potaReference !== undefined ? normalizeActivationTargetRequest({ program: 'POTA', reference: request.potaReference }) : null);
    if (!targetRequest) return invalidFailure('A target program and reference are required.');
    if (targetRequest.program !== 'POTA' && targetRequest.program !== 'SOTA') return { kind: 'smartdeploy_error', code: 'unsupported_target_program', message: `The ${targetRequest.program} activation target is not supported yet.` };
    const resolver = targetRequest.program === 'SOTA' ? this.sotaResolver : this.resolver;
    const resolution = targetRequest.program === 'SOTA'
      ? await this.sotaResolver.resolve(targetRequest) as SotaTargetResolution
      : await resolver.resolve(targetRequest) as PotaTargetResolution;
    const resolutionMetadata = targetRequest.program === 'SOTA'
      ? { sota: resolution as SotaTargetResolution }
      : { pota: resolution as PotaTargetResolution };
    if (resolution.status === 'invalid') return { kind: 'smartdeploy_error', code: targetRequest.program === 'SOTA' ? 'sota_invalid' : 'pota_invalid', message: targetRequest.program === 'SOTA' ? 'Enter a valid SOTA summit reference, such as W4V/SH-001.' : 'Enter a valid POTA park reference, such as US-1234.', ...resolutionMetadata };
    if (resolution.status === 'unknown') return { kind: 'smartdeploy_error', code: targetRequest.program === 'SOTA' ? 'sota_unknown' : 'pota_unknown', message: targetRequest.program === 'SOTA' ? 'The SOTA summit reference was not found in the local dataset.' : 'The POTA park reference was not found.', ...resolutionMetadata };
    if (resolution.status === 'unavailable' || !resolution.target) return { kind: 'smartdeploy_error', code: targetRequest.program === 'SOTA' ? 'sota_unavailable' : 'pota_unavailable', message: targetRequest.program === 'SOTA' ? 'The local SOTA summit dataset is unavailable. No brief was generated.' : 'The POTA source is currently unavailable. No brief was generated.', ...resolutionMetadata };

    const selection = request.plannedOperatingLocationSelection === 'current_device' ? 'current_device' : 'provider_reference';
    const resolvedPlannedLocation = request.plannedOperatingLocation === undefined
      ? resolvePlannedOperatingLocation(resolution.target, request.currentDeviceLocation as OperatingLocation | undefined, selection)
      : { status: 'resolved' as const, location: request.plannedOperatingLocation };
    const normalized = normalizeSmartDeployPlanningRequest({
      activationTarget: resolution.target,
      plannedOperatingLocation: resolvedPlannedLocation.status === 'resolved' ? resolvedPlannedLocation.location : undefined,
      currentDeviceLocation: request.currentDeviceLocation,
      propagationObjective: request.propagationObjective,
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
        ...resolutionMetadata,
      };
    }

    try {
      const executionRequest = toSmartDeployExecutionRequest(normalized.request);
      this.observedRf.setOperatingLocation(normalized.request.plannedOperatingLocation);
      const weather = await this.spaceWeather.getSnapshot();
      const modelSsn = weather.modelSsn;
      const hasLongLivedModelInput = modelSsn?.modelInput?.semanticBasis === 'noaa_smoothed_monthly_ssn'
        && modelSsn.modelInput.validity === 'long_lived_model_input';
      const ssn = hasLongLivedModelInput && typeof modelSsn.value === 'number' && Number.isFinite(modelSsn.value)
        ? modelSsn.value
        : Number.NaN;
      const propagation = await this.propagate({ planningRequest: executionRequest, ssn });
      const observedRf = this.observedRf.getSnapshot();
      const baseEvidence = this.compose({ planningRequest: executionRequest, propagation, observedRf }, this.now);
      const missionEvidence = {
        ...baseEvidence,
        limitations: [
          ...baseEvidence.limitations,
          'Propagation modeling uses a long-lived smoothed monthly SSN model input; mission-window space-weather forecasting is not included in Slice 1.',
          ...(resolution.status === 'stale' ? [targetRequest.program === 'SOTA' ? 'SOTA summit data is stale and was used from the local dataset.' : 'POTA target data is stale and was used without a successful refresh.'] : []),
        ],
      };
      const brief = this.generate({ planningRequest: executionRequest, missionEvidence }, this.now);
      try {
        this.options.store.save(brief);
        return { kind: 'smartdeploy_generation', status: brief.status, brief, persistence: { status: 'saved' }, ...resolutionMetadata };
      } catch {
        return {
          kind: 'smartdeploy_generation',
          status: brief.status,
          brief,
          persistence: { status: 'warning', warning: 'Plan generated, but the local brief could not be saved. It may not be available after restart.' },
          ...resolutionMetadata,
        };
      }
    } catch {
      return { kind: 'smartdeploy_error', code: 'generation_failed', message: 'SmartDeploy evidence could not be generated. No brief was saved.', ...resolutionMetadata };
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
      const status = result.code === 'pota_unknown' || result.code === 'sota_unknown' ? 404 : result.code === 'pota_unavailable' || result.code === 'sota_unavailable' || result.code === 'generation_failed' ? 503 : 400;
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