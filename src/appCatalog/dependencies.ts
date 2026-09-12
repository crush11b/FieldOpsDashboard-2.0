import { isCatalogTargetConfigured, type AppCatalogDependency, type AppCatalogRecord, type CatalogTruth } from './domain';
import type { AppDiscoveryObservation } from './discovery';

export type DependencyEvaluationStatus = 'missing' | 'disabled' | 'unconfigured' | 'unknown' | 'available' | 'unavailable';

export interface AppCatalogDependencyState {
  readonly id: string;
  readonly required: boolean;
  readonly catalogMembership: CatalogTruth;
  readonly enabled: CatalogTruth;
  readonly configured: CatalogTruth;
  readonly runtimeAvailability: CatalogTruth;
  readonly status: DependencyEvaluationStatus;
  readonly reason: string;
}

const boundedReason = (reason: string): string => reason.slice(0, 256);

export function evaluateDependencyStates(
  dependencies: readonly AppCatalogDependency[],
  records: readonly AppCatalogRecord[],
  observations: Readonly<Record<string, AppDiscoveryObservation>> = {},
): readonly AppCatalogDependencyState[] {
  const recordsById = new Map(records.map(record => [record.id, record]));
  return dependencies.map(dependency => {
    const record = recordsById.get(dependency.id);
    if (!record) return {
      id: dependency.id, required: dependency.required, catalogMembership: 'no', enabled: 'unknown', configured: 'unknown', runtimeAvailability: 'unknown',
      status: 'missing', reason: boundedReason('The dependency is not a member of the catalog.'),
    };
    const configured: CatalogTruth = isCatalogTargetConfigured(record.target) ? 'yes' : 'no';
    if (!record.enabled) return {
      id: dependency.id, required: dependency.required, catalogMembership: 'yes', enabled: 'no', configured, runtimeAvailability: 'unknown',
      status: 'disabled', reason: boundedReason('The dependency is cataloged but disabled.'),
    };
    if (configured === 'no') return {
      id: dependency.id, required: dependency.required, catalogMembership: 'yes', enabled: 'yes', configured, runtimeAvailability: 'unknown',
      status: 'unconfigured', reason: boundedReason('The dependency is enabled but has no supported configured target.'),
    };
    const runtimeAvailability = observations[dependency.id]?.available ?? 'unknown';
    if (runtimeAvailability === 'yes') return {
      id: dependency.id, required: dependency.required, catalogMembership: 'yes', enabled: 'yes', configured, runtimeAvailability,
      status: 'available', reason: boundedReason('Runtime discovery reports the dependency available.'),
    };
    if (runtimeAvailability === 'no' || runtimeAvailability === 'unsupported') return {
      id: dependency.id, required: dependency.required, catalogMembership: 'yes', enabled: 'yes', configured, runtimeAvailability,
      status: 'unavailable', reason: boundedReason('Runtime discovery does not report the dependency available.'),
    };
    return {
      id: dependency.id, required: dependency.required, catalogMembership: 'yes', enabled: 'yes', configured, runtimeAvailability: 'unknown',
      status: 'unknown', reason: boundedReason('Runtime availability evidence is unknown.'),
    };
  });
}