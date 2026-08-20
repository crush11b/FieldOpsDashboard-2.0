import express, { type Router } from 'express';
import { latLonToGridSquare } from '../src/types';
import { parseCoordinates, type Coordinates } from '../src/location/coordinates';
import type { ActivationTarget, PlanningInputProvenance } from '../src/planning/smartDeployPlanning';
import { getProductUserAgent } from '../src/productMetadata';
import type { ActivationTargetRequest, ActivationTargetResolution, ActivationTargetResolver } from './activationTargetResolver';

export const POTA_TARGET_ENDPOINT = 'https://api.pota.app/park';
export const POTA_TARGET_TIMEOUT_MS = 5_000;
export const POTA_TARGET_FRESH_MS = 6 * 60 * 60 * 1000;
export const POTA_TARGET_STALE_MS = 7 * 24 * 60 * 60 * 1000;
export const POTA_TARGET_SOURCE_ID = 'pota-api';
export const POTA_TARGET_SOURCE_TYPE = 'pota_individual_park_api';
export const POTA_TARGET_SOURCE_NAME = 'POTA individual park API';

export type PotaTargetResolutionStatus = 'live' | 'cached' | 'stale' | 'unknown' | 'unavailable' | 'invalid' | 'unsupported';

export interface PotaTargetResolution extends ActivationTargetResolution { readonly status: PotaTargetResolutionStatus; }

export interface PotaTargetResolverOptions {
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

interface CachedTarget {
  readonly target: ActivationTarget;
  readonly retrievedAtUtc: string;
}

export class PotaActivationTargetResolver implements ActivationTargetResolver {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CachedTarget>();

  constructor(options: PotaTargetResolverOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? POTA_TARGET_TIMEOUT_MS;
  }

  async resolve(request: ActivationTargetRequest): Promise<PotaTargetResolution>;
  async resolve(input: unknown): Promise<PotaTargetResolution>;
  async resolve(input: unknown): Promise<PotaTargetResolution> {
    if (isTargetRequest(input) && input.program !== 'POTA') {
      return { status: 'unsupported', reference: input.reference, error: `The ${input.program} activation target is not supported.` };
    }
    const reference = normalizePotaReference(isTargetRequest(input) ? input.reference : input);
    if (!reference) return { status: 'invalid', reference: reference ?? StringValue(input) ?? '' };

    const cached = this.cache.get(reference);
    const now = this.now();
    const ageMs = cached ? now.getTime() - Date.parse(cached.retrievedAtUtc) : null;
    if (cached && ageMs !== null && Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= POTA_TARGET_FRESH_MS) {
      return { status: 'cached', reference, target: cached.target, retrievedAtUtc: cached.retrievedAtUtc };
    }

    const refreshAttemptedAtUtc = now.toISOString();
    try {
      const response = await this.fetchPark(reference);
      if (response.status === 404) return { status: 'unknown', reference, refreshAttemptedAtUtc };
      if (!response.ok) throw new Error('POTA provider returned an unsuccessful response.');
      const body: unknown = await response.json();
      if (body === null) return { status: 'unknown', reference, refreshAttemptedAtUtc };

      const retrievedAtUtc = this.now().toISOString();
      const target = normalizePotaResponse(body, reference, retrievedAtUtc);
      if (!target) throw new Error('POTA provider returned an unusable park response.');
      this.cache.set(reference, { target, retrievedAtUtc });
      return { status: 'live', reference, target, retrievedAtUtc, refreshAttemptedAtUtc };
    } catch (error) {
      if (cached && ageMs !== null && Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= POTA_TARGET_STALE_MS) {
        return {
          status: 'stale', reference, target: cached.target, retrievedAtUtc: cached.retrievedAtUtc,
          refreshAttemptedAtUtc, error: errorMessage(error),
        };
      }
      return { status: 'unavailable', reference, refreshAttemptedAtUtc, error: errorMessage(error) };
    }
  }

  private async fetchPark(reference: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(`${POTA_TARGET_ENDPOINT}/${encodeURIComponent(reference)}`, {
        headers: { Accept: 'application/json', 'User-Agent': getProductUserAgent('POTA API') },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createPotaTargetRouter(resolver: PotaActivationTargetResolver): Router {
  const router = express.Router();
  router.get('/api/pota-target', async (request, response) => {
    const result = await resolver.resolve(request.query.reference);
    if (result.status === 'invalid') {
      response.status(400).json(result);
      return;
    }
    if (result.status === 'unknown') {
      response.status(404).json(result);
      return;
    }
    if (result.status === 'unavailable') {
      response.status(503).json(result);
      return;
    }
    response.json(result);
  });
  return router;
}

export function normalizePotaReference(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const reference = input.trim().toUpperCase();
  return /^[A-Z]{2,}(?:-[A-Z0-9]+)*-[0-9]{4,}$/.test(reference) ? reference : null;
}

function normalizePotaResponse(input: unknown, requestedReference: string, retrievedAtUtc: string): ActivationTarget | null {
  if (!isRecord(input)) return null;
  const responseReference = normalizePotaReference(input.reference);
  if (!responseReference || responseReference !== requestedReference) return null;
  const coordinates = providerCoordinates(input);
  if (!coordinates) return null;
  const provenance: PlanningInputProvenance = {
    kind: 'externally_resolved',
    source: { id: POTA_TARGET_SOURCE_ID, type: POTA_TARGET_SOURCE_TYPE, name: POTA_TARGET_SOURCE_NAME },
    resolvedAtUtc: retrievedAtUtc,
  };
  const gridSquare = usableGrid(input.gridSquare ?? input.grid ?? input.maidenhead)
    ?? (latLonToGridSquare(coordinates.lat, coordinates.lon) || undefined);
  const displayName = stringValue(input.name ?? input.parkName ?? input.locationName);
  return {
    program: 'POTA',
    reference: responseReference,
    ...(displayName ? { displayName } : {}),
    coordinates,
    ...(gridSquare ? { gridSquare } : {}),
    provenance,
  };
}

function providerCoordinates(input: Record<string, unknown>): Coordinates | null {
  const latitude = input.latitude ?? input.lat;
  const longitude = input.longitude ?? input.lon ?? input.lng;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || typeof longitude !== 'number' || !Number.isFinite(longitude)) return null;
  return parseCoordinates(latitude, longitude);
}

function usableGrid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const grid = value.trim();
  return /^[A-R]{2}[0-9]{2}(?:[A-X]{2})?$/i.test(grid) ? grid : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function StringValue(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.includes('unusable')
    ? error.message
    : 'POTA provider is unavailable.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTargetRequest(value: unknown): value is ActivationTargetRequest {
  return isRecord(value) && typeof value.program === 'string' && typeof value.reference === 'string';
}