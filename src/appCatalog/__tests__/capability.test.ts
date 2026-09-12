import { describe, expect, it } from 'vitest';
import { CURATED_APP_CATALOG } from '../curatedCatalog';
import { APP_CAPABILITY_REGISTRY, isAppCapabilityId, isAppCatalogConfig, type AppCatalogRecord } from '../domain';
import { evaluateDependencyStates } from '../dependencies';
import { discoverApps } from '../discovery';

const clock = () => '2026-09-11T00:00:00.000Z';

describe('capability-aware application contract', () => {
  it('keeps capability IDs bounded, typed, unique, and valid', () => {
    const ids = APP_CAPABILITY_REGISTRY.map(capability => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => isAppCapabilityId(id))).toBe(true);
    expect(isAppCapabilityId('fieldops-controls-radio')).toBe(false);
  });

  it('rejects noncanonical capability labels and malformed dependency IDs', () => {
    const record = CURATED_APP_CATALOG.records.find(candidate => candidate.id === 'wsjtx');
    if (!record) throw new Error('Expected WSJT-X.');
    expect(isAppCatalogConfig({
      ...CURATED_APP_CATALOG,
      records: [{ ...record, capabilities: [{ id: 'digital-operation', label: 'Radio control' }] }],
    })).toBe(false);
    expect(isAppCatalogConfig({
      ...CURATED_APP_CATALOG,
      records: [{ ...record, dependencies: [{ id: 'not a stable id', required: true }] }],
    })).toBe(false);
  });

  it('represents curated special cases without turning declarations into integration', () => {
    const record = (id: string) => CURATED_APP_CATALOG.records.find(candidate => candidate.id === id);
    expect(record('wsjtx')).toMatchObject({ capabilities: [{ id: 'digital-operation' }], dependencies: [] });
    expect(record('flrig')?.capabilities).toEqual([{ id: 'external-radio-control', label: 'External radio control' }]);
    expect(record('ht-commander')?.capabilities).toEqual([{ id: 'external-radio-control', label: 'External radio control' }]);
    expect(record('qso-one')?.capabilities.map(capability => capability.id)).toEqual(['network-voice', 'remote-operation']);
    expect(record('potacat')?.capabilities.map(capability => capability.id)).toEqual(['digital-operation', 'logging', 'remote-operation']);
    expect(record('aprsfi')?.capabilities.map(capability => capability.id)).toEqual(['web-only', 'mapping', 'aprs']);
    expect(record('sotlas')?.capabilities.map(capability => capability.id)).toEqual(['web-only', 'mapping']);
    expect(record('pota-spots')?.capabilities.map(capability => capability.id)).toEqual(['web-only', 'spot-viewing']);
    expect(record('pota-log-upload')?.capabilities.map(capability => capability.id)).toEqual(['web-only', 'manual-log-upload']);
    expect(record('sota-spots')?.capabilities.map(capability => capability.id)).toEqual(['web-only', 'spot-viewing']);
    expect(record('sota-log-upload')?.capabilities.map(capability => capability.id)).toEqual(['web-only', 'manual-log-upload']);
    expect(record('websdr')?.capabilities.map(capability => capability.id)).toEqual(['web-only', 'remote-reception']);
    expect(record('bkttimesync')).toMatchObject({ enabled: false, capabilities: [{ id: 'time-synchronization' }] });
    expect(record('antscope')?.capabilities).toEqual([{ id: 'antenna-analysis', label: 'Antenna analysis' }]);
    expect(record('wireguard')?.capabilities.map(capability => capability.id)).toEqual(['vpn', 'remote-operation']);
    expect(record('ham2k')?.capabilities).toEqual([]);
    expect(CURATED_APP_CATALOG.records.filter(candidate => candidate.category === 'Web Apps').every(candidate => candidate.capabilities.some(capability => capability.id === 'web-only'))).toBe(true);
    expect(record('winlink')?.capabilities.map(capability => capability.id)).toEqual(['digital-operation']);
    expect(record('js8call')?.capabilities.map(capability => capability.id)).toEqual(['digital-operation']);
    expect(record('mshv')?.capabilities.map(capability => capability.id)).toEqual(['digital-operation']);
    expect(record('fldigi')?.capabilities.map(capability => capability.id)).toEqual(['digital-operation', 'software-modem']);
    expect(record('yaac')?.capabilities.map(capability => capability.id)).toEqual(['aprs', 'mapping']);
    expect(record('direwolf')?.capabilities.map(capability => capability.id)).toEqual(['aprs', 'software-modem']);
    expect(record('pinpoint')?.capabilities.map(capability => capability.id)).toEqual(['aprs', 'mapping']);
    expect(record('gpredict')?.capabilities.map(capability => capability.id)).toEqual(['satellite-operations']);
    expect(record('uiss')?.capabilities.map(capability => capability.id)).toEqual(['satellite-operations']);
    expect(record('wiresx')?.capabilities.map(capability => capability.id)).toEqual(['network-voice']);
    expect(record('dstar')?.capabilities.map(capability => capability.id)).toEqual(['network-voice']);
    expect(record('hamrs')?.capabilities.map(capability => capability.id)).toEqual(['logging']);
    expect(record('n1mm')?.capabilities.map(capability => capability.id)).toEqual(['logging']);
  });

  it('evaluates dependency membership, configuration, enablement, runtime, and requirement independently', () => {
    const base = CURATED_APP_CATALOG.records.find(record => record.id === 'wsjtx');
    const dependency = CURATED_APP_CATALOG.records.find(record => record.id === 'otto');
    if (!base || !dependency) throw new Error('Expected curated records.');
    const source: AppCatalogRecord = { ...base, dependencies: [
      { id: 'missing-dependency', required: true },
      { id: 'otto', required: false },
      { id: 'unconfigured-dependency', required: true },
      { id: 'available-dependency', required: true },
    ] };
    const disabled = { ...dependency, enabled: false };
    const unconfigured = { ...dependency, id: 'unconfigured-dependency', enabled: true };
    const configured = { ...dependency, id: 'available-dependency', enabled: true, target: { kind: 'native' as const, executablePath: 'C:\\Otto\\otto.exe' } };
    const states = evaluateDependencyStates(source.dependencies, [source, disabled, unconfigured, configured], {
      wsjtx: { id: 'wsjtx', declaredCapabilities: [], configured: 'yes', enabled: 'yes', detected: 'yes', installed: 'unknown', available: 'yes', launch: 'unknown', evidenceSource: 'configured_path', reason: 'ok', observedAtUtc: clock(), dependencyStates: [] },
      'available-dependency': { id: 'available-dependency', declaredCapabilities: [], configured: 'yes', enabled: 'yes', detected: 'yes', installed: 'unknown', available: 'yes', launch: 'unknown', evidenceSource: 'configured_path', reason: 'found', observedAtUtc: clock(), dependencyStates: [] },
    });
    expect(states.map(state => state.status)).toEqual(['missing', 'disabled', 'unconfigured', 'available']);
    expect(states.map(state => state.required)).toEqual([true, false, true, true]);
    expect(states[0].catalogMembership).toBe('no');
    expect(states[1].enabled).toBe('no');
    expect(states[2].configured).toBe('no');
    expect(states[3].runtimeAvailability).toBe('yes');
    expect(evaluateDependencyStates([{ id: 'available-dependency', required: true }], [configured])[0].status).toBe('unknown');
    expect(evaluateDependencyStates([{ id: 'available-dependency', required: true }], [configured], { 'available-dependency': { id: 'available-dependency', declaredCapabilities: [], configured: 'yes', enabled: 'yes', detected: 'no', installed: 'unknown', available: 'no', launch: 'unknown', evidenceSource: 'configured_path', reason: 'missing', observedAtUtc: clock(), dependencyStates: [] } })[0].status).toBe('unavailable');
  });

  it('keeps discovery observations, dependency states, and FieldOps evidence separate', () => {
    const result = discoverApps(CURATED_APP_CATALOG.records, ['wsjtx', 'flrig', 'ham2k'], {}, () => 'missing', clock);
    expect(result.observations.wsjtx).toHaveProperty('dependencyStates');
    expect(result.observations.wsjtx.fieldOpsEvidence).toMatchObject({ kind: 'read-only-evidence', label: 'READ-ONLY EVIDENCE' });
    expect(result.observations.flrig.fieldOpsEvidence).toBeUndefined();
    expect(result.observations.flrig).not.toHaveProperty('capabilities');
    expect(result.observations.ham2k).toMatchObject({ enabled: 'no', available: 'no' });
  });
});
