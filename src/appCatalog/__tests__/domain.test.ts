import { describe, expect, it } from 'vitest';
import { DEFAULT_APPS } from '../../data/defaultConfig';
import {
  APP_CATALOG_CATEGORIES,
  APP_CATALOG_SCHEMA_VERSION,
  deleteCatalogRecord,
  isAppCatalogConfig,
  migrateAppCatalog,
  restoreBuiltInRecord,
  setCatalogRecordEnabled,
  toCatalogRecord,
  type AppCatalogConfig,
  type AppCatalogRecord,
} from '../domain';
import type { AppLauncherItem } from '../../types';

const legacyApp = (overrides: Partial<AppLauncherItem> = {}): AppLauncherItem => ({
  id: 'field-tool',
  name: 'Field Tool',
  category: 'utilities',
  iconName: 'Radio',
  executablePath: 'C:\\Field\\tool.exe',
  description: 'A field tool',
  installed: false,
  favorite: false,
  ...overrides,
});

describe('App Catalog domain contract', () => {
  it('exposes exactly the seven authoritative categories', () => {
    expect(APP_CATALOG_CATEGORIES).toEqual([
      'Digital Comms', 'APRS', 'Satellite Ops', 'Network Voice', 'POTA/SOTA', 'Web Apps', 'Utilities',
    ]);
  });

  it('keeps durable configuration separate from runtime status', () => {
    const record = toCatalogRecord(legacyApp());
    const runtime = { 'field-tool': { detected: 'unknown', installed: 'unknown', available: 'unknown', launch: 'unknown' } };
    expect(record).not.toHaveProperty('detected');
    expect(record).not.toHaveProperty('installed');
    expect(record).not.toHaveProperty('available');
    expect(record).not.toHaveProperty('launch');
    expect(record).toHaveProperty('enabled', true);
    expect(runtime['field-tool']).not.toHaveProperty('enabled');
  });

  it('keeps native, web, and unsupported legacy targets distinct', () => {
    expect(toCatalogRecord(legacyApp())?.target).toEqual({ kind: 'native', executablePath: 'C:\\Field\\tool.exe' });
    expect(toCatalogRecord(legacyApp({ id: 'web-tool', uri: 'https://example.test/tool', executablePath: '' })).target).toEqual({ kind: 'web', url: 'https://example.test/tool' });
    expect(toCatalogRecord(legacyApp({ id: 'jar-tool', executablePath: 'C:\\Tools\\tool.jar' }))?.target).toEqual({ kind: 'unsupported', reason: 'legacy_target' });
  });

  it('migrates missing catalogs deterministically and current catalogs idempotently', () => {
    const first = migrateAppCatalog(undefined, [legacyApp()], []);
    expect(first.status).toBe('migrated');
    if (first.status !== 'migrated') throw new Error('Expected migration.');
    const second = migrateAppCatalog(first.catalog, [], []);
    expect(second).toEqual({ status: 'current', catalog: first.catalog });
    expect(isAppCatalogConfig(first.catalog)).toBe(true);
    expect(first.catalog.schemaVersion).toBe(APP_CATALOG_SCHEMA_VERSION);
  });

  it('prevents silent legacy-record loss when legacy records are invalid', () => {
    const invalidIdResult = migrateAppCatalog(undefined, [legacyApp({ id: 'INVALID ID!' })], []);
    expect(invalidIdResult.status).toBe('invalid');
    if (invalidIdResult.status === 'invalid') {
      expect(invalidIdResult.reason).toContain('INVALID ID!');
    }

    const emptyNameResult = migrateAppCatalog(undefined, [legacyApp({ name: '   ' })], []);
    expect(emptyNameResult.status).toBe('invalid');

    const mixedResult = migrateAppCatalog(undefined, [legacyApp({ id: 'valid-one' }), legacyApp({ name: '' })], []);
    expect(mixedResult.status).toBe('invalid');
  });

  it('deduplicates legacy migration deterministically', () => {
    const app1 = legacyApp({ id: 'dup-tool', name: 'First Variant', executablePath: 'C:\\first.exe' });
    const app2 = legacyApp({ id: 'dup-tool', name: 'Second Variant', executablePath: 'C:\\second.exe' });
    const result = migrateAppCatalog(undefined, [app1, app2], []);
    expect(result.status).toBe('migrated');
    if (result.status !== 'migrated') throw new Error('Expected migration.');
    expect(result.catalog.records).toHaveLength(1);
    expect(result.catalog.records[0].name).toBe('First Variant');

    const repeated = migrateAppCatalog(undefined, [app1, app2], []);
    expect(repeated).toEqual(result);
  });

  it('does not fall back or lose data for malformed or newer catalogs', () => {
    expect(migrateAppCatalog({ schemaVersion: 1, records: [{ id: 'bad' }], deletedBuiltInIds: [] }, [legacyApp()], [])).toMatchObject({ status: 'invalid' });
    expect(migrateAppCatalog({ schemaVersion: 99, records: [], deletedBuiltInIds: [] }, [legacyApp()], [])).toEqual({ status: 'unsupported', schemaVersion: 99 });
  });

  it('validates required-system policy and protects required records in operations', () => {
    const base = toCatalogRecord(legacyApp());
    if (!base) throw new Error('Expected record.');
    const required: AppCatalogRecord = { ...base, owner: 'required_system', policy: { editable: false, disableable: false, deletable: false, restorable: false } };
    const catalog: AppCatalogConfig = { schemaVersion: 1, records: [required], deletedBuiltInIds: [] };
    expect(isAppCatalogConfig(catalog)).toBe(true);
    expect(setCatalogRecordEnabled(catalog, required.id, false)).toEqual(catalog);
    expect(deleteCatalogRecord(catalog, required.id)).toEqual(catalog);
    expect(isAppCatalogConfig({ ...catalog, records: [{ ...required, policy: { ...required.policy, deletable: true } }] })).toBe(false);
  });

  it('enforces coherent ownership policy invariants across owner types', () => {
    const base = toCatalogRecord(legacyApp());
    if (!base) throw new Error('Expected record.');

    // User-managed records cannot be restorable
    const invalidUserManaged = { schemaVersion: 1 as const, records: [{ ...base, owner: 'user_managed' as const, policy: { editable: true, disableable: true, deletable: true, restorable: true } }], deletedBuiltInIds: [] };
    expect(isAppCatalogConfig(invalidUserManaged)).toBe(false);

    // Curated-default restorable must match deletable
    const invalidCurated = { schemaVersion: 1 as const, records: [{ ...base, owner: 'curated_default' as const, policy: { editable: true, disableable: true, deletable: false, restorable: true } }], deletedBuiltInIds: [] };
    expect(isAppCatalogConfig(invalidCurated)).toBe(false);

    // Legitimate locked non-required record is valid
    const lockedUserManaged = { schemaVersion: 1 as const, records: [{ ...base, owner: 'user_managed' as const, policy: { editable: false, disableable: false, deletable: false, restorable: false } }], deletedBuiltInIds: [] };
    expect(isAppCatalogConfig(lockedUserManaged)).toBe(true);
  });

  it('handles restoration with trusted curated defaults correctly', () => {
    const migrated = migrateAppCatalog(undefined, DEFAULT_APPS, DEFAULT_APPS);
    if (migrated.status !== 'migrated') throw new Error('Expected migration.');
    const catalog = migrated.catalog;
    const curatedDefaults = catalog.records;
    const wsjtxRecord = catalog.records.find(r => r.id === 'wsjtx');
    if (!wsjtxRecord) throw new Error('Expected wsjtx record.');

    const deleted = deleteCatalogRecord(catalog, 'wsjtx');
    expect(deleted.deletedBuiltInIds).toContain('wsjtx');

    // Missing tombstone -> unchanged
    expect(restoreBuiltInRecord(catalog, 'wsjtx', curatedDefaults)).toEqual(catalog);

    // Missing trusted definition -> unchanged
    expect(restoreBuiltInRecord(deleted, 'nonexistent', curatedDefaults)).toEqual(deleted);

    // Forged / user-managed definition -> unchanged
    const forgedDefaults: AppCatalogRecord[] = [{ ...wsjtxRecord, owner: 'user_managed', policy: { editable: true, disableable: true, deletable: true, restorable: false } }];
    expect(restoreBuiltInRecord(deleted, 'wsjtx', forgedDefaults)).toEqual(deleted);

    // Conflicting same-ID record in catalog -> removed and replaced by canonical trusted definition once
    const conflictingRecord: AppCatalogRecord = { ...wsjtxRecord, name: 'Conflicting Custom WSJT-X', owner: 'user_managed', policy: { editable: true, disableable: true, deletable: true, restorable: false } };
    const catalogWithConflict: AppCatalogConfig = { schemaVersion: 1, records: [...deleted.records, conflictingRecord], deletedBuiltInIds: deleted.deletedBuiltInIds };
    const resolvedFromConflict = restoreBuiltInRecord(catalogWithConflict, 'wsjtx', curatedDefaults);
    expect(resolvedFromConflict.deletedBuiltInIds).not.toContain('wsjtx');
    expect(resolvedFromConflict.records.filter(r => r.id === 'wsjtx')).toHaveLength(1);
    expect(resolvedFromConflict.records.find(r => r.id === 'wsjtx')?.name).toBe('WSJT-X');

    // Successful canonical restoration
    const restored = restoreBuiltInRecord(deleted, 'wsjtx', curatedDefaults);
    expect(restored.deletedBuiltInIds).not.toContain('wsjtx');
    expect(restored.records.find(r => r.id === 'wsjtx')).toEqual(wsjtxRecord);

    // No duplicate after repeated restoration
    const restoredAgain = restoreBuiltInRecord(restored, 'wsjtx', curatedDefaults);
    expect(restoredAgain).toEqual(restored);
  });

  it('prevents tombstones from suppressing protected required-system or user-managed records', () => {
    const base = toCatalogRecord(legacyApp());
    if (!base) throw new Error('Expected record.');

    const requiredRecord: AppCatalogRecord = { ...base, id: 'req-app', owner: 'required_system', policy: { editable: false, disableable: false, deletable: false, restorable: false } };
    const userRecord: AppCatalogRecord = { ...base, id: 'user-app', owner: 'user_managed', policy: { editable: true, disableable: true, deletable: true, restorable: false } };

    // Validation rejects catalogs where tombstones conflict with protected records
    const requiredConflictCatalog = { schemaVersion: 1 as const, records: [requiredRecord], deletedBuiltInIds: ['req-app'] };
    expect(isAppCatalogConfig(requiredConflictCatalog)).toBe(false);

    const userConflictCatalog = { schemaVersion: 1 as const, records: [userRecord], deletedBuiltInIds: ['user-app'] };
    expect(isAppCatalogConfig(userConflictCatalog)).toBe(false);

    // Normalization / deduplication resolves conflicts when normalizing so protected record wins and tombstone is cleaned
    const reqCatalog: AppCatalogConfig = {
      schemaVersion: 1,
      records: [requiredRecord],
      deletedBuiltInIds: ['req-app'],
    };
    const currentReq = migrateAppCatalog(reqCatalog, [], []);
    expect(currentReq.status).toBe('invalid');
  });

  it('does not authorize unsupported legacy targets', () => {
    const result = toCatalogRecord(legacyApp({ executablePath: 'C:\\Tools\\tool.jar' }));
    expect(result?.target.kind).toBe('unsupported');
  });

  it('keeps enabled as the single durable enablement value', () => {
    const migrated = migrateAppCatalog(undefined, DEFAULT_APPS, DEFAULT_APPS);
    if (migrated.status !== 'migrated') throw new Error('Expected migration.');
    const disabled = setCatalogRecordEnabled(migrated.catalog, 'wsjtx', false);
    expect(disabled.records.find(record => record.id === 'wsjtx')?.enabled).toBe(false);
    expect(disabled.records.find(record => record.id === 'wsjtx')).not.toHaveProperty('availability');
  });
});
