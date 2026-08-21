import { describe, expect, it } from 'vitest';
import { buildOperationsReadinessSummary, type OperationsReadinessInput } from '../operationsReadiness';

const evaluatedAtUtc = '2026-08-20T12:00:00.000Z';
const source = (id: string) => ({ id, type: 'test', name: id });
const brief = (status: 'complete' | 'partial' = 'complete') => ({
  schemaVersion: 2, briefId: 'brief-1', generatedAtUtc: evaluatedAtUtc, status,
  activation: { program: 'SOTA', reference: 'W4V/SH-001', displayName: 'High Knob', coordinates: { lat: 37, lon: -82 }, provenance: { kind: 'externally_resolved' } },
  plannedOperatingSite: { location: { coordinates: { lat: 37, lon: -82 }, gridSquare: 'EM87aa', provenance: 'manual', status: 'degraded', source: source('planned') }, source: 'operator_planned_override', description: 'Operator-entered planned location' },
  propagationObjective: { kind: 'regional', regionId: 'mid_atlantic', regionLabel: 'Mid Atlantic' }, missionWindow: { start: evaluatedAtUtc, midpoint: evaluatedAtUtc, end: '2026-08-20T16:00:00.000Z' },
  station: { radio: { name: 'Xiegu G90' }, antenna: { type: 'EFHW' }, selectedModes: ['SSB'], modeledMode: 'SSB', transmitPowerWatts: 20 },
  sections: {} as any, limitations: [], summary: 'test',
} as any);
const potaBrief = (status: 'complete' | 'partial' = 'complete') => ({ ...brief(status), activation: { ...brief(status).activation, program: 'POTA', reference: 'US-5503' } });
const baseInput = (): OperationsReadinessInput => ({
  evaluatedAtUtc, plan: { brief: brief(), sotaDataset: { status: 'available', source: source('sota'), downloadedAtUtc: evaluatedAtUtc } },
  currentLocation: { status: 'current', provenance: 'current', source: source('gnss'), observedAtUtc: evaluatedAtUtc },
  power: { status: 'Available', chargePercent: 80, powerSource: 'Battery', charging: false, runtimeSeconds: 7200, runtimeValid: true, source: source('windows'), observedAtUtc: evaluatedAtUtc },
  weather: { status: 'live', source: source('weather'), observedAtUtc: evaluatedAtUtc }, alerts: { status: 'live', active: [], source: source('alerts'), observedAtUtc: evaluatedAtUtc },
  propagation: { status: 'modeled', source: source('p533'), observedAtUtc: evaluatedAtUtc }, checklist: { completedItems: 14, totalItems: 14, source: source('checklist'), updatedAtUtc: evaluatedAtUtc }, activationNotes: { count: 0, source: source('notes') },
});

describe('buildOperationsReadinessSummary', () => {
  it('evaluates complete supported SOTA evidence deterministically', () => { const result = buildOperationsReadinessSummary(baseInput()); expect(result.plan.status).toBe('ready'); expect(result.toughBook.runtimeEstimateSeconds).toBe(7200); expect(result.stationEndurance.status).toBe('unknown'); });
  it('does not label provider-success weather evidence as fresh without a freshness rule', () => { const result = buildOperationsReadinessSummary(baseInput()); expect(result.findings.find(finding => finding.id === 'weather')).not.toHaveProperty('freshness'); expect(result.findings.find(finding => finding.id === 'weather-alerts')).not.toHaveProperty('freshness'); });
  it('reports no retained brief and missing or stale locations honestly', () => { const base = baseInput(); const input = { ...base, plan: { ...base.plan, brief: null }, currentLocation: { ...base.currentLocation, status: 'stale' as const, provenance: 'stale' as const } }; const result = buildOperationsReadinessSummary(input); expect(result.plan.status).toBe('blocked'); expect(result.currentLocation.status).toBe('stale'); expect(result.findings.find(f => f.id === 'plan-missing')?.status).toBe('blocked'); });
  it('distinguishes manual and GNSS location provenance', () => { const base = baseInput(); const input = { ...base, currentLocation: { ...base.currentLocation, status: 'manual' as const, provenance: 'manual' as const } }; expect(buildOperationsReadinessSummary(input).currentLocation).toMatchObject({ status: 'attention', provenance: 'manual' }); });
  it('keeps missing and invalid runtime unknown without deriving it from charge', () => { const base = baseInput(); const input = { ...base, power: { ...base.power, runtimeSeconds: null, runtimeValid: false } }; const result = buildOperationsReadinessSummary(input); expect(result.toughBook.runtimeEstimateSeconds).toBeNull(); expect(result.findings.find(f => f.id === 'toughbook-runtime-estimate')?.status).toBe('unknown'); expect(result.stationEndurance.status).toBe('unknown'); });
  it('labels valid runtime as a Windows ToughBook estimate', () => { const finding = buildOperationsReadinessSummary(baseInput()).findings.find(f => f.id === 'toughbook-runtime-estimate'); expect(finding?.message).toContain('Windows reports an estimated'); expect(finding?.limitation).toContain('not radio or station endurance'); });
  it('prioritizes live severe weather alerts without blocking the operation', () => { const base = baseInput(); const input = { ...base, alerts: { ...base.alerts!, active: [{ id: 'alert-1', severity: 'Severe' as const, title: 'High Wind Warning' }] } }; const finding = buildOperationsReadinessSummary(input).findings.find(f => f.id === 'weather-alerts'); expect(finding).toMatchObject({ status: 'attention', priority: 'high' }); expect(finding?.message).toContain('High Wind Warning'); });
  it('preserves weather and propagation distinctions', () => { const base = baseInput(); const input = { ...base, weather: { ...base.weather!, status: 'unavailable' as const }, propagation: { ...base.propagation, status: 'observed-only' as const } }; const result = buildOperationsReadinessSummary(input); expect(result.findings.find(f => f.id === 'weather')?.status).toBe('unavailable'); expect(result.findings.find(f => f.id === 'propagation-evidence')?.message).toContain('observational only'); });
  it('allows stale SOTA data with an explicit warning', () => { const base = baseInput(); const input = { ...base, plan: { ...base.plan, sotaDataset: { ...base.plan.sotaDataset, status: 'stale' as const } } }; const finding = buildOperationsReadinessSummary(input).findings.find(f => f.id === 'sota-dataset-state'); expect(finding).toMatchObject({ status: 'stale', message: 'SOTA summit data is stale but usable for planning.' }); });
  it('reports incomplete checklist without claiming equipment absence', () => { const base = baseInput(); const input = { ...base, checklist: { ...base.checklist!, completedItems: 3 } }; const finding = buildOperationsReadinessSummary(input).findings.find(f => f.id === 'field-readiness-checklist'); expect(finding?.status).toBe('attention'); expect(finding?.limitation).toContain('not proof'); });
  it('keeps clock synchronization unknown and Local/NVIS unsupported', () => { const result = buildOperationsReadinessSummary(baseInput()); expect(result.findings.find(f => f.id === 'clock-synchronization')).toMatchObject({ status: 'unknown', source: { id: 'clock-sync-unverified' } }); expect(result.findings.find(f => f.id === 'clock-synchronization')?.source.id).not.toBe('unsupported'); expect(result.findings.find(f => f.id === 'local-nvis')).toMatchObject({ status: 'unsupported', source: { id: 'unsupported' } }); });
  it('uses the supplied evaluation timestamp and stable finding order', () => { const input = { ...baseInput(), evaluatedAtUtc: '2030-01-01T00:00:00.000Z' }; const first = buildOperationsReadinessSummary(input); const second = buildOperationsReadinessSummary(input); expect(first.evaluatedAtUtc).toBe('2030-01-01T00:00:00.000Z'); expect(first.findings.map(f => f.id)).toEqual(second.findings.map(f => f.id)); expect(first.findings.every(f => f.evaluatedAtUtc === input.evaluatedAtUtc)).toBe(true); });
  it('degrades missing optional evidence without throwing', () => { const { weather: _weather, alerts: _alerts, checklist: _checklist, ...input } = baseInput(); const result = buildOperationsReadinessSummary(input); expect(result.findings.find(f => f.id === 'weather')?.status).toBe('unavailable'); expect(result.findings.find(f => f.id === 'field-readiness-checklist')?.status).toBe('unknown'); });
  it('reports unavailable current location and stale weather', () => { const base = baseInput(); const input = { ...base, currentLocation: { ...base.currentLocation, status: 'unavailable' as const, provenance: 'unavailable' as const }, weather: { ...base.weather!, status: 'stale' as const } }; const result = buildOperationsReadinessSummary(input); expect(result.findings.find(f => f.id === 'current-location')?.status).toBe('unavailable'); expect(result.findings.find(f => f.id === 'weather')?.status).toBe('stale'); });
  it('rejects non-finite and negative runtime values while accepting zero', () => { for (const runtimeSeconds of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) { const base = baseInput(); const result = buildOperationsReadinessSummary({ ...base, power: { ...base.power, runtimeSeconds } }); expect(result.toughBook.runtimeEstimateSeconds).toBeNull(); expect(result.findings.find(f => f.id === 'toughbook-runtime-estimate')?.status).toBe('unknown'); } const zero = buildOperationsReadinessSummary({ ...baseInput(), power: { ...baseInput().power, runtimeSeconds: 0 } }); expect(zero.toughBook.runtimeEstimateSeconds).toBe(0); expect(zero.findings.find(f => f.id === 'toughbook-runtime-estimate')?.status).toBe('ready'); });
  it('preserves partial, stale, and unavailable propagation states', () => { for (const [status, expected] of [['partial', 'attention'], ['stale', 'stale'], ['unavailable', 'unavailable']] as const) { const result = buildOperationsReadinessSummary({ ...baseInput(), propagation: { ...baseInput().propagation, status } }); expect(result.findings.find(f => f.id === 'propagation-evidence')?.status).toBe(expected); } });
  it('reports Activation Notes presence without treating notes as proof of readiness', () => { const result = buildOperationsReadinessSummary(baseInput()); const finding = result.findings.find(f => f.id === 'activation-notes'); expect(finding).toMatchObject({ status: 'ready', message: 'No Activation Notes have been recorded for this brief.' }); });
  it('keeps planned site distinct from current device location', () => { const result = buildOperationsReadinessSummary(baseInput()); expect(result.plan.plannedSite).toBe('Operator-entered planned location'); expect(result.currentLocation.provenance).toBe('current'); });
  it('reports unavailable SOTA data without discarding the retained plan', () => { const base = baseInput(); const input = { ...base, plan: { ...base.plan, sotaDataset: { ...base.plan.sotaDataset, status: 'unavailable' as const } } }; const result = buildOperationsReadinessSummary(input); expect(result.plan.status).toBe('ready'); expect(result.findings.find(f => f.id === 'sota-dataset-state')?.status).toBe('unavailable'); });
  it('attributes a missing plan to the evaluator rather than the SOTA dataset', () => { const base = baseInput(); const result = buildOperationsReadinessSummary({ ...base, plan: { ...base.plan, brief: null } }); expect(result.findings.find(f => f.id === 'plan-missing')?.source.id).toBe('operations-readiness-evaluator'); });
  it('does not overclaim GNSS for a non-GNSS current location source', () => { const base = baseInput(); const result = buildOperationsReadinessSummary({ ...base, currentLocation: { ...base.currentLocation, source: source('configured-location') } }); const finding = result.findings.find(f => f.id === 'current-location'); expect(finding?.message).toBe('Current operating location is available.'); expect(finding?.source.id).toBe('configured-location'); });
  it('keeps stale and unavailable severe alerts from becoming current active alerts', () => { const severe = [{ id: 'alert-1', severity: 'Severe' as const, title: 'High Wind Warning' }]; const stale = buildOperationsReadinessSummary({ ...baseInput(), alerts: { ...baseInput().alerts!, status: 'stale', active: severe } }).findings.find(f => f.id === 'weather-alerts'); const unavailable = buildOperationsReadinessSummary({ ...baseInput(), alerts: { ...baseInput().alerts!, status: 'unavailable', active: severe } }).findings.find(f => f.id === 'weather-alerts'); expect(stale).toMatchObject({ status: 'stale', priority: 'high' }); expect(stale?.message).toContain('not confirmed current'); expect(unavailable).toMatchObject({ status: 'unavailable', priority: 'medium' }); expect(unavailable?.message).toBe('Weather alerts are unavailable.'); expect(unavailable?.recommendedAction).toBeUndefined(); expect(unavailable?.message).not.toContain('High Wind Warning'); });
  it('reports live Extreme alerts as advisory attention', () => { const result = buildOperationsReadinessSummary({ ...baseInput(), alerts: { ...baseInput().alerts!, active: [{ id: 'alert-1', severity: 'Extreme', title: 'Tornado Warning' }] } }); expect(result.findings.find(f => f.id === 'weather-alerts')).toMatchObject({ status: 'attention', priority: 'high' }); });
  it('reports live Moderate and Minor alerts deterministically', () => { const result = buildOperationsReadinessSummary({ ...baseInput(), alerts: { ...baseInput().alerts!, active: [{ id: 'minor', severity: 'Minor', title: 'Minor Advisory' }, { id: 'moderate', severity: 'Moderate', title: 'Flood Watch' }] } }); const finding = result.findings.find(f => f.id === 'weather-alerts'); expect(finding).toMatchObject({ status: 'attention', priority: 'medium' }); expect(finding?.message).toContain('Flood Watch'); });
  it('selects Unknown ahead of Minor while keeping Moderate ahead of Unknown', () => {
    const result = buildOperationsReadinessSummary({ ...baseInput(), alerts: { ...baseInput().alerts!, active: [
      { id: 'minor', severity: 'Minor', title: 'Minor Advisory' },
      { id: 'unknown', severity: 'Unknown', title: 'Unclassified Alert' },
      { id: 'moderate', severity: 'Moderate', title: 'Flood Watch' },
    ] } });
    const finding = result.findings.find(f => f.id === 'weather-alerts');
    expect(finding).toMatchObject({ status: 'attention', priority: 'medium' });
    expect(finding?.message).toContain('Flood Watch');

    const unknownOnly = buildOperationsReadinessSummary({ ...baseInput(), alerts: { ...baseInput().alerts!, active: [{ id: 'unknown', severity: 'Unknown', title: 'Unclassified Alert' }] } });
    const unknownFinding = unknownOnly.findings.find(f => f.id === 'weather-alerts');
    expect(unknownFinding).toMatchObject({ status: 'attention', priority: 'medium' });
    expect(unknownFinding?.message.toLowerCase()).toContain('unknown');
    expect(unknownFinding?.status).not.toBe('blocked');
  });

  it('orders equal-severity alerts deterministically after severity ordering', () => {
    const alerts = [
      { id: 'unknown-b', severity: 'Unknown' as const, title: 'Beta' },
      { id: 'unknown-a', severity: 'Unknown' as const, title: 'Alpha' },
      { id: 'minor', severity: 'Minor' as const, title: 'Minor Advisory' },
    ];
    const input = { ...baseInput(), alerts: { ...baseInput().alerts!, active: alerts } };
    const first = buildOperationsReadinessSummary(input).findings.find(f => f.id === 'weather-alerts');
    const second = buildOperationsReadinessSummary(input).findings.find(f => f.id === 'weather-alerts');
    expect(first?.message).toBe(second?.message);
    expect(first?.message).toContain('Alpha');
  });
  it('uses activation program semantics and gates SOTA evidence', () => {
    const pota = buildOperationsReadinessSummary({ ...baseInput(), plan: { ...baseInput().plan, brief: potaBrief() } });
    expect(pota.findings.find(f => f.id === 'plan-retained')?.message).toBe('A retained POTA SmartDeploy plan is available.');
    expect(pota.findings.some(f => f.message.includes('SOTA'))).toBe(false);
    expect(pota.findings.find(f => f.id === 'sota-dataset-state')).toBeUndefined();
    const sota = buildOperationsReadinessSummary(baseInput());
    expect(sota.findings.find(f => f.id === 'plan-retained')?.message).toBe('A retained SOTA SmartDeploy plan is available.');
    expect(sota.findings.find(f => f.id === 'sota-dataset-state')?.message).toBe('SOTA summit data is available.');
  });
  it.each([
    ['before', '2026-08-20T11:59:59.999Z', 'The retained mission window is upcoming.', 'ready'],
    ['at start', '2026-08-20T12:00:00.000Z', 'Evaluation is within the retained mission window.', 'ready'],
    ['during', '2026-08-20T14:00:00.000Z', 'Evaluation is within the retained mission window.', 'ready'],
    ['at end', '2026-08-20T16:00:00.000Z', 'Evaluation is within the retained mission window.', 'ready'],
    ['after', '2026-08-20T16:00:00.001Z', 'The retained mission window has ended.', 'attention'],
  ] as const)('classifies mission window at %s deterministically', (_label, evaluatedAtUtc, message, status) => {
    const finding = buildOperationsReadinessSummary({ ...baseInput(), evaluatedAtUtc }).findings.find(f => f.id === 'mission-window');
    expect(finding).toMatchObject({ message, status });
    expect(finding).not.toHaveProperty('observedAtUtc');
  });
  it('keeps malformed mission timestamps unknown and recommends a current window after completion', () => {
    const malformed = buildOperationsReadinessSummary({ ...baseInput(), plan: { ...baseInput().plan, brief: { ...brief(), missionWindow: { start: 'not-a-date', midpoint: evaluatedAtUtc, end: evaluatedAtUtc } } } });
    expect(malformed.findings.find(f => f.id === 'mission-window')).toMatchObject({ status: 'unknown' });
    expect(malformed.findings.find(f => f.id === 'mission-window')).not.toHaveProperty('observedAtUtc');
    const completed = buildOperationsReadinessSummary({ ...baseInput(), evaluatedAtUtc: '2026-08-20T16:00:00.001Z' }).findings.find(f => f.id === 'mission-window');
    expect(completed?.recommendedAction).toContain('current operating window');
    expect(completed?.message).not.toMatch(/safety|legality|permission|go-no-go/i);
  });
});
