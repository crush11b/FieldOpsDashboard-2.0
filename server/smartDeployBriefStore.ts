import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SmartDeployBrief, SmartDeployBriefV1, SmartDeployBriefV2 } from './smartDeployBrief';
import { SMART_DEPLOY_BRIEF_SCHEMA_VERSION, SMART_DEPLOY_BRIEF_V1_SCHEMA_VERSION } from './smartDeployBrief';

export const SMART_DEPLOY_BRIEF_STORE_VERSION = 1 as const;
export const SMART_DEPLOY_BRIEF_STORE_FILE_NAME = 'smartdeploy-briefs.json';
export const SMART_DEPLOY_BRIEF_RETENTION_LIMIT = 10;

export type SmartDeployBriefStoreDiagnosticCode =
  | 'missing'
  | 'corrupt'
  | 'unsupported_store_version'
  | 'unsupported_brief_schema'
  | 'invalid_brief'
  | 'io_error';

export interface SmartDeployBriefStoreDiagnostic {
  readonly code: SmartDeployBriefStoreDiagnosticCode;
  readonly message: string;
  readonly briefId?: string;
}

export interface SmartDeployBriefStoreReadResult {
  readonly status: 'missing' | 'loaded' | 'invalid' | 'ioError';
  readonly briefs: readonly SmartDeployBrief[];
  readonly diagnostics: readonly SmartDeployBriefStoreDiagnostic[];
}

export interface SmartDeployBriefStoreSaveResult {
  readonly brief: SmartDeployBrief;
  readonly diagnostics: readonly SmartDeployBriefStoreDiagnostic[];
}

export type SmartDeployBriefStoreGetResult =
  | { readonly status: 'found'; readonly brief: SmartDeployBrief; readonly diagnostics: readonly SmartDeployBriefStoreDiagnostic[] }
  | { readonly status: 'notFound'; readonly diagnostics: readonly SmartDeployBriefStoreDiagnostic[] };

export type SmartDeployBriefStoreDeleteResult =
  | { readonly status: 'deleted'; readonly brief: SmartDeployBrief; readonly diagnostics: readonly SmartDeployBriefStoreDiagnostic[] }
  | { readonly status: 'notFound'; readonly diagnostics: readonly SmartDeployBriefStoreDiagnostic[] };

interface SmartDeployBriefStoreDocument {
  readonly storeVersion: typeof SMART_DEPLOY_BRIEF_STORE_VERSION;
  readonly briefs: readonly SmartDeployBrief[];
}

export function getDefaultSmartDeployBriefPath(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): string {
  const localAppData = environment.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local');
  return path.join(localAppData, 'FieldOpsDashboard', SMART_DEPLOY_BRIEF_STORE_FILE_NAME);
}

export function validateSmartDeployBrief(input: unknown): input is SmartDeployBrief {
  return isV1Brief(input) || isV2Brief(input);
}

export class SmartDeployBriefStore {
  constructor(private readonly filePath: string) {}

  load(): SmartDeployBriefStoreReadResult {
    let json: string;
    try {
      json = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { status: 'missing', briefs: [], diagnostics: [{ code: 'missing', message: 'No SmartDeploy brief store exists yet.' }] };
      }
      return { status: 'ioError', briefs: [], diagnostics: [{ code: 'io_error', message: 'The SmartDeploy brief store could not be read.' }] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { status: 'invalid', briefs: [], diagnostics: [{ code: 'corrupt', message: 'The SmartDeploy brief store contains invalid JSON.' }] };
    }

    if (!isRecord(parsed) || parsed.storeVersion !== SMART_DEPLOY_BRIEF_STORE_VERSION || !Array.isArray(parsed.briefs)) {
      const code = isRecord(parsed) && parsed.storeVersion !== SMART_DEPLOY_BRIEF_STORE_VERSION
        ? 'unsupported_store_version'
        : 'corrupt';
      return { status: 'invalid', briefs: [], diagnostics: [{ code, message: 'The SmartDeploy brief store wrapper is unsupported or malformed.' }] };
    }

    const briefs: SmartDeployBrief[] = [];
    const diagnostics: SmartDeployBriefStoreDiagnostic[] = [];
    for (const candidate of parsed.briefs) {
      if (!isRecord(candidate) || (candidate.schemaVersion !== SMART_DEPLOY_BRIEF_SCHEMA_VERSION && candidate.schemaVersion !== SMART_DEPLOY_BRIEF_V1_SCHEMA_VERSION)) {
        diagnostics.push({
          code: isRecord(candidate) && 'briefId' in candidate ? 'unsupported_brief_schema' : 'invalid_brief',
          message: 'A stored SmartDeploy brief was skipped because its schema is unsupported or malformed.',
          ...(isRecord(candidate) && typeof candidate.briefId === 'string' ? { briefId: candidate.briefId } : {}),
        });
      } else if (!validateSmartDeployBrief(candidate)) {
        diagnostics.push({
          code: 'invalid_brief',
          message: 'A stored SmartDeploy brief was skipped because required fields were invalid.',
          briefId: typeof candidate.briefId === 'string' ? candidate.briefId : undefined,
        });
      } else {
        briefs.push(candidate);
      }
    }

    return {
      status: 'loaded',
      briefs: orderBriefs(briefs).slice(0, SMART_DEPLOY_BRIEF_RETENTION_LIMIT),
      diagnostics,
    };
  }

  save(brief: SmartDeployBrief): SmartDeployBriefStoreSaveResult {
    if (!validateSmartDeployBrief(brief)) throw new Error('The SmartDeploy brief is invalid or uses an unsupported schema.');
    const loaded = this.load();
    const briefs = loaded.briefs.filter(existing => existing.briefId !== brief.briefId);
    briefs.push(brief);
    this.write({ storeVersion: SMART_DEPLOY_BRIEF_STORE_VERSION, briefs: orderBriefs(briefs).slice(0, SMART_DEPLOY_BRIEF_RETENTION_LIMIT) });
    return { brief, diagnostics: loaded.diagnostics };
  }

  list(): SmartDeployBriefStoreReadResult {
    return this.load();
  }

  get(briefId: string): SmartDeployBriefStoreGetResult {
    const loaded = this.load();
    const brief = loaded.briefs.find(candidate => candidate.briefId === briefId);
    return brief
      ? { status: 'found', brief, diagnostics: loaded.diagnostics }
      : { status: 'notFound', diagnostics: loaded.diagnostics };
  }

  delete(briefId: string): SmartDeployBriefStoreDeleteResult {
    const loaded = this.load();
    const brief = loaded.briefs.find(candidate => candidate.briefId === briefId);
    if (!brief) return { status: 'notFound', diagnostics: loaded.diagnostics };
    this.write({ storeVersion: SMART_DEPLOY_BRIEF_STORE_VERSION, briefs: loaded.briefs.filter(candidate => candidate.briefId !== briefId) });
    return { status: 'deleted', brief, diagnostics: loaded.diagnostics };
  }

  private write(document: SmartDeployBriefStoreDocument): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      try {
        fs.renameSync(temporaryPath, this.filePath);
      } catch (error) {
        if (!isNodeError(error) || (error.code !== 'EEXIST' && error.code !== 'EPERM')) throw error;
        fs.rmSync(this.filePath, { force: true });
        fs.renameSync(temporaryPath, this.filePath);
      }
    } finally {
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best-effort temporary cleanup */ }
    }
  }
}

function orderBriefs(briefs: readonly SmartDeployBrief[]): SmartDeployBrief[] {
  return [...briefs].sort((left, right) => {
    const timestampOrder = right.generatedAtUtc.localeCompare(left.generatedAtUtc);
    return timestampOrder || right.briefId.localeCompare(left.briefId);
  });
}

function isMissionSnapshot(input: unknown): boolean {
  if (!isRecord(input) || !isRecord(input.activationTarget) || !nonEmptyString(input.activationTarget.program) || !nonEmptyString(input.activationTarget.reference)
    || !isRecord(input.operatingLocation) || !isRecord(input.missionWindow) || !validDateString(input.missionWindow.start) || !validDateString(input.missionWindow.end)
    || !isRecord(input.equipment) || !isRecord(input.equipment.radio) || !isRecord(input.equipment.antenna) || !Array.isArray(input.equipment.modes)
    || !input.equipment.modes.every(mode => typeof mode === 'string') || typeof input.equipment.transmitPowerWatts !== 'number' || !Number.isFinite(input.equipment.transmitPowerWatts)) return false;
  return input.objective === undefined || typeof input.objective === 'string';
}

function isSections(input: unknown): boolean {
  if (!isRecord(input) || !isRecord(input.mission) || input.mission.status !== 'available' || !isMissionSnapshot(input.mission.snapshot)) return false;
  return ['geometry', 'solar', 'propagation', 'observedRf'].every(key => {
    const section = input[key];
    return isRecord(section) && ['available', 'derived', 'complete', 'partial', 'unavailable', 'stale', 'observed', 'notTemporallyApplicable'].includes(String(section.status)) && isRecord(section.evidence);
  });
}

function isLimitation(input: unknown): boolean {
  return isRecord(input) && typeof input.code === 'string' && typeof input.message === 'string';
}

function nonEmptyString(input: unknown): input is string {
  return typeof input === 'string' && input.length > 0;
}

function validDateString(input: unknown): input is string {
  return typeof input === 'string' && input.length > 0 && !Number.isNaN(Date.parse(input));
}

function isRecord(input: unknown): input is Record<string, any> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function isV1Brief(input: unknown): input is SmartDeployBriefV1 {
  return isRecord(input)
    && input.schemaVersion === SMART_DEPLOY_BRIEF_V1_SCHEMA_VERSION
    && validBriefEnvelope(input)
    && isMissionSnapshot(input.mission)
    && isSections(input.sections);
}

function isV2Brief(input: unknown): input is SmartDeployBriefV2 {
  if (!isRecord(input) || input.schemaVersion !== SMART_DEPLOY_BRIEF_SCHEMA_VERSION || !validBriefEnvelope(input)
    || !isRecord(input.activation) || !nonEmptyString(input.activation.program) || !nonEmptyString(input.activation.reference)
    || !isRecord(input.plannedOperatingSite) || !isRecord(input.plannedOperatingSite.location)
    || !['provider_reference_default', 'operator_selected_current_device', 'operator_planned_override'].includes(String(input.plannedOperatingSite.source))
    || !nonEmptyString(input.plannedOperatingSite.description)
    || !isRecord(input.propagationObjective) || input.propagationObjective.kind !== 'regional' || !nonEmptyString(input.propagationObjective.regionId) || !nonEmptyString(input.propagationObjective.regionLabel)
    || !isRecord(input.missionWindow) || !validDateString(input.missionWindow.start) || !validDateString(input.missionWindow.midpoint) || !validDateString(input.missionWindow.end)
    || !isRecord(input.station) || !isRecord(input.station.radio) || !isRecord(input.station.antenna) || !Array.isArray(input.station.selectedModes)
    || !input.station.selectedModes.every(mode => typeof mode === 'string') || (input.station.modeledMode !== null && typeof input.station.modeledMode !== 'string')
    || typeof input.station.transmitPowerWatts !== 'number' || !Number.isFinite(input.station.transmitPowerWatts)
    || !isV2Sections(input.sections)) return false;
  return input.currentDeviceLocation === undefined || isRecord(input.currentDeviceLocation);
}

function validBriefEnvelope(input: Record<string, any>): boolean {
  return nonEmptyString(input.briefId)
    && validDateString(input.generatedAtUtc)
    && ['complete', 'partial', 'unavailable'].includes(String(input.status))
    && Array.isArray(input.limitations)
    && input.limitations.every(isLimitation)
    && typeof input.summary === 'string';
}

function isV2Sections(input: unknown): boolean {
  if (!isRecord(input)) return false;
  const required = ['activation', 'plannedOperatingSite', 'currentDevice', 'propagationObjective', 'missionWindow', 'station', 'propagation', 'solar', 'observedRf'];
  return required.every(key => {
    const section = input[key];
    if (!isRecord(section) || typeof section.status !== 'string') return false;
    return key === 'currentDevice' ? section.evidence === undefined || isRecord(section.evidence) : isRecord(section.evidence);
  });
}