import type { ActivationTarget } from '../src/planning/smartDeployPlanning';

export interface ActivationTargetRequest {
  readonly program: string;
  readonly reference: string;
}

export type ActivationTargetResolutionStatus = 'live' | 'cached' | 'stale' | 'unknown' | 'unavailable' | 'invalid' | 'unsupported';

export interface ActivationTargetResolution {
  readonly status: ActivationTargetResolutionStatus;
  readonly reference: string;
  readonly target?: ActivationTarget;
  readonly retrievedAtUtc?: string;
  readonly refreshAttemptedAtUtc?: string;
  readonly error?: string;
}

export interface ActivationTargetResolver {
  resolve(request: ActivationTargetRequest): Promise<ActivationTargetResolution>;
}

export function normalizeActivationTargetRequest(input: unknown): ActivationTargetRequest | null {
  if (!isRecord(input)) return null;
  const program = normalizeString(input.program)?.toUpperCase();
  const reference = normalizeString(input.reference);
  return program && reference ? { program, reference } : null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}