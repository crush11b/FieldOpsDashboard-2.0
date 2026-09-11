import { describe, expect, it } from 'vitest';
import type { AppCatalogRecord } from '../domain';
import { toCatalogRecord } from '../domain';
import {
  APP_DISCOVERY_MAX_CANDIDATE_PATHS,
  APP_DISCOVERY_MAX_REQUESTED_IDS,
  discoverApps,
  parseDiscoveryRequest,
  parseRequestedIds,
  type AppFileProbe,
  type AppFileProbeResult,
} from '../discovery';
import type { AppLauncherItem } from '../../types';

const CLOCK = () => '2026-09-11T00:00:00.000Z';

function legacyApp(overrides: Partial<AppLauncherItem> = {}): AppLauncherItem {
  return {
    id: 'field-tool',
    name: 'Field Tool',
    category: 'utilities',
    iconName: 'Radio',
    executablePath: 'C:\\Field\\tool.exe',
    description: 'A field tool',
    installed: false,
    favorite: false,
    ...overrides,
  };
}

function recordsFor(...apps: AppLauncherItem[]): AppCatalogRecord[] {
  return apps.map(app => toCatalogRecord(app)).filter((record): record is AppCatalogRecord => record !== null);
}

function probeReturning(results: Readonly<Record<string, AppFileProbeResult>>): AppFileProbe {
  return path => results[path] ?? 'missing';
}

describe('parseRequestedIds', () => {
  it('rejects non-array, empty, oversized, or malformed entries', () => {
    expect(parseRequestedIds('field-tool')).toMatchObject({ status: 'invalid_request' });
    expect(parseRequestedIds([])).toMatchObject({ status: 'invalid_request' });
    expect(parseRequestedIds(Array.from({ length: APP_DISCOVERY_MAX_REQUESTED_IDS + 1 }, (_, i) => `id-${i}`))).toMatchObject({ status: 'invalid_request' });
    expect(parseRequestedIds(['ok', 42])).toMatchObject({ status: 'invalid_request' });
    expect(parseRequestedIds(['ok', ''])).toMatchObject({ status: 'invalid_request' });
    expect(parseRequestedIds(['x'.repeat(129)])).toMatchObject({ status: 'invalid_request' });
    expect(parseRequestedIds([{ id: 'field-tool', executablePath: 'C:\\evil.exe' }])).toMatchObject({ status: 'invalid_request' });
    expect(parseRequestedIds(['__proto__'])).toMatchObject({ status: 'invalid_request' });
    expect(parseRequestedIds(['field/tool'])).toMatchObject({ status: 'invalid_request' });
    expect(parseRequestedIds(['field tool'])).toMatchObject({ status: 'invalid_request' });
    expect(parseRequestedIds(['FIELD-TOOL'])).toMatchObject({ status: 'invalid_request' });
  });

  it('deduplicates while preserving order', () => {
    expect(parseRequestedIds(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('accepts a bounded array at the limit', () => {
    const ids = Array.from({ length: APP_DISCOVERY_MAX_REQUESTED_IDS }, (_, i) => `id-${i}`);
    expect(parseRequestedIds(ids)).toEqual(ids);
  });
});

describe('parseDiscoveryRequest', () => {
  it('accepts a plain object containing exactly ids', () => {
    expect(parseDiscoveryRequest({ ids: ['field-tool'] })).toEqual(['field-tool']);
  });

  it('rejects a request body containing any field besides ids', () => {
    expect(parseDiscoveryRequest({ ids: ['field-tool'], apps: [] })).toMatchObject({ status: 'invalid_request' });
    expect(parseDiscoveryRequest({ ids: ['field-tool'], os: 'windows' })).toMatchObject({ status: 'invalid_request' });
    expect(parseDiscoveryRequest({ ids: ['field-tool'], executablePath: 'C:\\evil.exe' })).toMatchObject({ status: 'invalid_request' });
    expect(parseDiscoveryRequest({ ids: ['field-tool'], args: '--evil' })).toMatchObject({ status: 'invalid_request' });
    expect(parseDiscoveryRequest({ ids: ['field-tool'], workingDir: 'C:\\evil' })).toMatchObject({ status: 'invalid_request' });
    expect(parseDiscoveryRequest({ ids: ['field-tool'], somethingElse: true })).toMatchObject({ status: 'invalid_request' });
  });

  it('rejects a non-object, null, or array request body', () => {
    expect(parseDiscoveryRequest(null)).toMatchObject({ status: 'invalid_request' });
    expect(parseDiscoveryRequest(['field-tool'])).toMatchObject({ status: 'invalid_request' });
    expect(parseDiscoveryRequest('field-tool')).toMatchObject({ status: 'invalid_request' });
  });
});

describe('discoverApps configured and enabled fields', () => {
  it('reports configured=yes for a known native target and configured=no for a missing one', () => {
    const configuredRecords = recordsFor(legacyApp());
    const configured = discoverApps(configuredRecords, ['field-tool'], {}, probeReturning({}), CLOCK);
    expect(configured.observations['field-tool']).toMatchObject({ configured: 'yes' });

    const missingRecords = recordsFor(legacyApp({ executablePath: '' }));
    const missing = discoverApps(missingRecords, ['field-tool'], {}, probeReturning({}), CLOCK);
    expect(missing.observations['field-tool']).toMatchObject({ configured: 'no' });
  });

  it('reports enabled=yes for an enabled record and enabled=no for a disabled record', () => {
    const records = recordsFor(legacyApp());
    const enabled = discoverApps(records, ['field-tool'], {}, probeReturning({}), CLOCK);
    expect(enabled.observations['field-tool']).toMatchObject({ enabled: 'yes' });

    const disabledRecord: AppCatalogRecord = { ...records[0], enabled: false };
    const disabled = discoverApps([disabledRecord], ['field-tool'], {}, probeReturning({}), CLOCK);
    expect(disabled.observations['field-tool']).toMatchObject({ enabled: 'no' });
  });

  it('reports configured=no and enabled=unknown for an unknown ID', () => {
    const result = discoverApps([], ['ghost'], {}, probeReturning({}), CLOCK);
    expect(result.observations.ghost).toMatchObject({ configured: 'no', enabled: 'unknown' });
  });

  it('varies configured and enabled independently of detected, installed, available, and launch', () => {
    const records = recordsFor(legacyApp());
    const result = discoverApps(records, ['field-tool'], {}, probeReturning({ 'C:\\Field\\tool.exe': 'file' }), CLOCK);
    const observation = result.observations['field-tool'];
    expect(observation.configured).toBe('yes');
    expect(observation.enabled).toBe('yes');
    expect(observation.detected).toBe('yes');
    expect(observation.installed).toBe('unknown');
    expect(observation.available).toBe('yes');
    expect(observation.launch).toBe('unknown');
  });
});

describe('discoverApps native targets', () => {
  it('reports a genuinely existing executable as detected and available without proving installation', () => {
    const records = recordsFor(legacyApp());
    const result = discoverApps(records, ['field-tool'], {}, probeReturning({ 'C:\\Field\\tool.exe': 'file' }), CLOCK);
    expect(result.observations['field-tool']).toMatchObject({
      detected: 'yes', installed: 'unknown', available: 'yes', launch: 'unknown', evidenceSource: 'configured_path',
    });
  });

  it('reports a missing executable truthfully without proving it is not installed elsewhere', () => {
    const records = recordsFor(legacyApp());
    const result = discoverApps(records, ['field-tool'], {}, probeReturning({}), CLOCK);
    expect(result.observations['field-tool']).toMatchObject({ detected: 'no', installed: 'unknown', available: 'no' });
  });

  it('treats a directory at the configured path as not detected', () => {
    const records = recordsFor(legacyApp());
    const result = discoverApps(records, ['field-tool'], {}, probeReturning({ 'C:\\Field\\tool.exe': 'directory' }), CLOCK);
    expect(result.observations['field-tool']).toMatchObject({ detected: 'no', installed: 'unknown', available: 'no' });
    expect(result.observations['field-tool'].reason).toMatch(/directory/i);
  });

  it('reports probe errors as unknown rather than guessing', () => {
    const records = recordsFor(legacyApp());
    const result = discoverApps(records, ['field-tool'], {}, probeReturning({ 'C:\\Field\\tool.exe': 'error' }), CLOCK);
    expect(result.observations['field-tool']).toMatchObject({ detected: 'unknown', installed: 'unknown', available: 'unknown', evidenceSource: 'probe_error' });
  });

  it('falls back to bounded server-owned candidate paths and reports which one matched', () => {
    const records = recordsFor(legacyApp());
    const result = discoverApps(
      records,
      ['field-tool'],
      { 'field-tool': ['C:\\Candidate\\one.exe', 'C:\\Candidate\\two.exe'] },
      probeReturning({ 'C:\\Candidate\\two.exe': 'file' }),
      CLOCK,
    );
    expect(result.observations['field-tool']).toMatchObject({ detected: 'yes', available: 'no', evidenceSource: 'candidate_path' });
    expect(result.observations['field-tool'].reason).toMatch(/current launcher/i);
  });

  it('bounds the number of candidate paths probed', () => {
    const records = recordsFor(legacyApp());
    const manyPaths = Array.from({ length: APP_DISCOVERY_MAX_CANDIDATE_PATHS + 5 }, (_, i) => `C:\\Candidate\\${i}.exe`);
    const overflowPath = manyPaths[manyPaths.length - 1];
    const probed: string[] = [];
    const probe: AppFileProbe = path => { probed.push(path); return path === overflowPath ? 'file' : 'missing'; };
    const result = discoverApps(records, ['field-tool'], { 'field-tool': manyPaths }, probe, CLOCK);
    // The configured path plus the bounded candidate limit; the overflow candidate must never be probed.
    expect(probed.length).toBeLessThanOrEqual(APP_DISCOVERY_MAX_CANDIDATE_PATHS + 1);
    expect(probed).not.toContain(overflowPath);
    expect(result.observations['field-tool']).toMatchObject({ detected: 'no' });
  });

  it('reports a record with no configured target as unsupported rather than inventing a path', () => {
    const records = recordsFor(legacyApp({ executablePath: '' }));
    const result = discoverApps(records, ['field-tool'], {}, probeReturning({}), CLOCK);
    expect(result.observations['field-tool']).toMatchObject({ configured: 'no', detected: 'unsupported', installed: 'unsupported', available: 'unsupported', evidenceSource: 'unsupported_target' });
    expect(result.observations['field-tool'].reason).toMatch(/no target/i);
  });
});

describe('discoverApps installation evidence', () => {
  it('reports installed=unknown when no independent installation evidence is supplied, regardless of detection', () => {
    const records = recordsFor(legacyApp());
    const detected = discoverApps(records, ['field-tool'], {}, probeReturning({ 'C:\\Field\\tool.exe': 'file' }), CLOCK);
    expect(detected.observations['field-tool']).toMatchObject({ detected: 'yes', installed: 'unknown' });
    const notDetected = discoverApps(records, ['field-tool'], {}, probeReturning({}), CLOCK);
    expect(notDetected.observations['field-tool']).toMatchObject({ detected: 'no', installed: 'unknown' });
  });

  it('reports installed=yes or installed=no from independent installation evidence, independent of the file probe result', () => {
    const records = recordsFor(legacyApp());
    const installedElsewhere = discoverApps(records, ['field-tool'], {}, probeReturning({}), CLOCK, () => 'yes');
    expect(installedElsewhere.observations['field-tool']).toMatchObject({ detected: 'no', installed: 'yes' });

    const knownNotInstalled = discoverApps(records, ['field-tool'], {}, probeReturning({ 'C:\\Field\\tool.exe': 'file' }), CLOCK, () => 'no');
    expect(knownNotInstalled.observations['field-tool']).toMatchObject({ detected: 'yes', installed: 'no' });
  });

  it('never infers installed=no merely because bounded candidate paths were absent', () => {
    const nativeRecords = recordsFor(legacyApp());
    const result = discoverApps(nativeRecords, ['field-tool'], { 'field-tool': ['C:\\Candidate\\one.exe'] }, probeReturning({}), CLOCK);
    expect(result.observations['field-tool']).toMatchObject({ detected: 'no', installed: 'unknown' });
  });
});

describe('discoverApps web and unsupported targets', () => {
  it('marks a valid web target configured and available=unknown without claiming installation or reachability', () => {
    const records = recordsFor(legacyApp({ id: 'web-tool', uri: 'https://example.test/tool', executablePath: '' }));
    const result = discoverApps(records, ['web-tool'], {}, probeReturning({}), CLOCK);
    expect(result.observations['web-tool']).toMatchObject({
      configured: 'yes', detected: 'unsupported', installed: 'unsupported', available: 'unknown', evidenceSource: 'configured_web_target',
    });
  });

  it('marks an invalid web target unconfigured and unavailable', () => {
    const records = recordsFor(legacyApp({ id: 'web-tool', uri: 'not-a-valid-uri', executablePath: '' }));
    const result = discoverApps(records, ['web-tool'], {}, probeReturning({}), CLOCK);
    expect(result.observations['web-tool']).toMatchObject({ configured: 'no', available: 'no' });
  });

  it('never performs a network reachability check for web targets', () => {
    let probed = false;
    const records = recordsFor(legacyApp({ id: 'web-tool', uri: 'https://example.test/tool', executablePath: '' }));
    discoverApps(records, ['web-tool'], {}, () => { probed = true; return 'missing'; }, CLOCK);
    expect(probed).toBe(false);
  });

  it('marks unsupported legacy targets explicitly', () => {
    const records = recordsFor(legacyApp({ id: 'jar-tool', executablePath: 'C:\\Tools\\tool.jar' }));
    const result = discoverApps(records, ['jar-tool'], {}, probeReturning({}), CLOCK);
    expect(result.observations['jar-tool']).toMatchObject({ configured: 'no', detected: 'unsupported', installed: 'unsupported', available: 'unsupported' });
  });
});

describe('discoverApps request and record edge cases', () => {
  it('reports an unknown ID truthfully without matching a record', () => {
    const result = discoverApps([], ['ghost'], {}, probeReturning({}), CLOCK);
    expect(result.observations.ghost).toMatchObject({ detected: 'unknown', installed: 'unknown', available: 'unknown', evidenceSource: 'unknown_id' });
  });

  it('does not probe a disabled record', () => {
    const record: AppCatalogRecord = { ...recordsFor(legacyApp())[0], enabled: false };
    let probed = false;
    const result = discoverApps([record], ['field-tool'], {}, () => { probed = true; return 'file'; }, CLOCK);
    expect(probed).toBe(false);
    expect(result.observations['field-tool']).toMatchObject({ available: 'no', evidenceSource: 'disabled_record' });
  });

  it('rejects duplicate and oversized requests at the parsing boundary before any record is touched', () => {
    const oversized = Array.from({ length: APP_DISCOVERY_MAX_REQUESTED_IDS + 1 }, () => 'field-tool');
    expect(parseRequestedIds(oversized)).toMatchObject({ status: 'invalid_request' });

    const parsed = parseRequestedIds(['field-tool', 'field-tool']);
    expect(parsed).toEqual(['field-tool']);

    const records = recordsFor(legacyApp());
    let probeCount = 0;
    const deduped = discoverApps(records, parsed as readonly string[], {}, () => { probeCount++; return 'file'; }, CLOCK);
    expect(Object.keys(deduped.observations)).toEqual(['field-tool']);
    expect(probeCount).toBe(1);
  });

  it('is deterministic for identical inputs', () => {
    const records = recordsFor(legacyApp());
    const probe = probeReturning({ 'C:\\Field\\tool.exe': 'file' });
    const first = discoverApps(records, ['field-tool'], {}, probe, CLOCK);
    const second = discoverApps(records, ['field-tool'], {}, probe, CLOCK);
    expect(first).toEqual(second);
  });

  it('always reports launch as unknown, never synthesizing a launch outcome', () => {
    const records = recordsFor(legacyApp());
    const result = discoverApps(records, ['field-tool'], {}, probeReturning({ 'C:\\Field\\tool.exe': 'file' }), CLOCK);
    expect(result.observations['field-tool'].launch).toBe('unknown');
  });

  it('includes observation time, evidence source, and a reason for every observation', () => {
    const records = recordsFor(legacyApp());
    const result = discoverApps(records, ['field-tool'], {}, probeReturning({ 'C:\\Field\\tool.exe': 'file' }), CLOCK);
    const observation = result.observations['field-tool'];
    expect(observation.observedAtUtc).toBe('2026-09-11T00:00:00.000Z');
    expect(observation.evidenceSource).toBeTruthy();
    expect(observation.reason.length).toBeGreaterThan(0);
  });
});
