import type { AppLauncherItem } from '../types';

export const APP_CATALOG_SCHEMA_VERSION = 1 as const;

export const APP_CATALOG_CATEGORIES = [
  'Digital Comms',
  'APRS',
  'Satellite Ops',
  'Network Voice',
  'POTA/SOTA',
  'Web Apps',
  'Utilities',
] as const;

export type AppCatalogCategory = typeof APP_CATALOG_CATEGORIES[number];
export type AppCatalogOwner = 'required_system' | 'curated_default' | 'user_managed';
export type AppCatalogTarget =
  | { kind: 'native'; executablePath: string; args?: string; workingDir?: string }
  | { kind: 'web'; url: string }
  | { kind: 'unsupported'; reason: 'missing' | 'legacy_target' };
export type CatalogTruth = 'yes' | 'no' | 'unknown' | 'unsupported';
export type LaunchOutcome = 'success' | 'failure' | 'unavailable' | 'unknown';

export interface AppCatalogCapability {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface AppCatalogDependency {
  readonly id: string;
  readonly required: boolean;
}

export interface AppCatalogRuntimeState {
  readonly detected: CatalogTruth;
  readonly installed: CatalogTruth;
  readonly available: CatalogTruth;
  readonly launch: LaunchOutcome;
}

export type AppCatalogRuntimeStates = Readonly<Record<string, AppCatalogRuntimeState>>;

export interface AppCatalogPolicy {
  readonly editable: boolean;
  readonly disableable: boolean;
  readonly deletable: boolean;
  readonly restorable: boolean;
}

export interface AppCatalogRecord {
  readonly id: string;
  readonly name: string;
  readonly category: AppCatalogCategory;
  readonly iconName: string;
  readonly description: string;
  readonly owner: AppCatalogOwner;
  readonly target: AppCatalogTarget;
  readonly capabilities: readonly AppCatalogCapability[];
  readonly dependencies: readonly AppCatalogDependency[];
  readonly enabled: boolean;
  readonly favorite: boolean;
  readonly policy: AppCatalogPolicy;
}

export type AppCatalogMigrationResult =
  | { readonly status: 'migrated' | 'current'; readonly catalog: AppCatalogConfig }
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'unsupported'; readonly schemaVersion: unknown };

export interface AppCatalogConfig {
  readonly schemaVersion: typeof APP_CATALOG_SCHEMA_VERSION;
  readonly records: readonly AppCatalogRecord[];
  readonly deletedBuiltInIds: readonly string[];
}

export const EMPTY_APP_CATALOG: AppCatalogConfig = {
  schemaVersion: APP_CATALOG_SCHEMA_VERSION,
  records: [],
  deletedBuiltInIds: [],
};

const LEGACY_CATEGORY_MAP: Record<string, AppCatalogCategory> = {
  digital: 'Digital Comms',
  aprs: 'APRS',
  satellite: 'Satellite Ops',
  network_voice: 'Network Voice',
  web_apps: 'Web Apps',
  utilities: 'Utilities',
  logging: 'POTA/SOTA',
  mapping: 'Utilities',
  radio_control: 'Utilities',
  custom: 'Utilities',
};

export function isAppCatalogCategory(value: unknown): value is AppCatalogCategory {
  return typeof value === 'string' && (APP_CATALOG_CATEGORIES as readonly string[]).includes(value);
}

export function isAppCatalogConfig(value: unknown): value is AppCatalogConfig {
  if (!isRecord(value) || value.schemaVersion !== APP_CATALOG_SCHEMA_VERSION || !Array.isArray(value.records) || !Array.isArray(value.deletedBuiltInIds)) return false;
  return value.records.every(isAppCatalogRecord)
    && value.deletedBuiltInIds.every(id => typeof id === 'string' && isStableApplicationId(id))
    && hasValidCatalogPolicies(value.records)
    && hasValidTombstones(value.records, value.deletedBuiltInIds);
}

export function isAppCatalogRecord(value: unknown): value is AppCatalogRecord {
  if (!isRecord(value) || !isStableApplicationId(value.id) || typeof value.name !== 'string' || !value.name.trim() || !isAppCatalogCategory(value.category)) return false;
  if (!['required_system', 'curated_default', 'user_managed'].includes(value.owner as string) || typeof value.iconName !== 'string' || typeof value.description !== 'string') return false;
  if (!isTarget(value.target) || !isPolicy(value.policy)) return false;
  return typeof value.enabled === 'boolean'
    && typeof value.favorite === 'boolean'
    && Array.isArray(value.capabilities) && value.capabilities.every(isCapability)
    && Array.isArray(value.dependencies) && value.dependencies.every(isDependency);
}

export function isStableApplicationId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value);
}

export function migrateAppCatalog(input: unknown, legacyApps: readonly AppLauncherItem[], builtInApps: readonly AppLauncherItem[]): AppCatalogMigrationResult {
  if (input !== undefined) {
    if (!isRecord(input) || typeof input.schemaVersion !== 'number') return { status: 'invalid', reason: 'The App Catalog is present but malformed.' };
    if (input.schemaVersion > APP_CATALOG_SCHEMA_VERSION) return { status: 'unsupported', schemaVersion: input.schemaVersion };
    if (input.schemaVersion !== APP_CATALOG_SCHEMA_VERSION || !isAppCatalogConfig(input)) return { status: 'invalid', reason: 'The App Catalog does not satisfy the current schema.' };
    return { status: 'current', catalog: deduplicateCatalog(input) };
  }

  const builtInIds = new Set(builtInApps.map(app => app.id));
  const rawRecords: AppCatalogRecord[] = [];
  for (const app of legacyApps) {
    const record = toCatalogRecord(app, builtInIds);
    if (!record) {
      return { status: 'invalid', reason: `Legacy application record '${app.id || 'unknown'}' could not be migrated safely.` };
    }
    rawRecords.push(record);
  }

  const catalog = deduplicateCatalog({
    schemaVersion: APP_CATALOG_SCHEMA_VERSION,
    records: rawRecords,
    deletedBuiltInIds: [],
  });

  return { status: 'migrated', catalog };
}

export function toCatalogRecord(app: AppLauncherItem, builtInIds: ReadonlySet<string> = new Set<string>()): AppCatalogRecord | null {
  if (!isStableApplicationId(app.id) || !app.name.trim()) return null;
  const target: AppCatalogTarget = app.uri
    ? { kind: 'web', url: app.uri }
    : app.executablePath.toLowerCase().endsWith('.exe')
      ? { kind: 'native', executablePath: app.executablePath, ...(app.args ? { args: app.args } : {}), ...(app.workingDir ? { workingDir: app.workingDir } : {}) }
      : { kind: app.executablePath ? 'unsupported' : 'unsupported', reason: app.executablePath ? 'legacy_target' : 'missing' };
  const owner: AppCatalogOwner = builtInIds.has(app.id) ? 'curated_default' : 'user_managed';
  return {
    id: app.id,
    name: app.name,
    category: LEGACY_CATEGORY_MAP[app.category] ?? 'Utilities',
    iconName: app.iconName,
    description: app.description,
    owner,
    target,
    capabilities: [],
    dependencies: (app.deps ?? []).map(id => ({ id, required: true })),
    enabled: true,
    favorite: app.favorite,
    policy: {
      editable: true,
      disableable: true,
      deletable: true,
      restorable: owner === 'curated_default',
    },
  };
}

export function isCatalogTargetConfigured(target: AppCatalogTarget): boolean {
  return target.kind === 'native' || target.kind === 'web';
}

export function setCatalogRecordEnabled(catalog: AppCatalogConfig, id: string, enabled: boolean): AppCatalogConfig {
  return {
    ...catalog,
    records: catalog.records.map(record => record.id === id && record.owner !== 'required_system' && record.policy.disableable ? { ...record, enabled } : record),
  };
}

export function deleteCatalogRecord(catalog: AppCatalogConfig, id: string): AppCatalogConfig {
  const record = catalog.records.find(candidate => candidate.id === id);
  if (!record || record.owner === 'required_system' || !record.policy.deletable) return catalog;
  return {
    ...catalog,
    records: catalog.records.filter(candidate => candidate.id !== id),
    deletedBuiltInIds: record.owner === 'curated_default' ? [...new Set([...catalog.deletedBuiltInIds, id])].sort() : catalog.deletedBuiltInIds,
  };
}

export function restoreBuiltInRecord(
  catalog: AppCatalogConfig,
  id: string,
  trustedCuratedDefaults: readonly AppCatalogRecord[],
): AppCatalogConfig {
  if (!catalog.deletedBuiltInIds.includes(id)) return catalog;
  const trustedDefinition = trustedCuratedDefaults.find(def => def.id === id);
  if (
    !trustedDefinition ||
    trustedDefinition.owner !== 'curated_default' ||
    !trustedDefinition.policy.restorable ||
    !isAppCatalogRecord(trustedDefinition)
  ) {
    return catalog;
  }
  const records = [
    ...catalog.records.filter(candidate => candidate.id !== id),
    trustedDefinition,
  ];
  const deletedBuiltInIds = catalog.deletedBuiltInIds.filter(t => t !== id);
  return {
    ...catalog,
    records,
    deletedBuiltInIds,
  };
}

function deduplicateCatalog(input: AppCatalogConfig): AppCatalogConfig {
  const rawDeletedBuiltInIds = [...new Set(input.deletedBuiltInIds)].sort();
  const deletedIds = new Set(rawDeletedBuiltInIds);
  const records = new Map<string, AppCatalogRecord>();

  for (const record of input.records) {
    if (records.has(record.id)) continue;
    // Tombstones may suppress only curated-default records
    const isSuppressed = deletedIds.has(record.id) && record.owner === 'curated_default';
    if (!isSuppressed) {
      records.set(record.id, record);
    }
  }

  // Remove tombstones that conflict with active non-curated records
  const finalDeletedBuiltInIds = rawDeletedBuiltInIds.filter(id => {
    const activeRecord = records.get(id);
    return !activeRecord || activeRecord.owner === 'curated_default';
  });

  return {
    schemaVersion: APP_CATALOG_SCHEMA_VERSION,
    records: [...records.values()],
    deletedBuiltInIds: finalDeletedBuiltInIds,
  };
}

function isTarget(value: unknown): value is AppCatalogTarget {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'native') return typeof value.executablePath === 'string' && value.executablePath.length > 0 && optionalString(value.args) && optionalString(value.workingDir);
  if (value.kind === 'web') return typeof value.url === 'string' && value.url.length > 0;
  return value.kind === 'unsupported' && (value.reason === 'missing' || value.reason === 'legacy_target');
}

function isPolicy(value: unknown): value is AppCatalogPolicy {
  return isRecord(value) && ['editable', 'disableable', 'deletable', 'restorable'].every(key => typeof value[key] === 'boolean');
}

function hasValidCatalogPolicies(records: readonly AppCatalogRecord[]): boolean {
  return records.every(record => {
    const { editable, disableable, deletable, restorable } = record.policy;
    if (record.owner === 'required_system') {
      return !editable && !disableable && !deletable && !restorable;
    }
    if (record.owner === 'user_managed') {
      return !restorable;
    }
    if (record.owner === 'curated_default') {
      return restorable === deletable;
    }
    return false;
  });
}

function hasValidTombstones(records: readonly AppCatalogRecord[], deletedBuiltInIds: readonly string[]): boolean {
  const deletedSet = new Set(deletedBuiltInIds);
  return !records.some(record => record.owner !== 'curated_default' && deletedSet.has(record.id));
}

function isCapability(value: unknown): value is AppCatalogCapability {
  return isRecord(value) && typeof value.id === 'string' && typeof value.label === 'string' && optionalString(value.description);
}

function isDependency(value: unknown): value is AppCatalogDependency {
  return isRecord(value) && typeof value.id === 'string' && typeof value.required === 'boolean';
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
