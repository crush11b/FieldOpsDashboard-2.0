import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AuthenticatedAgentIdentity,
  TelemetryCredentialResolver,
} from './telemetryReceiver';

export const TELEMETRY_CREDENTIAL_SCHEMA_VERSION = 1;
export const TELEMETRY_TOKEN_BYTES = 32;
export const TELEMETRY_WRITE_SCOPE = 'telemetry:write';
export const DEFAULT_RECEIVER_CREDENTIAL_RELATIVE_PATH = path.join(
  'FieldOpsDashboard',
  'Dashboard',
  'telemetry-credentials.json',
);

const MAX_CREDENTIAL_FILE_BYTES = 64 * 1024;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/;
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface TelemetryCredentialRecord {
  readonly agentId: string;
  readonly tokenDigest: string;
  readonly scopes: readonly string[];
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly rotatedAt?: string;
}

interface TelemetryCredentialFile {
  readonly schemaVersion: 1;
  readonly records: readonly TelemetryCredentialRecord[];
}

export function generateTelemetryBearerCredential(): string {
  return randomBytes(TELEMETRY_TOKEN_BYTES).toString('base64url');
}

export function digestTelemetryBearerToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

export function constantTimeDigestEquals(left: string, right: string): boolean {
  const leftBytes = decodeDigest(left);
  const rightBytes = decodeDigest(right);
  const comparableRight = rightBytes ?? Buffer.alloc(TELEMETRY_TOKEN_BYTES);
  const comparableLeft = leftBytes ?? Buffer.alloc(TELEMETRY_TOKEN_BYTES);
  const equal = timingSafeEqual(comparableLeft, comparableRight);
  return leftBytes !== null && rightBytes !== null && equal;
}

export function getDefaultTelemetryCredentialPath(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = environment.FIELDOPS_TELEMETRY_CREDENTIAL_FILE?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  const programData = environment.ProgramData?.trim() || environment.PROGRAMDATA?.trim();
  return programData ? path.join(programData, DEFAULT_RECEIVER_CREDENTIAL_RELATIVE_PATH) : null;
}

export class FileTelemetryCredentialRepository implements TelemetryCredentialResolver {
  constructor(readonly credentialPath: string) {
    if (!path.isAbsolute(credentialPath)) {
      throw new Error('Telemetry credential repository path must be absolute.');
    }
  }

  async resolveBearerToken(token: string): Promise<AuthenticatedAgentIdentity | null> {
    if (!isTransportSafeToken(token)) {
      return null;
    }

    const repository = await this.readRepository();
    if (!repository) {
      return null;
    }

    const candidateDigest = digestTelemetryBearerToken(token);
    let match: TelemetryCredentialRecord | null = null;
    for (const record of repository.records) {
      if (constantTimeDigestEquals(candidateDigest, record.tokenDigest) && record.enabled) {
        match = record;
      }
    }

    return match
      ? Object.freeze({ agentId: match.agentId, scopes: Object.freeze([...match.scopes]) })
      : null;
  }

  async isProvisioned(): Promise<boolean> {
    const repository = await this.readRepository();
    return repository?.records.some((record) => record.enabled) ?? false;
  }

  private async readRepository(): Promise<TelemetryCredentialFile | null> {
    try {
      const contents = await readFile(this.credentialPath);
      if (contents.length === 0 || contents.length > MAX_CREDENTIAL_FILE_BYTES) {
        return null;
      }
      return parseCredentialFile(JSON.parse(contents.toString('utf8')));
    } catch {
      return null;
    }
  }
}

function parseCredentialFile(value: unknown): TelemetryCredentialFile | null {
  if (!isRecord(value) || value.schemaVersion !== TELEMETRY_CREDENTIAL_SCHEMA_VERSION
    || !Array.isArray(value.records) || value.records.length === 0) {
    return null;
  }

  const records: TelemetryCredentialRecord[] = [];
  const agentIds = new Set<string>();
  const digests = new Set<string>();
  for (const candidate of value.records) {
    const record = parseCredentialRecord(candidate);
    if (!record || agentIds.has(record.agentId) || digests.has(record.tokenDigest)) {
      return null;
    }
    agentIds.add(record.agentId);
    digests.add(record.tokenDigest);
    records.push(record);
  }

  return Object.freeze({ schemaVersion: 1, records: Object.freeze(records) });
}

function parseCredentialRecord(value: unknown): TelemetryCredentialRecord | null {
  if (!isRecord(value)
    || typeof value.agentId !== 'string' || !AGENT_ID.test(value.agentId)
    || typeof value.tokenDigest !== 'string' || decodeDigest(value.tokenDigest) === null
    || !Array.isArray(value.scopes) || value.scopes.length === 0
    || !value.scopes.every((scope) => typeof scope === 'string' && scope.length > 0)
    || new Set(value.scopes).size !== value.scopes.length
    || typeof value.enabled !== 'boolean'
    || !isIsoTimestamp(value.createdAt)
    || (value.rotatedAt !== undefined && !isIsoTimestamp(value.rotatedAt))) {
    return null;
  }

  const scopes = value.scopes as string[];
  const rotatedAt = value.rotatedAt as string | undefined;
  return Object.freeze({
    agentId: value.agentId,
    tokenDigest: value.tokenDigest,
    scopes: Object.freeze([...scopes]),
    enabled: value.enabled,
    createdAt: value.createdAt,
    ...(rotatedAt === undefined ? {} : { rotatedAt }),
  });
}

function isTransportSafeToken(token: string): boolean {
  return BASE64URL_SHA256.test(token) && Buffer.from(token, 'base64url').length === TELEMETRY_TOKEN_BYTES;
}

function decodeDigest(digest: string): Buffer | null {
  if (!BASE64URL_SHA256.test(digest)) {
    return null;
  }
  const decoded = Buffer.from(digest, 'base64url');
  return decoded.length === TELEMETRY_TOKEN_BYTES ? decoded : null;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /(Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
