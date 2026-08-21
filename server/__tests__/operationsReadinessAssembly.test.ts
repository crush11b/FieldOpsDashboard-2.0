import { describe, expect, it, vi } from 'vitest';
import { assembleOperationsReadiness, type OperationsReadinessAssemblyDependencies } from '../operationsReadinessAssembly';
import type { SmartDeployBriefV2 } from '../smartDeployBrief';
import { LocalSotaSummitDataset } from '../sotaSummitDataset';

const evaluatedAtUtc = '2026-08-19T12:00:00.000Z';

function brief(briefId = 'brief-1', schemaVersion: 2 | 1 = 2, propagationStatus = 'complete'): SmartDeployBriefV2 {
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
      propagation: { status: propagationStatus, evidence: { generatedAtUtc: evaluatedAtUtc, summary: { limitations: ['Retained only.'] } } as never },
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
      expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['checklist_unavailable', 'activation_notes_unavailable', 'local_weather_alerts_unavailable']);
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

  it.each([
    [-90, -180], [0, 0], [90, 180],
  ])('accepts valid location boundary coordinates (%s, %s)', async (latitude, longitude) => {
    const result = await assembleOperationsReadiness('brief-1', dependencies({
      readLocation: vi.fn(async () => ({ status: 'Available', latitude, longitude, timestampUtc: evaluatedAtUtc, source: 'SerialNmea' })) as never,
    }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.summary.currentLocation.status).toBe('ready');
  });

  it.each([
    ['missing', null, 1], ['NaN', Number.NaN, 1], ['Infinity', Number.POSITIVE_INFINITY, 1],
    ['latitude out of range', 90.1, 1], ['longitude out of range', 1, 180.1],
  ])('diagnoses Available location with %s coordinates', async (_label, latitude, longitude) => {
    const result = await assembleOperationsReadiness('brief-1', dependencies({
      readLocation: vi.fn(async () => ({ status: 'Available', latitude, longitude, timestampUtc: evaluatedAtUtc, source: 'SerialNmea' })) as never,
    }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.summary.currentLocation.status).toBe('unavailable');
      expect(result.diagnostics.some(diagnostic => diagnostic.code === 'malformed_location_telemetry')).toBe(true);
    }
  });

  it.each(['NoFix', 'Initializing', 'Unavailable', 'Error'] as const)('maps %s location status to its safe diagnostic', async status => {
    const result = await assembleOperationsReadiness('brief-1', dependencies({
      readLocation: vi.fn(async () => ({ status, latitude: null, longitude: null, timestampUtc: null, source: 'SerialNmea' })) as never,
    }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.diagnostics.some(diagnostic => diagnostic.code === (status === 'Error' ? 'malformed_location_telemetry' : 'location_telemetry_unavailable'))).toBe(true);
  });

  it('maps a thrown location reader to unavailable telemetry', async () => {
    const result = await assembleOperationsReadiness('brief-1', dependencies({ readLocation: vi.fn(async () => { throw new Error('private path'); }) as never }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.diagnostics.some(diagnostic => diagnostic.code === 'location_telemetry_unavailable')).toBe(true);
  });

  it.each(['Unavailable', 'Error'] as const)('does not preserve power values from %s telemetry', async status => {
    const result = await assembleOperationsReadiness('brief-1', dependencies({
      readSystem: vi.fn(async () => ({ status, observedAtUtc: null, source: 'WindowsPowerStatus', chargePercent: 75, charging: true, powerSource: 'AC', remainingRuntimeSeconds: 7200 })) as never,
    }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.summary.toughBook).toMatchObject({ chargePercent: null, powerSource: 'Unknown', charging: null, runtimeEstimateSeconds: null });
      expect(result.diagnostics.some(diagnostic => diagnostic.code === 'system_observation_timestamp_unavailable')).toBe(true);
    }
  });

  it('preserves valid zero charge, runtime, and observation timestamp', async () => {
    const result = await assembleOperationsReadiness('brief-1', dependencies({
      readSystem: vi.fn(async () => ({ status: 'Available', observedAtUtc: evaluatedAtUtc, source: 'WindowsPowerStatus', chargePercent: 0, charging: false, powerSource: 'Battery', remainingRuntimeSeconds: 0 })) as never,
    }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.summary.toughBook).toMatchObject({ chargePercent: 0, runtimeEstimateSeconds: 0, powerSource: 'Battery' });
  });

  it.each([null, 'not-a-timestamp'])('diagnoses Available telemetry without a valid observation timestamp', async observedAtUtc => {
    const result = await assembleOperationsReadiness('brief-1', dependencies({
      readSystem: vi.fn(async () => ({ status: 'Available', observedAtUtc, source: 'WindowsPowerStatus', chargePercent: 50, charging: false, powerSource: 'Battery', remainingRuntimeSeconds: 10 })) as never,
    }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.diagnostics.some(diagnostic => diagnostic.code === 'malformed_system_telemetry')).toBe(true);
  });

  it.each([
    ['missing', () => ({ status: 'notFound', diagnostics: [{ code: 'missing', message: 'No store.' }] })],
    ['corrupt', () => ({ status: 'notFound', diagnostics: [{ code: 'corrupt', message: 'Root invalid.' }] })],
  ] as const)('classifies a %s brief-store result', async (label, get) => {
    const result = await assembleOperationsReadiness('brief-1', dependencies({ briefStore: { get } as never }));
    expect(result.status).toBe(label === 'missing' ? 'notFound' : 'unavailable');
  });

  it('isolates the requested brief ID and does not cross optional evidence', async () => {
    const requested = vi.fn((_briefId: string) => ({ status: 'found', brief: brief('requested'), diagnostics: [] }));
    const checklist = vi.fn((briefId: string) => ({ status: 'missing', checklists: [], diagnostics: [{ code: 'missing', message: briefId }] }));
    const result = await assembleOperationsReadiness('requested', dependencies({ briefStore: { get: requested } as never, checklistStore: { getByBriefId: checklist } as never }));
    expect(result.status).toBe('ok');
    expect(requested).toHaveBeenCalledWith('requested');
    expect(checklist).toHaveBeenCalledWith('requested');
  });

  it('maps present checklist and zero-note evidence without confusing them with missing evidence', async () => {
    const result = await assembleOperationsReadiness('brief-1', dependencies({
      checklistStore: { getByBriefId: () => ({ status: 'loaded', checklists: [{ briefId: 'brief-1', updatedAtUtc: evaluatedAtUtc, sections: [{ items: [{ completed: true }, { completed: false }] }, { items: [{ completed: true }] }] }], diagnostics: [{ code: 'invalid_checklist', message: 'Skipped unrelated record.' }] }) } as never,
      activationNotesStore: { getByBriefId: () => ({ status: 'loaded', collections: [{ briefId: 'brief-1', notes: [], updatedAtUtc: evaluatedAtUtc }], diagnostics: [{ code: 'invalid_collection', message: 'Skipped unrelated record.' }] }) } as never,
    }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.summary.findings.find(finding => finding.id === 'field-readiness-checklist')?.message).toContain('2/3');
      expect(result.summary.findings.find(finding => finding.id === 'activation-notes')?.message).toContain('(0 recorded)');
      expect(result.diagnostics).toContainEqual({ code: 'local_weather_alerts_unavailable', message: expect.any(String) });
    }
  });

  it.each([
    ['complete', 'modeled'], ['partial', 'partial'], ['stale', 'stale'], ['unavailable', 'unavailable'],
  ] as const)('maps retained %s propagation evidence', async (briefStatus, expected) => {
    const result = await assembleOperationsReadiness('brief-1', dependencies({ briefStore: { get: () => ({ status: 'found', brief: brief('brief-1', 2, briefStatus), diagnostics: [] }) } as never }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.summary.findings.find(finding => finding.id === 'propagation-evidence')?.status).toBe(expected === 'stale' ? 'stale' : expected === 'unavailable' ? 'unavailable' : 'attention');
  });

  it.each(['AVAILABLE', 'STALE', 'UNAVAILABLE'] as const)('maps SOTA dataset state %s', async state => {
    const dataset = state === 'UNAVAILABLE' ? LocalSotaSummitDataset.unavailable() : new LocalSotaSummitDataset(new Map(), { sourceVersion: null, downloadedAtUtc: evaluatedAtUtc, stale: state === 'STALE', sourceId: 'sota-summit-database', sourceName: 'SOTA', sourceUrl: 'local' });
    const result = await assembleOperationsReadiness('brief-1', dependencies({ sotaDatasetReader: () => dataset }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.summary.findings.find(finding => finding.id === 'sota-dataset-state')?.status).toBe(state === 'AVAILABLE' ? 'ready' : state === 'STALE' ? 'stale' : 'unavailable');
  });

  it('returns a bounded unavailable result for thrown or invalid evaluation clocks', async () => {
    for (const now of [() => { throw new Error('private clock'); }, () => new Date(Number.NaN)]) {
      const result = await assembleOperationsReadiness('brief-1', dependencies({ now }));
      expect(result).toEqual({ status: 'unavailable', diagnostics: [{ code: 'evaluation_clock_unavailable', message: 'The Operations Readiness evaluation clock is unavailable.' }] });
    }
  });

  it('keeps weather and alerts unavailable with an explicit local-only limitation', async () => {
    const result = await assembleOperationsReadiness('brief-1', dependencies());
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.summary.findings.find(finding => finding.id === 'weather')).toMatchObject({ status: 'unavailable' });
      expect(result.summary.findings.find(finding => finding.id === 'weather-alerts')).toMatchObject({ status: 'unavailable' });
      expect(result.diagnostics.find(diagnostic => diagnostic.code === 'local_weather_alerts_unavailable')?.message).toContain('no live weather request was performed');
    }
  });
});
