import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPreV3Backup,
  inspectPreV3Backup,
  isPreV3BackupManifest,
  readAndVerifyPreV3Backup,
  restorePreV3Snapshot,
  V2_9_1_OPERATOR_DATA_FILES,
  V3_DOMAIN_MIGRATION_FILES,
  v3MigrationBackupFileSet,
} from '../v3Migration';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-v3-migration-'));
  roots.push(root);
  const sourceDirectory = path.join(root, 'source');
  const backupRoot = path.join(root, 'backups');
  const quarantineRoot = path.join(root, 'quarantine');
  fs.mkdirSync(sourceDirectory);
  fs.mkdirSync(backupRoot);
  fs.mkdirSync(quarantineRoot);
  return { root, sourceDirectory, backupRoot, quarantineRoot };
}

const fixedNow = () => new Date('2026-09-14T16:00:00.000Z');

describe('V3 migration backup foundation', () => {
  it('enumerates the complete V2.9.1 local operator-data backup set without secrets', () => {
    expect(V2_9_1_OPERATOR_DATA_FILES).toEqual([
      'dashboard-config.json',
      'smartdeploy-briefs.json',
      'activation-notes.json',
      'field-readiness-checklists.json',
      'mission-forecasts.json',
      'space-weather-snapshots.json',
      'activations.json',
      'qsos.json',
      'operational-intelligence.json',
      'space-weather-cache.json',
      'observed-rf-cache.json',
      'sota-summits.json',
    ]);
    expect(V3_DOMAIN_MIGRATION_FILES).toEqual(['activations.json', 'qsos.json']);
    expect(v3MigrationBackupFileSet()).toEqual([
      ...V2_9_1_OPERATOR_DATA_FILES,
      'equipment-inventory.json',
      'loadouts.json',
    ].sort((left, right) => left.localeCompare(right)));
    expect(v3MigrationBackupFileSet()).not.toContain('telemetry-credentials.json');
  });

  it('creates an immutable, hashed manifest for present and absent V2.9.1 stores', () => {
    const work = workspace();
    fs.writeFileSync(path.join(work.sourceDirectory, 'dashboard-config.json'), '{"version":1}\n');
    fs.mkdirSync(path.join(work.sourceDirectory, 'records'));
    fs.writeFileSync(path.join(work.sourceDirectory, 'records', 'activations.json'), '{"storeVersion":2,"activations":[]}\n');

    const created = createPreV3Backup({
      sourceDirectory: work.sourceDirectory,
      backupRoot: work.backupRoot,
      relativePaths: ['records/activations.json', 'qsos.json', 'dashboard-config.json'],
      sourceRevision: 'e48307e4311c54d66523374307587cc858e82d4b',
      sourceProductVersion: '2.9.1',
      now: fixedNow,
      createId: () => 'backup-1',
    });

    expect(created.manifest).toMatchObject({
      schemaVersion: 1,
      backupId: 'backup-1',
      createdAtUtc: '2026-09-14T16:00:00.000Z',
      sourceProductVersion: '2.9.1',
      targetProductVersion: '3.0.0',
      files: [
        { relativePath: 'dashboard-config.json', existed: true },
        { relativePath: 'qsos.json', existed: false, sizeBytes: null, sha256: null },
        { relativePath: path.normalize('records/activations.json'), existed: true },
      ],
    });
    expect(created.manifest.files.filter(file => file.existed).every(file => /^[a-f0-9]{64}$/.test(file.sha256!))).toBe(true);
    expect(readAndVerifyPreV3Backup(created.backupDirectory)).toMatchObject({ status: 'current' });
  });

  it('rejects path escape, duplicate paths, invalid identity, and a reused backup ID', () => {
    const work = workspace();
    const request = {
      sourceDirectory: work.sourceDirectory,
      backupRoot: work.backupRoot,
      relativePaths: ['dashboard-config.json'],
      sourceRevision: 'revision-1',
      sourceProductVersion: '2.9.1',
      now: fixedNow,
      createId: () => 'backup-1',
    };
    expect(() => createPreV3Backup({ ...request, relativePaths: ['../outside.json'] })).toThrow(/escapes|invalid/i);
    expect(() => createPreV3Backup({ ...request, relativePaths: ['a.json', './a.json'] })).toThrow(/unique/i);
    expect(() => createPreV3Backup({ ...request, sourceRevision: '' })).toThrow(/sourceRevision/);
    createPreV3Backup(request);
    expect(() => createPreV3Backup(request)).toThrow(/already exists/i);
  });

  it('distinguishes absent, malformed, unsupported, and current manifests', () => {
    const work = workspace();
    const backup = path.join(work.backupRoot, 'backup-1');
    fs.mkdirSync(backup);
    expect(inspectPreV3Backup(backup)).toEqual({ status: 'absent' });

    fs.writeFileSync(path.join(backup, 'migration-manifest.json'), '{');
    expect(inspectPreV3Backup(backup)).toMatchObject({ status: 'malformed' });

    fs.writeFileSync(path.join(backup, 'migration-manifest.json'), JSON.stringify({ schemaVersion: 99 }));
    expect(inspectPreV3Backup(backup)).toEqual({ status: 'unsupported', schemaVersion: 99 });
  });

  it('detects tampered or missing backup files without rewriting them', () => {
    const work = workspace();
    fs.writeFileSync(path.join(work.sourceDirectory, 'qsos.json'), 'original');
    const created = createPreV3Backup({
      sourceDirectory: work.sourceDirectory,
      backupRoot: work.backupRoot,
      relativePaths: ['qsos.json'],
      sourceRevision: 'revision-1',
      sourceProductVersion: '2.9.1',
      now: fixedNow,
      createId: () => 'backup-1',
    });
    fs.writeFileSync(path.join(created.backupDirectory, 'qsos.json'), 'tampered');
    expect(readAndVerifyPreV3Backup(created.backupDirectory)).toMatchObject({ status: 'malformed' });
    expect(fs.readFileSync(path.join(created.backupDirectory, 'qsos.json'), 'utf8')).toBe('tampered');
  });

  it('restores the exact pre-V3 snapshot and quarantines forward V3 data', () => {
    const work = workspace();
    fs.writeFileSync(path.join(work.sourceDirectory, 'dashboard-config.json'), 'v2-config');
    const created = createPreV3Backup({
      sourceDirectory: work.sourceDirectory,
      backupRoot: work.backupRoot,
      relativePaths: ['dashboard-config.json', 'inventory.json'],
      sourceRevision: 'revision-1',
      sourceProductVersion: '2.9.1',
      now: fixedNow,
      createId: () => 'backup-1',
    });

    fs.writeFileSync(path.join(work.sourceDirectory, 'dashboard-config.json'), 'v3-config');
    fs.writeFileSync(path.join(work.sourceDirectory, 'inventory.json'), 'v3-inventory');

    let id = 0;
    const restored = restorePreV3Snapshot({
      backupDirectory: created.backupDirectory,
      targetDirectory: work.sourceDirectory,
      quarantineRoot: work.quarantineRoot,
      now: fixedNow,
      createId: () => `restore-${++id}`,
    });

    expect(fs.readFileSync(path.join(work.sourceDirectory, 'dashboard-config.json'), 'utf8')).toBe('v2-config');
    expect(fs.existsSync(path.join(work.sourceDirectory, 'inventory.json'))).toBe(false);
    expect(fs.readFileSync(path.join(restored.quarantineDirectory, 'dashboard-config.json'), 'utf8')).toBe('v3-config');
    expect(fs.readFileSync(path.join(restored.quarantineDirectory, 'inventory.json'), 'utf8')).toBe('v3-inventory');
    expect(restored.restoredFiles).toEqual(['dashboard-config.json']);
    expect(restored.removedFiles).toEqual(['inventory.json']);
  });

  it('fails closed before restore when backup verification fails', () => {
    const work = workspace();
    fs.writeFileSync(path.join(work.sourceDirectory, 'qsos.json'), 'v2');
    const created = createPreV3Backup({
      sourceDirectory: work.sourceDirectory,
      backupRoot: work.backupRoot,
      relativePaths: ['qsos.json'],
      sourceRevision: 'revision-1',
      sourceProductVersion: '2.9.1',
      now: fixedNow,
      createId: () => 'backup-1',
    });
    fs.writeFileSync(path.join(created.backupDirectory, 'qsos.json'), 'broken');
    fs.writeFileSync(path.join(work.sourceDirectory, 'qsos.json'), 'v3');
    expect(() => restorePreV3Snapshot({
      backupDirectory: created.backupDirectory,
      targetDirectory: work.sourceDirectory,
      quarantineRoot: work.quarantineRoot,
      now: fixedNow,
      createId: () => 'restore-1',
    })).toThrow(/not restorable/);
    expect(fs.readFileSync(path.join(work.sourceDirectory, 'qsos.json'), 'utf8')).toBe('v3');
  });

  it('strictly validates manifest relationships and absent-file nulls', () => {
    const base = {
      schemaVersion: 1,
      backupId: 'backup-1',
      createdAtUtc: '2026-09-14T16:00:00.000Z',
      sourceRevision: 'revision-1',
      sourceProductVersion: '2.9.1',
      targetProductVersion: '3.0.0',
      sourceDirectory: path.resolve('source'),
      files: [{ relativePath: 'missing.json', existed: false, sizeBytes: null, sha256: null }],
    };
    expect(isPreV3BackupManifest(base)).toBe(true);
    expect(isPreV3BackupManifest({ ...base, files: [{ ...base.files[0], sizeBytes: 0 }] })).toBe(false);
    expect(isPreV3BackupManifest({ ...base, files: [...base.files, base.files[0]] })).toBe(false);
  });
});
