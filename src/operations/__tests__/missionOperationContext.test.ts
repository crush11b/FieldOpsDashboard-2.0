import { describe, expect, it } from 'vitest';
import { deriveMissionOperationContext } from '../missionOperationContext';

const brief = { schemaVersion: 2, briefId: 'brief-1', activation: { program: 'POTA', reference: 'US-1234', displayName: 'Test Park' }, plannedOperatingSite: { location: { coordinates: { lat: 37.4, lon: -77.4 }, gridSquare: 'FM17' }, description: 'Operator planned site' }, missionWindow: { start: '2026-09-20T12:00:00.000Z', end: '2026-09-20T16:00:00.000Z' }, station: { radio: { name: 'IC-705' }, antenna: { type: 'EFHW' }, selectedModes: ['SSB'], transmitPowerWatts: 10 }, loadoutSnapshot: { loadoutId: 'loadout-1', loadoutName: 'Portable', capturedAtUtc: '2026-09-16T00:00:00.000Z', items: [{}, {}] } } as any;

describe('mission operation context', () => {
  it('uses the retained brief for planned facts and the Activation only for lifecycle facts', () => {
    const activation = { activationId: 'activation-1', briefId: 'brief-1', type: 'POTA', reference: 'US-1234', status: 'active', startedAtUtc: '2026-09-20T12:05:00.000Z', missionWindow: { start: '2026-09-20T13:00:00.000Z', end: '2026-09-20T17:00:00.000Z' }, plannedLocation: { latitude: 38, longitude: -78 }, operatingObjective: { goal: 'secure_activation', label: 'Qualify POTA' } } as any;
    const context = deriveMissionOperationContext(brief, activation);
    expect(context.missionWindow).toEqual({ start: brief.missionWindow.start, end: brief.missionWindow.end });
    expect(context.plannedSite).toMatchObject({ gridSquare: 'FM17', latitude: 37.4, longitude: -77.4 });
    expect(context.lifecycle).toMatchObject({ activationId: 'activation-1', status: 'active', startedAtUtc: '2026-09-20T12:05:00.000Z' });
    expect(context.loadout).toMatchObject({ name: 'Portable', itemCount: 2 });
    expect(context.inconsistencies).toHaveLength(2);
  });

  it('keeps an unstarted plan explicit instead of inventing Activation state', () => {
    const context = deriveMissionOperationContext(brief, null);
    expect(context.lifecycle).toEqual({ activationId: null, status: 'not_started', startedAtUtc: null, endedAtUtc: null });
    expect(context.objective).toBeNull();
    expect(context.inconsistencies).toEqual([]);
  });
});
