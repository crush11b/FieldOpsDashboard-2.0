import { latLonToGridSquare } from '../src/types';
import type { ActivationTarget } from '../src/planning/smartDeployPlanning';
import type { ActivationTargetRequest, ActivationTargetResolution, ActivationTargetResolver } from './activationTargetResolver';
import { LocalSotaSummitDataset, normalizeSotaReference, SOTA_SUMMIT_SOURCE_ID, SOTA_SUMMIT_SOURCE_NAME, SOTA_SUMMIT_SOURCE_TYPE } from './sotaSummitDataset';

export type SotaTargetResolutionStatus = 'cached' | 'stale' | 'unknown' | 'unavailable' | 'invalid' | 'unsupported';
export interface SotaTargetResolution extends ActivationTargetResolution { readonly status: SotaTargetResolutionStatus; }

export class SotaActivationTargetResolver implements ActivationTargetResolver {
  constructor(private readonly datasetSource: LocalSotaSummitDataset | (() => LocalSotaSummitDataset)) {}

  async resolve(request: ActivationTargetRequest): Promise<SotaTargetResolution> {
    if (request.program !== 'SOTA') return { status: 'unsupported', reference: request.reference, error: `The ${request.program} activation target is not supported.` };
    const reference = normalizeSotaReference(request.reference);
    if (!reference) return { status: 'invalid', reference: typeof request.reference === 'string' ? request.reference.trim() : '' };
    const dataset = typeof this.datasetSource === 'function' ? this.datasetSource() : this.datasetSource;
    if (dataset.state === 'UNAVAILABLE') return { status: 'unavailable', reference, error: 'SOTA summit data is unavailable offline.' };
    const summit = dataset.get(reference);
    if (!summit) return { status: 'unknown', reference };
    const resolvedAtUtc = dataset.metadata?.downloadedAtUtc;
    const target: ActivationTarget = {
      program: 'SOTA', reference: summit.reference, displayName: summit.name,
      coordinates: { lat: summit.latitude, lon: summit.longitude },
      gridSquare: latLonToGridSquare(summit.latitude, summit.longitude) || undefined,
      provenance: { kind: 'externally_resolved', source: { id: SOTA_SUMMIT_SOURCE_ID, type: SOTA_SUMMIT_SOURCE_TYPE, name: SOTA_SUMMIT_SOURCE_NAME }, ...(resolvedAtUtc ? { resolvedAtUtc } : {}) },
    };
    const status = dataset.state === 'STALE' ? 'stale' : 'cached';
    return { status, reference, target, ...(resolvedAtUtc ? { retrievedAtUtc: resolvedAtUtc } : {}), ...(status === 'stale' ? { error: 'SOTA summit data is stale.' } : {}) };
  }
}