import { describe, expect, it, vi } from 'vitest';
import { assembleOperationsReadiness, type OperationsReadinessAssemblyDependencies } from '../operationsReadinessAssembly';
import type { SmartDeployBriefV2 } from '../smartDeployBrief';
import { LocalSotaSummitDataset } from '../sotaSummitDataset';

const evaluatedAtUtc = '2026-08-19T12:00:00.000Z';
const source = { id: 'test', type: 'test', name: 'Test source' };

function brief(briefId = 'brief-1', schemaVersion: 2 | 1 = 2): SmartDeployBriefV2 {
  return {
    schemaVersion,
    briefId,
    generatedAtUtc: evaluatedAtUtc,
    status: 'complete',
    activation: { program: 'SOTA', reference: 'W1/AM-001', displayName: 'Test Summit', coordinates: null, provenance: { kind: 'externally_resolved' } },
    plannedOperatingSite: { location: {} as never, source: 'operator_planned_override', description: 'Test site' },
    propagationObjective: { kind: 'regional', regionId: 'eastern_us', regionLabel: 'Test region' },
    missionWindow: { start: evaluatedAtUtc, midpoint: evaluatedAtUtc, end: evaluatedAtUtc },
    station: { radio: {} as never, antenna: {} as never, selectedModes: [], modeledMode: null, transmitPowerWatts: 10 },
    sections: {
      activation: { status: 'available', evidence: {} as never },
      plannedOperatingSite: { status: 'derived', evidence: {} as never },
      currentDevice: { status: 'available', evidence: {} as never },
      propagationObjective: { status: 'available', evidence: {} as never },
      missionWindow: { status: 'available', evidence: {} as never },
      station: { status: 'available', evidence: {} as never },
      propagation: { status: 'complete', evidence: { generatedAtUtc: evaluatedAtUtc, summary: { limitations: ['Retained only.'] } } as never },
      solar: { status: 'available', evidence: {} as never },
      observedRf: { status: 'available', evidence: {} as never },
    },
    limitations: [],
    summary: 'Retained test brief',
  } as unknown as SmartDeployBriefV2;
}

function dependencies(overrides: Partial<OperationsReadinessAssemblyDependencies> = {}): OperationsReadinessAssemblyDependencies {
  return {
    briefStore: { get: vi.fn(() => ({ status: 'found', brief: brief(), diagnostics: [] })) } as never,
    sotaDatasetReader: () => LocalSotaSummitDataset.unavailable(),
    checklistStore: { getByBriefId: vi.fn(() => ({ status: 'missing', checklists: [], diagnostics: [{ code: 'missing', message: 'none' }] })) } as never,
    activationNotesStore: { getByBriefId: vi.fn(() => ({ status: 'missing', collections: [], diagnostics: [{ code: 'missing', message: 'none' }] })) } as never,
    readLocation: vi.fn(async () => ({ status: 'Available', latitude: 42, longitude: -71, timestampUtc: evaluatedAtUtc, source: 'SerialNmea' })) as never,
    readSystem: vi.fn(async () => ({ status: 'Available', observedAtUtc: evaluatedAtUtc, source: 'WindowsPowerStatus', chargePercent: 80, charging: false, powerSource: 'Battery', remainingRuntimeSeconds: 3600 })) as never,
    now: () => new Date(evaluatedAtUtc),
    ...overrides,
  };
}

describe('Operations Readiness assembly', () => {
  it('assembles one exact V2 brief with retained propagation and unavailable weather', async () => {
    const deps = dependencies();
    const result = await assembleOperationsReadiness('brief-1', deps);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.summary.evaluatedAtUtc).toBe(evaluatedAtUtc);
    expect(result.summary.plan.briefId).toBe('brief-1');
    expect(result.summary.toughBook.runtimeEstimateSeconds).toBe(3600);
    expect(result.summary.findings.find(finding => finding.id === 'weather')?.status).toBe('unavailable');
    expect(result.summary.findings.find(finding => finding.id === 'propagation-evidence')?.status).toBe('attention');
    expect(result.summary.findings.some(finding => finding.limitation?.includes('Retained only.'))).toBe(true);
    expect(deps.briefStore.get).toHaveBeenCalledWith('brief-1');
  });

  it('does not synthesize runtime from charge percentage', async () => {
    const result = await assembleOperationsReadiness('brief-1', dependencies({
      readSystem: vi.fn(async () => ({ status: 'Available', observedAtUtc: evaluatedAtUtc, source: 'WindowsPowerStatus', chargePercent: 80, charging: false, powerSource: 'Battery', remainingRuntimeSeconds: null })) as never,
    }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.summary.toughBook.runtimeEstimateSeconds).toBeNull();
  });

  it('keeps optional store failures diagnostic and safe', async () => {
    const result = await assembleOperationsReadiness('brief-1', dependencies({
      checklistStore: { getByBriefId: () => { throw new Error('C:\\private\\path'); } } as never,
      activationNotesStore: { getByBriefId: () => ({ status: 'invalid', collections: [], diagnostics: [{ code: 'io_error', message: 'internal path' }] }) } as never,
    }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['checklist_unavailable', 'activation_notes_unavailable']);
      expect(JSON.stringify(result)).not.toContain('private');
    }
  });

  it('rejects V1 and never reads optional evidence', async () => {
    const checklist = vi.fn();
    const result = await assembleOperationsReadiness('brief-v1', dependencies({
      briefStore: { get: () => ({ status: 'found', brief: brief('brief-v1', 1), diagnostics: [] }) } as never,
      checklistStore: { getByBriefId: checklist } as never,
    }));
    expect(result.status).toBe('unsupported');
    expect(checklist).not.toHaveBeenCalled();
  });

  it('maps an unavailable location to an unavailable finding without claiming coordinates', async () => {
    const result = await assembleOperationsReadiness('brief-1', dependencies({
      readLocation: vi.fn(async () => ({ status: 'NoFix', latitude: null, longitude: null, timestampUtc: null, source: 'SerialNmea' })) as never,
    }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.summary.currentLocation.status).toBe('unavailable');
  });
});
