import { describe, expect, it } from 'vitest';
import { assembleLayeredPropagationPicture } from '../layeredPicture';

const modeled = { summary: { strongestBandBySample: [{ band: '20m' }, { band: '20m' }, { band: '40m' }] } };
const context = { segmentId: 'segment-1', activationId: 'activation-1', startedAtUtc: '2026-09-05T00:00:00.000Z', radioSetupLabel: 'IC-705', antennaLabel: 'EFHW', transmitPowerWatts: 10, band: '15m', mode: 'FT8', provenance: { radioSetup: 'operator_entered', antenna: 'operator_entered', transmitPowerWatts: 'operator_entered', band: 'operator_entered', mode: 'operator_entered' } } as const;
const zero = { observationId: 'observation-1', activationId: 'activation-1', txContextSegmentId: 'segment-1', source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', startsAtUtc: '2026-09-05T00:00:00.000Z', endsAtUtc: '2026-09-05T00:05:00.000Z', status: 'live', matchingReportCount: 0, uniqueReceiverCount: 0, reportsPerMinute: 0, uniqueReceiversPerMinute: 0, newestMatchingReportAtUtc: null, limitations: ['No matching reports observed'] } as const;

describe('layered propagation picture', () => {
  it('keeps all four evidence families attributable and separate', () => {
    const picture = assembleLayeredPropagationPicture({ modeled, modeledStatus: 'complete', modeledAtUtc: '2026-09-05T00:00:00.000Z', missionWindow: { start: '2026-09-05T00:00:00.000Z', end: '2026-09-05T02:00:00.000Z' }, destinationLabel: 'Mid-Atlantic', forecast: { provider: { name: 'Open-Meteo' }, retrievedAtUtc: '2026-09-04T23:00:00.000Z' }, spaceWeather: { source: { name: 'NOAA SWPC' }, retrievedAtUtc: '2026-09-04T23:30:00.000Z', interpretation: { plainLanguageEffect: 'HF support is mixed.' } }, liveBandActivity: { status: 'live', source: { name: 'PSKReporter' }, observationWindow: { startsAt: '2026-09-05T00:00:00.000Z', endsAt: '2026-09-05T00:15:00.000Z' }, limitation: 'General activity only.', bands: [{ band: '15m', reportCount: 8 }] }, txContexts: [context as any], stationObservations: [zero] });
    expect(picture.layers.map(layer => layer.id)).toEqual(['modeled', 'environmental', 'general_observed_rf', 'station_signal']);
    expect(picture.layers.map(layer => layer.source)).toEqual(expect.arrayContaining([expect.stringContaining('P.533'), expect.stringContaining('Open-Meteo'), 'PSKReporter', expect.stringContaining('station-specific')]));
    expect(picture.relationships).toContainEqual(expect.stringContaining('Current TX band 15m differs'));
    expect(picture.relationships).toContainEqual(expect.stringContaining('General 15m activity is present'));
    expect(picture.limitation).toContain('No universal best-band score');
  });

  it('degrades missing layers independently without inventing a conclusion', () => {
    const picture = assembleLayeredPropagationPicture({ forecast: { provider: { name: 'Open-Meteo' }, retrievedAtUtc: '2026-09-04T23:00:00.000Z' } });
    expect(picture.layers.find(layer => layer.id === 'modeled')?.state).toBe('unavailable');
    expect(picture.layers.find(layer => layer.id === 'environmental')?.state).toBe('partial');
    expect(picture.layers.find(layer => layer.id === 'general_observed_rf')?.state).toBe('unavailable');
    expect(picture.layers.find(layer => layer.id === 'station_signal')?.state).toBe('unavailable');
    expect(picture.relationships).toEqual([]);
  });

  it('uses the newest retained station observation deterministically', () => {
    const older = { ...zero, observationId: 'older', endsAtUtc: '2026-09-05T00:02:00.000Z' };
    const newer = { ...zero, observationId: 'newer', endsAtUtc: '2026-09-05T00:08:00.000Z', status: 'stale' as const, matchingReportCount: 2, uniqueReceiverCount: 2, limitations: ['Retained observation.'] };
    const picture = assembleLayeredPropagationPicture({ txContexts: [context as any], stationObservations: [older, newer] });
    const layer = picture.layers.find(item => item.id === 'station_signal');
    expect(layer).toMatchObject({ state: 'stale', summary: '2 matching reports from 2 unique receivers.' });
    expect(layer?.timing).toContain('00:08:00.000Z');
  });

  it('associates a retained observation with its own closed TX Context', () => {
    const earlier = { ...context, segmentId: 'segment-earlier', endedAtUtc: '2026-09-05T00:03:00.000Z', band: '40m' as const };
    const observed = { ...context, segmentId: 'segment-observed', endedAtUtc: '2026-09-05T00:09:00.000Z', band: '20m' as const };
    const picture = assembleLayeredPropagationPicture({ txContexts: [earlier as any, observed as any], stationObservations: [{ ...zero, txContextSegmentId: 'segment-observed' }] });
    expect(picture.layers.find(layer => layer.id === 'station_signal')?.applicability).toContain('20m / FT8 / TX Context segment-observed');
    expect(picture.relationships.some(item => item.startsWith('Current TX band'))).toBe(false);
  });

  it('provides structured current meaning without blending the layers', () => {
    const picture = assembleLayeredPropagationPicture({ modeled, modeledStatus: 'complete', modeledAtUtc: '2026-09-05T00:00:00.000Z', txContexts: [context as any], stationObservations: [zero], objective: { requiredQsoCount: 4, deadlineUtc: '2026-09-05T01:00:00.000Z' }, completedQsos: 1 });
    expect(picture.whatThisMeansNow).toEqual(expect.arrayContaining([
      expect.stringContaining('zero matching reports'),
      expect.stringContaining('modeled alternative'),
      expect.stringContaining('Qualification progress is 1/4'),
      expect.stringContaining('layers disagree'),
    ]));
  });
});
