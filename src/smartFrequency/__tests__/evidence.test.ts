import { describe, expect, it } from 'vitest';
import { SMART_FREQUENCY_EVIDENCE_FAMILIES, isSmartFrequencyEvidence, validateSmartFrequencyEvidence, type SmartFrequencyEvidenceRecord } from '../evidence';

const source = { sourceId: 'source:example', sourceName: 'Example source', providerName: 'Example provider', attribution: 'Example provider attribution', permittedUse: 'unknown' as const, supportStatus: 'unknown' as const };
const cache = { cacheAllowed: false, cachedAvailable: false, offlineAvailable: false, freshnessWindowSeconds: null };
const timestamp = '2026-09-12T12:00:00.000Z';
const observationWindow = { startsAtUtc: '2026-09-12T11:00:00.000Z', endsAtUtc: timestamp };

function evidence(family: SmartFrequencyEvidenceRecord['family'], overrides: Record<string, unknown> = {}): SmartFrequencyEvidenceRecord {
  const common = { evidenceId: `evidence:${family}`, family, state: 'live', source, band: '20m', frequencyHz: 14_074_000, modeScope: 'FT8', locationScope: { kind: 'global' }, observedAtUtc: timestamp, receivedAtUtc: '2026-09-12T12:30:00.000Z', expiresAtUtc: '2026-09-12T13:00:00.000Z', cache, limitations: ['Evidence only.'], semantics: '' };
  const payloads: Record<SmartFrequencyEvidenceRecord['family'], Record<string, unknown>> = {
    'modeled-propagation': { state: 'modeled', semantics: 'propagation-opportunity-not-occupancy', modelIdentity: 'p533', modelRevision: '2026.1', modelEvaluationAtUtc: timestamp },
    'general-observed-rf': { semantics: 'digital-reception-not-ssb-occupancy', observationWindow, observationCount: 3 },
    'station-specific-reception': { semantics: 'station-specific-reception-not-general-occupancy', stationId: 'station:alpha', observationWindow, reportCount: 2 },
    'attributed-activity-spot': { semantics: 'activity-or-intent-not-occupancy', program: 'POTA', spotId: 'spot:1', activationReference: 'K-1234', activatorCallsign: 'W1ABC', spotterCallsign: 'N0XYZ' },
    'actual-qso-result': { semantics: 'historical-station-specific-success', qsoId: 'qso:1', localCallsign: 'W1ABC', remoteCallsign: 'N0XYZ' },
    'digital-activity-reference': { semantics: 'established-digital-activity-reference', referenceId: 'reference:ft8-20m' },
    'frequency-occupancy-observation': { semantics: 'direct-frequency-occupancy-or-interference-observation', observationCount: 0, observationWindow, observingStationId: 'station:observer', observationFrequencyRange: { lowerHz: 14_073_000, upperHz: 14_075_000 }, occupiedFrequencyRange: null },
  };
  return { ...common, ...payloads[family], ...overrides } as unknown as SmartFrequencyEvidenceRecord;
}

describe('SmartFrequency evidence foundation', () => {
  it('validates every family with its required payload', () => { for (const family of SMART_FREQUENCY_EVIDENCE_FAMILIES) expect(validateSmartFrequencyEvidence(evidence(family)), family).toMatchObject({ valid: true }); });
  it('rejects duplicate fields and undeclared properties at every nested boundary', () => {
    for (const key of ['spotFrequencyHz', 'spotMode', 'sourceTimestampUtc', 'centerFrequencyHz']) expect(validateSmartFrequencyEvidence({ ...evidence('attributed-activity-spot'), [key]: 1 }).valid).toBe(false);
    expect(validateSmartFrequencyEvidence({ ...evidence('general-observed-rf'), recommendation: 'best frequency' }).valid).toBe(false);
    expect(validateSmartFrequencyEvidence({ ...evidence('general-observed-rf'), source: { ...source, BEST_FREQUENCY: 14_074_000 } }).valid).toBe(false);
    expect(validateSmartFrequencyEvidence({ ...evidence('general-observed-rf'), cache: { ...cache, score: 1 } }).valid).toBe(false);
    expect(validateSmartFrequencyEvidence({ ...evidence('general-observed-rf'), locationScope: { kind: 'global', latitude: 37.1, longitude: -77.4 } }).valid).toBe(false);
    expect(validateSmartFrequencyEvidence({ ...evidence('general-observed-rf'), observationWindow: { ...observationWindow, clearFrequency: true } }).valid).toBe(false);
  });
  it('enforces family-specific band, frequency, and mode requirements', () => {
    expect(validateSmartFrequencyEvidence(evidence('modeled-propagation', { frequencyHz: null })).valid).toBe(true);
    expect(validateSmartFrequencyEvidence(evidence('station-specific-reception', { frequencyHz: null })).valid).toBe(true);
    expect(validateSmartFrequencyEvidence(evidence('actual-qso-result', { frequencyHz: null })).valid).toBe(true);
    expect(validateSmartFrequencyEvidence(evidence('digital-activity-reference', { band: null })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('digital-activity-reference', { frequencyHz: null })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('attributed-activity-spot', { band: null })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('attributed-activity-spot', { frequencyHz: null })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('attributed-activity-spot', { modeScope: 'all' })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('actual-qso-result', { band: null })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('actual-qso-result', { modeScope: null })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('modeled-propagation', { modeScope: null })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('general-observed-rf', { modeScope: 'all' })).valid).toBe(true);
    expect(validateSmartFrequencyEvidence(evidence('general-observed-rf', { modeScope: null })).valid).toBe(false);
  });
  it('enforces cache and state coherence', () => {
    expect(validateSmartFrequencyEvidence(evidence('general-observed-rf', { state: 'modeled' })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('general-observed-rf', { state: 'cached' })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('general-observed-rf', { state: 'stale' })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('general-observed-rf', { state: 'cached', cache: { cacheAllowed: true, cachedAvailable: true, offlineAvailable: true, freshnessWindowSeconds: 900 } })).valid).toBe(true);
    expect(validateSmartFrequencyEvidence(evidence('general-observed-rf', { cache: { ...cache, freshnessWindowSeconds: 0 } })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('general-observed-rf', { cache: { ...cache, freshnessWindowSeconds: 31_536_001 } })).valid).toBe(false);
  });
  it('enforces timestamp and observation-window coherence', () => {
    expect(validateSmartFrequencyEvidence(evidence('general-observed-rf', { state: 'unavailable', observedAtUtc: null, receivedAtUtc: null })).valid).toBe(true);
    expect(validateSmartFrequencyEvidence(evidence('general-observed-rf', { receivedAtUtc: '2026-09-12T11:00:00.000Z' })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('general-observed-rf', { expiresAtUtc: '2026-09-12T11:59:00.000Z' })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('general-observed-rf', { observationWindow: { startsAtUtc: '2026-09-12T11:00:00.000Z', endsAtUtc: '2026-09-12T13:00:00.000Z' } })).valid).toBe(false);
  });
  it('validates band frequency truth and monitored/occupied ranges', () => {
    expect(validateSmartFrequencyEvidence(evidence('general-observed-rf', { band: '40m' })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('frequency-occupancy-observation', { observationFrequencyRange: { lowerHz: 13_999_000, upperHz: 14_075_000 } })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('frequency-occupancy-observation', { frequencyHz: 14_076_000 })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('frequency-occupancy-observation', { observationFrequencyRange: { lowerHz: 14_073_000, upperHz: 14_075_000 }, frequencyHz: 14_074_000, occupiedFrequencyRange: { lowerHz: 14_072_000, upperHz: 14_074_000 }, observationCount: 1 })).valid).toBe(false);
  });
  it('requires zero occupancy to have no occupied range and positive occupancy to have a contained range', () => {
    expect(isSmartFrequencyEvidence(evidence('frequency-occupancy-observation', { observationCount: 0, occupiedFrequencyRange: null }))).toBe(true);
    expect(validateSmartFrequencyEvidence(evidence('frequency-occupancy-observation', { observationCount: 0, occupiedFrequencyRange: { lowerHz: 14_073_000, upperHz: 14_074_000 } })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('frequency-occupancy-observation', { observationCount: 1, occupiedFrequencyRange: null })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('frequency-occupancy-observation', { observationCount: 1, occupiedFrequencyRange: { lowerHz: 14_073_500, upperHz: 14_074_500 } })).valid).toBe(true);
  });
  it('preserves evidence truth boundaries and rejects recommendation/control output', () => {
    expect(validateSmartFrequencyEvidence(evidence('attributed-activity-spot', { semantics: 'direct-frequency-occupancy-or-interference-observation' })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('actual-qso-result', { semantics: 'direct-frequency-occupancy-or-interference-observation' })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence(evidence('modeled-propagation', { semantics: 'direct-frequency-occupancy-or-interference-observation' })).valid).toBe(false);
    expect(validateSmartFrequencyEvidence({ ...evidence('frequency-occupancy-observation'), clearFrequency: true }).valid).toBe(false);
  });
});
