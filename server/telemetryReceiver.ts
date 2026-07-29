import express, { type NextFunction, type Request, type Response } from 'express';

import type { TelemetryEnvelope, TelemetryStatus } from '../src/telemetry';
import { TELEMETRY_STATUSES } from '../src/telemetry';

export const TELEMETRY_MAX_BODY_BYTES = 64 * 1024;
export const TELEMETRY_MAX_JSON_DEPTH = 32;

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_SOURCE_ID_LENGTH = 128;
const MAX_SOURCE_TYPE_LENGTH = 128;
const MAX_SOURCE_LABEL_LENGTH = 256;
const MAX_ERROR_CODE_LENGTH = 128;
const MAX_ERROR_TEXT_LENGTH = 2 * 1024;
const TELEMETRY_WRITE_SCOPE = 'telemetry:write';
const TELEMETRY_READ_SCOPE = 'telemetry:read';
const ISO_TIMESTAMP_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface AuthenticatedAgentIdentity {
  readonly agentId: string;
  readonly scopes: readonly string[];
}

export interface TelemetryCredentialResolver {
  resolveBearerToken(token: string): Promise<AuthenticatedAgentIdentity | null>;
}

export interface ReceivedTelemetryEntry {
  readonly agent: AuthenticatedAgentIdentity;
  readonly sourceId: string;
  readonly ingestedAt: string;
  readonly envelope: TelemetryEnvelope<unknown>;
}

export interface TelemetrySnapshot {
  readonly entries: readonly ReceivedTelemetryEntry[];
}

export interface LatestTelemetryStore {
  upsert(agent: AuthenticatedAgentIdentity, envelope: TelemetryEnvelope<unknown>): void;
  getSnapshot(): TelemetrySnapshot;
}

export class InMemoryLatestTelemetryStore implements LatestTelemetryStore {
  private readonly entriesByAgent = new Map<string, Map<string, ReceivedTelemetryEntry>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  upsert(agent: AuthenticatedAgentIdentity, envelope: TelemetryEnvelope<unknown>): void {
    let agentEntries = this.entriesByAgent.get(agent.agentId);
    if (!agentEntries) {
      agentEntries = new Map<string, ReceivedTelemetryEntry>();
      this.entriesByAgent.set(agent.agentId, agentEntries);
    }

    const ownedAgent = deepFreeze({
      agentId: agent.agentId,
      scopes: [...agent.scopes],
    });
    const ownedEnvelope = deepFreeze(structuredClone(envelope));
    agentEntries.set(envelope.source.id, deepFreeze({
      agent: ownedAgent,
      sourceId: envelope.source.id,
      ingestedAt: this.now().toISOString(),
      envelope: ownedEnvelope,
    }));
  }

  getSnapshot(): TelemetrySnapshot {
    const entries = [...this.entriesByAgent.values()]
      .flatMap((agentEntries) => [...agentEntries.values()])
      .sort((left, right) =>
        left.agent.agentId.localeCompare(right.agent.agentId)
        || left.sourceId.localeCompare(right.sourceId));

    return { entries };
  }
}

export interface TelemetryReceiverOptions {
  readonly credentialResolver: TelemetryCredentialResolver;
  readonly store: LatestTelemetryStore;
  readonly now?: () => Date;
  readonly enableDiagnosticSnapshot?: boolean;
}

export const rejectAllTelemetryCredentials: TelemetryCredentialResolver = {
  async resolveBearerToken() {
    return null;
  },
};

export function createTelemetryReceiverRouter(options: TelemetryReceiverOptions): express.Router {
  const router = express.Router();
  const now = options.now ?? (() => new Date());
  const jsonParser = express.json({
    limit: TELEMETRY_MAX_BODY_BYTES,
    strict: false,
  });

  router.post(
    '/api/v1/telemetry',
    enforceDeclaredBodySize,
    authenticate(options.credentialResolver, TELEMETRY_WRITE_SCOPE),
    requireJsonContentType,
    jsonParser,
    (request, response) => {
      const validation = validateTelemetryEnvelope(request.body, now());
      if (!validation.valid) {
        return sendProblem(response, 422, 'invalid_envelope', 'The telemetry envelope is invalid.');
      }

      const agent = response.locals.telemetryAgent as AuthenticatedAgentIdentity;
      options.store.upsert(agent, validation.envelope);
      return response.status(204).end();
    },
  );

  if (options.enableDiagnosticSnapshot) {
    router.get(
      '/api/v1/telemetry/snapshot',
      authenticate(options.credentialResolver, TELEMETRY_READ_SCOPE),
      (_request, response) => response.json(options.store.getSnapshot()),
    );
  }

  router.all('/api/v1/telemetry', (_request, response) =>
    sendProblem(response, 405, 'method_not_allowed', 'The HTTP method is not supported.'));

  router.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
    if (!request.path.startsWith('/api/v1/telemetry')) {
      return next(error);
    }

    if (isBodyTooLargeError(error)) {
      return sendProblem(response, 413, 'payload_too_large', 'The telemetry request is too large.');
    }

    if (error instanceof SyntaxError) {
      return sendProblem(response, 400, 'malformed_json', 'The request body is not valid JSON.');
    }

    return sendProblem(response, 500, 'receiver_failure', 'The telemetry receiver could not process the request.');
  });

  return router;
}

function enforceDeclaredBodySize(request: Request, response: Response, next: NextFunction): void {
  const contentLength = request.headers['content-length'];
  if (typeof contentLength === 'string') {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > TELEMETRY_MAX_BODY_BYTES) {
      sendProblem(response, 413, 'payload_too_large', 'The telemetry request is too large.');
      return;
    }
  }

  next();
}

function requireJsonContentType(request: Request, response: Response, next: NextFunction): void {
  if (!request.is('application/json')) {
    sendProblem(response, 415, 'unsupported_media_type', 'Content-Type must be application/json.');
    return;
  }

  next();
}

function authenticate(credentialResolver: TelemetryCredentialResolver, requiredScope: string) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const token = parseBearerToken(request.headers.authorization);
    if (!token) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      sendProblem(response, 401, 'unauthorized', 'Authentication is required.');
      return;
    }

    let agent: AuthenticatedAgentIdentity | null;
    try {
      agent = await credentialResolver.resolveBearerToken(token);
    } catch {
      sendProblem(response, 500, 'authentication_failure', 'Telemetry authentication could not be completed.');
      return;
    }

    if (!agent) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      sendProblem(response, 401, 'unauthorized', 'Authentication is required.');
      return;
    }

    if (!isAuthenticatedAgentIdentity(agent)) {
      sendProblem(response, 500, 'authentication_failure', 'Telemetry authentication could not be completed.');
      return;
    }

    if (!agent.scopes.includes(requiredScope)) {
      sendProblem(response, 403, 'forbidden', 'The authenticated agent is not authorized for this operation.');
      return;
    }

    response.locals.telemetryAgent = agent;
    next();
  };
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }

  const match = /^Bearer ([^\s,]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

type ValidationResult =
  | { readonly valid: true; readonly envelope: TelemetryEnvelope<unknown> }
  | { readonly valid: false };

export function validateTelemetryEnvelope(value: unknown, now: Date): ValidationResult {
  if (!isRecord(value) || exceedsJsonDepth(value, TELEMETRY_MAX_JSON_DEPTH)) {
    return { valid: false };
  }

  if (!isTelemetryStatus(value.status) || !isRecord(value.source) || !isRecord(value.timestamps)) {
    return { valid: false };
  }

  if (!isRequiredString(value.source.id, MAX_SOURCE_ID_LENGTH)
    || !isRequiredString(value.source.type, MAX_SOURCE_TYPE_LENGTH)
    || !isOptionalString(value.source.name, MAX_SOURCE_LABEL_LENGTH)
    || !isOptionalString(value.source.version, MAX_SOURCE_LABEL_LENGTH)
    || !isOptionalRecord(value.source.metadata)
    || !isOptionalRecord(value.metadata)) {
    return { valid: false };
  }

  const observedAt = parseCanonicalTimestamp(value.timestamps.observedAt);
  const receivedAt = parseCanonicalTimestamp(value.timestamps.receivedAt);
  const expiresAt = value.timestamps.expiresAt === undefined
    ? null
    : parseCanonicalTimestamp(value.timestamps.expiresAt);
  if (observedAt === null || receivedAt === null
    || (value.timestamps.expiresAt !== undefined && expiresAt === null)) {
    return { valid: false };
  }

  const futureLimit = now.getTime() + MAX_FUTURE_SKEW_MS;
  if (observedAt > futureLimit || receivedAt > futureLimit
    || (expiresAt !== null && expiresAt < observedAt)) {
    return { valid: false };
  }

  const hasData = Object.prototype.hasOwnProperty.call(value, 'data');
  const hasError = Object.prototype.hasOwnProperty.call(value, 'error');
  if ((value.status === 'ok' || value.status === 'degraded') && (!hasData || hasError)) {
    return { valid: false };
  }
  if (value.status !== 'error' && hasError) {
    return { valid: false };
  }
  if (value.status === 'error' && (!hasError || !isTelemetryError(value.error))) {
    return { valid: false };
  }

  return { valid: true, envelope: value as unknown as TelemetryEnvelope<unknown> };
}

function isTelemetryStatus(value: unknown): value is TelemetryStatus {
  return typeof value === 'string' && (TELEMETRY_STATUSES as readonly string[]).includes(value);
}

function isTelemetryError(value: unknown): boolean {
  return isRecord(value)
    && isRequiredString(value.code, MAX_ERROR_CODE_LENGTH)
    && isRequiredString(value.message, MAX_ERROR_TEXT_LENGTH)
    && typeof value.retryable === 'boolean'
    && isOptionalRecord(value.details)
    && isOptionalString(value.cause, MAX_ERROR_TEXT_LENGTH);
}

function parseCanonicalTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = ISO_TIMESTAMP_WITH_OFFSET.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRequiredString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isOptionalString(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

function isOptionalRecord(value: unknown): boolean {
  return value === undefined || value === null || isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exceedsJsonDepth(value: unknown, maximumDepth: number): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > maximumDepth) {
      return true;
    }
    if (typeof current.value !== 'object' || current.value === null) {
      continue;
    }

    const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
    for (const child of children) {
      if (typeof child === 'object' && child !== null) {
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }

  return false;
}

function isAuthenticatedAgentIdentity(value: AuthenticatedAgentIdentity): boolean {
  return isRequiredString(value.agentId, MAX_SOURCE_ID_LENGTH)
    && Array.isArray(value.scopes)
    && value.scopes.every((scope) => typeof scope === 'string');
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function isBodyTooLargeError(error: unknown): boolean {
  return isRecord(error) && error.type === 'entity.too.large';
}

function sendProblem(response: Response, status: number, code: string, title: string): Response {
  return response
    .status(status)
    .type('application/problem+json')
    .json({
      type: `urn:fieldops:telemetry:${code}`,
      title,
      status,
    });
}
