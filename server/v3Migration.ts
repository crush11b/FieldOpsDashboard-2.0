import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const V3_MIGRATION_MANIFEST_VERSION = 1 as const;

export interface MigrationFileRecord {
  readonly relativePath: string;
  readonly existed: boolean;
  readonly sizeBytes: number | null;
  readonly sha256: string | null;
}

export interface PreV3BackupManifest {
  readonly schemaVersion: typeof V3_MIGRATION_MANIFEST_VERSION;
  readonly backupId: string;
  readonly createdAtUtc: string;
  readonly sourceRevision: string;
  readonly sourceProductVersion: string;
  readonly targetProductVersion: '3.0.0';
  readonly sourceDirectory: string;
  readonly files: readonly MigrationFileRecord[];
}

export type MigrationArtifactStatus =
  | { readonly status: 'absent' }
  | { readonly status: 'current'; readonly manifest: PreV3BackupManifest }
  | { readonly status: 'malformed'; readonly reason: string }
  | { readonly status: 'unsupported'; readonly schemaVersion: unknown }
  | { readonly status: 'io_error'; readonly reason: string };

export interface CreatePreV3BackupRequest {
  readonly sourceDirectory: string;
  readonly backupRoot: string;
  readonly relativePaths: readonly string[];
  readonly sourceRevision: string;
  readonly sourceProductVersion: string;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export interface RestorePreV3SnapshotRequest {
  readonly backupDirectory: string;
  readonly targetDirectory: string;
  readonly quarantineRoot: string;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export interface RestorePreV3SnapshotResult {
  readonly manifest: PreV3BackupManifest;
  readonly quarantineDirectory: string;
  readonly restoredFiles: readonly string[];
  readonly removedFiles: readonly string[];
}

export function createPreV3Backup(request: CreatePreV3BackupRequest): {
  readonly manifest: PreV3BackupManifest;
  readonly backupDirectory: string;
} {
  const sourceDirectory = absoluteDirectory(request.sourceDirectory, 'sourceDirectory');
  const backupRoot = absoluteDirectory(request.backupRoot, 'backupRoot');
  const relativePaths = normalizeRelativePaths(request.relativePaths);
  const createdAtUtc = utcNow(request.now);
  const backupId = stableId(request.createId?.() ?? randomUUID(), 'backupId');
  const sourceRevision = boundedText(request.sourceRevision, 'sourceRevision', 128);
  const sourceProductVersion = boundedText(request.sourceProductVersion, 'sourceProductVersion', 32);
  const backupDirectory = path.join(backupRoot, backupId);

  if (fs.existsSync(backupDirectory)) throw new Error('The migration backup directory already exists.');
  fs.mkdirSync(backupDirectory, { recursive: false });

  const files: MigrationFileRecord[] = [];
  try {
    for (const relativePath of relativePaths) {
      const sourcePath = containedPath(sourceDirectory, relativePath);
      const destinationPath = containedPath(backupDirectory, relativePath);
      if (!fs.existsSync(sourcePath)) {
        files.push({ relativePath, existed: false, sizeBytes: null, sha256: null });
        continue;
      }
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) throw new Error(`Migration source is not a regular file: ${relativePath}`);
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
      const copied = fs.statSync(destinationPath);
      const sourceHash = sha256File(sourcePath);
      const copiedHash = sha256File(destinationPath);
      if (copied.size !== stat.size || copiedHash !== sourceHash) {
        throw new Error(`Migration backup verification failed: ${relativePath}`);
      }
      files.push({ relativePath, existed: true, sizeBytes: stat.size, sha256: sourceHash });
    }

    const manifest: PreV3BackupManifest = {
      schemaVersion: V3_MIGRATION_MANIFEST_VERSION,
      backupId,
      createdAtUtc,
      sourceRevision,
      sourceProductVersion,
      targetProductVersion: '3.0.0',
      sourceDirectory,
      files,
    };
    const manifestPath = path.join(backupDirectory, 'migration-manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    const verified = readAndVerifyPreV3Backup(backupDirectory);
    if (verified.status !== 'current') throw new Error(`Migration backup manifest verification failed: ${verified.status}`);
    return { manifest: verified.manifest, backupDirectory };
  } catch (error) {
    try { fs.rmSync(backupDirectory, { recursive: true, force: true }); } catch {}
    throw error;
  }
}

export function inspectPreV3Backup(backupDirectory: string): MigrationArtifactStatus {
  let directory: string;
  try {
    directory = absoluteDirectory(backupDirectory, 'backupDirectory');
  } catch (error) {
    return { status: 'malformed', reason: errorMessage(error) };
  }
  const manifestPath = path.join(directory, 'migration-manifest.json');
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { status: 'absent' }
      : { status: 'io_error', reason: 'The migration manifest could not be read.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'malformed', reason: 'The migration manifest contains invalid JSON.' };
  }
  if (isRecord(parsed) && parsed.schemaVersion !== V3_MIGRATION_MANIFEST_VERSION) {
    return { status: 'unsupported', schemaVersion: parsed.schemaVersion };
  }
  return isPreV3BackupManifest(parsed)
    ? { status: 'current', manifest: parsed }
    : { status: 'malformed', reason: 'The migration manifest is malformed.' };
}

export function readAndVerifyPreV3Backup(backupDirectory: string): MigrationArtifactStatus {
  const inspected = inspectPreV3Backup(backupDirectory);
  if (inspected.status !== 'current') return inspected;
  try {
    for (const file of inspected.manifest.files) {
      if (!file.existed) continue;
      const backupPath = containedPath(backupDirectory, file.relativePath);
      if (!fs.statSync(backupPath).isFile()
        || fs.statSync(backupPath).size !== file.sizeBytes
        || sha256File(backupPath) !== file.sha256) {
        return { status: 'malformed', reason: `The migration backup file failed verification: ${file.relativePath}` };
      }
    }
    return inspected;
  } catch {
    return { status: 'malformed', reason: 'One or more migration backup files are missing or unreadable.' };
  }
}

export function restorePreV3Snapshot(request: RestorePreV3SnapshotRequest): RestorePreV3SnapshotResult {
  const backupDirectory = absoluteDirectory(request.backupDirectory, 'backupDirectory');
  const targetDirectory = absoluteDirectory(request.targetDirectory, 'targetDirectory');
  const quarantineRoot = absoluteDirectory(request.quarantineRoot, 'quarantineRoot');
  const verified = readAndVerifyPreV3Backup(backupDirectory);
  if (verified.status !== 'current') throw new Error(`The pre-V3 backup is not restorable: ${verified.status}.`);

  const quarantineId = `v3-forward-${utcNow(request.now).replace(/[:.]/g, '-')}-${stableId(request.createId?.() ?? randomUUID(), 'quarantineId')}`;
  const quarantineDirectory = path.join(quarantineRoot, quarantineId);
  if (fs.existsSync(quarantineDirectory)) throw new Error('The forward-data quarantine directory already exists.');
  fs.mkdirSync(quarantineDirectory, { recursive: false });

  const restoredFiles: string[] = [];
  const removedFiles: string[] = [];
  try {
    for (const file of verified.manifest.files) {
      const targetPath = containedPath(targetDirectory, file.relativePath);
      const quarantinePath = containedPath(quarantineDirectory, file.relativePath);
      if (fs.existsSync(targetPath)) {
        const stat = fs.statSync(targetPath);
        if (!stat.isFile()) throw new Error(`Rollback target is not a regular file: ${file.relativePath}`);
        fs.mkdirSync(path.dirname(quarantinePath), { recursive: true });
        fs.copyFileSync(targetPath, quarantinePath, fs.constants.COPYFILE_EXCL);
        if (sha256File(targetPath) !== sha256File(quarantinePath)) {
          throw new Error(`Forward-data quarantine verification failed: ${file.relativePath}`);
        }
      }

      if (file.existed) {
        const sourcePath = containedPath(backupDirectory, file.relativePath);
        replaceFromVerifiedCopy(sourcePath, targetPath, file.sha256!);
        restoredFiles.push(file.relativePath);
      } else if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath);
        removedFiles.push(file.relativePath);
      }
    }
    fs.writeFileSync(
      path.join(quarantineDirectory, 'quarantine-manifest.json'),
      `${JSON.stringify({ schemaVersion: 1, createdAtUtc: utcNow(request.now), sourceBackupId: verified.manifest.backupId, files: verified.manifest.files.map(file => file.relativePath) }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    return { manifest: verified.manifest, quarantineDirectory, restoredFiles, removedFiles };
  } catch (error) {
    throw new Error(`Pre-V3 data restore did not complete; forward data remains at ${quarantineDirectory}: ${errorMessage(error)}`);
  }
}

export function isPreV3BackupManifest(value: unknown): value is PreV3BackupManifest {
  if (!isRecord(value)
    || value.schemaVersion !== V3_MIGRATION_MANIFEST_VERSION
    || !isStableId(value.backupId)
    || !isUtcTimestamp(value.createdAtUtc)
    || !isBoundedText(value.sourceRevision, 128)
    || !isBoundedText(value.sourceProductVersion, 32)
    || value.targetProductVersion !== '3.0.0'
    || typeof value.sourceDirectory !== 'string'
    || !path.isAbsolute(value.sourceDirectory)
    || !Array.isArray(value.files)) return false;
  try {
    const normalized = normalizeRelativePaths(value.files.map(file => isRecord(file) ? file.relativePath : undefined));
    if (normalized.length !== value.files.length) return false;
  } catch {
    return false;
  }
  return value.files.every(file => isRecord(file)
    && typeof file.existed === 'boolean'
    && (file.existed
      ? Number.isSafeInteger(file.sizeBytes) && file.sizeBytes >= 0 && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256)
      : file.sizeBytes === null && file.sha256 === null));
}

function normalizeRelativePaths(values: readonly unknown[]): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 64) throw new Error('relativePaths must contain between 1 and 64 entries.');
  const normalized = values.map((value) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 260 || path.isAbsolute(value) || value.includes('\0')) {
      throw new Error('A migration path is invalid.');
    }
    const result = path.normalize(value);
    if (result === '.' || result === '..' || result.startsWith(`..${path.sep}`)) throw new Error('A migration path escapes its root.');
    return result;
  });
  if (new Set(normalized.map(value => value.toLowerCase())).size !== normalized.length) throw new Error('Migration paths must be unique.');
  return normalized.sort((left, right) => left.localeCompare(right));
}

function containedPath(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('A migration path escapes its root.');
  return resolved;
}

function replaceFromVerifiedCopy(sourcePath: string, targetPath: string, expectedHash: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    fs.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    if (sha256File(temporaryPath) !== expectedHash) throw new Error('The rollback temporary copy failed verification.');
    try {
      fs.renameSync(temporaryPath, targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      fs.rmSync(targetPath);
      fs.renameSync(temporaryPath, targetPath);
    }
    if (sha256File(targetPath) !== expectedHash) throw new Error('The restored rollback file failed verification.');
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
  }
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function absoluteDirectory(value: unknown, field: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new Error(`${field} must be an absolute path.`);
  return path.resolve(value);
}

function boundedText(value: unknown, field: string, max: number): string {
  if (!isBoundedText(value, max)) throw new Error(`${field} is invalid.`);
  return value.trim();
}

function stableId(value: unknown, field: string): string {
  if (!isStableId(value)) throw new Error(`${field} is invalid.`);
  return value;
}

function isStableId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function isBoundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');
}

function isUtcTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function utcNow(now?: () => Date): string {
  const value = (now ?? (() => new Date()))();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('The migration clock returned an invalid date.');
  return value.toISOString();
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
