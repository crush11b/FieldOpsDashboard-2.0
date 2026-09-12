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
  readonly hotkey?: string;
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

const MAX_CATALOG_RECORDS = 256;
const MAX_CATALOG_TOMBSTONES = 256;
const MAX_CATALOG_COLLECTION_ITEMS = 64;
const MAX_CATALOG_TEXT_LENGTH = 512;

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
  if (value.records.length > MAX_CATALOG_RECORDS || value.deletedBuiltInIds.length > MAX_CATALOG_TOMBSTONES) return false;
  if (new Set(value.records.map(record => isRecord(record) ? record.id : undefined)).size !== value.records.length) return false;
  if (new Set(value.deletedBuiltInIds).size !== value.deletedBuiltInIds.length) return false;
  return value.records.every(isAppCatalogRecord)
    && value.deletedBuiltInIds.every(id => typeof id === 'string' && isStableApplicationId(id))
    && hasValidCatalogPolicies(value.records)
    && hasValidTombstones(value.records, value.deletedBuiltInIds);
}

export function isAppCatalogRecord(value: unknown): value is AppCatalogRecord {
  if (!isRecord(value) || !isStableApplicationId(value.id) || !boundedNonEmptyString(value.name) || !isAppCatalogCategory(value.category)) return false;
  if (!['required_system', 'curated_default', 'user_managed'].includes(value.owner as string) || !boundedNonEmptyString(value.iconName) || !boundedNonEmptyString(value.description) || !optionalBoundedString(value.hotkey)) return false;
  if (!isTarget(value.target) || !isPolicy(value.policy) || (value.target.kind !== 'unsupported' && !isValidCatalogTarget(value.target))) return false;
  if (!Array.isArray(value.capabilities) || value.capabilities.length > MAX_CATALOG_COLLECTION_ITEMS || new Set(value.capabilities.map(capability => isRecord(capability) ? capability.id : undefined)).size !== value.capabilities.length) return false;
  if (!Array.isArray(value.dependencies) || value.dependencies.length > MAX_CATALOG_COLLECTION_ITEMS || new Set(value.dependencies.map(dependency => isRecord(dependency) ? dependency.id : undefined)).size !== value.dependencies.length) return false;
  return typeof value.enabled === 'boolean'
    && typeof value.favorite === 'boolean'
    && value.capabilities.every(isCapability)
    && value.dependencies.every(isDependency);
}

export function isStableApplicationId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value);
}

export function migrateAppCatalog(input: unknown, legacyApps: readonly AppLauncherItem[], builtInApps: readonly AppLauncherItem[]): AppCatalogMigrationResult {
  if (input !== undefined) {
    if (!isRecord(input) || typeof input.schemaVersion !== 'number') return { status: 'invalid', reason: 'The App Catalog is present but malformed.' };
    if (input.schemaVersion > APP_CATALOG_SCHEMA_VERSION) return { status: 'unsupported', schemaVersion: input.schemaVersion };
    if (input.schemaVersion !== APP_CATALOG_SCHEMA_VERSION || !isAppCatalogConfig(input)) return { status: 'invalid', reason: 'The App Catalog does not satisfy the current schema.' };
    const merged = mergeTrustedCuratedDefaults(input, builtInApps);
    return merged ? { status: 'current', catalog: merged } : { status: 'invalid', reason: 'Trusted defaults could not be reconciled with the App Catalog.' };
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

  const catalog = {
    schemaVersion: APP_CATALOG_SCHEMA_VERSION,
    records: rawRecords,
    deletedBuiltInIds: [],
  } satisfies AppCatalogConfig;

  if (!isAppCatalogConfig(catalog)) return { status: 'invalid', reason: 'Legacy applications produced an invalid App Catalog.' };

  const merged = mergeTrustedCuratedDefaults(catalog, builtInApps);
  if (!merged) return { status: 'invalid', reason: 'Trusted defaults could not be reconciled with legacy applications.' };

  return { status: 'migrated', catalog: merged };
}

export function toCatalogRecord(app: AppLauncherItem, builtInIds: ReadonlySet<string> = new Set<string>()): AppCatalogRecord | null {
  if (!isStableApplicationId(app.id) || !app.name.trim()) return null;
  if (app.uri && (app.args !== undefined || app.workingDir !== undefined)) return null;
  const target: AppCatalogTarget = app.uri
    ? { kind: 'web', url: app.uri }
    : app.executablePath.toLowerCase().endsWith('.exe')
      ? { kind: 'native', executablePath: app.executablePath, ...(app.args ? { args: app.args } : {}), ...(app.workingDir ? { workingDir: app.workingDir } : {}) }
      : { kind: app.executablePath ? 'unsupported' : 'unsupported', reason: app.executablePath ? 'legacy_target' : 'missing' };
  const owner: AppCatalogOwner = builtInIds.has(app.id) ? 'curated_default' : 'user_managed';
  return {
    id: app.id,
    name: app.name,
    category: LEGACY_CATEGORY_MAP[app.category] ?? 'Digital Comms',
    iconName: app.iconName,
    description: app.description,
    owner,
    target,
    capabilities: [],
    dependencies: (app.deps ?? []).map(id => ({ id, required: true })),
    enabled: true,
    favorite: app.favorite,
    ...(app.hotkey ? { hotkey: app.hotkey.slice(0, 32) } : {}),
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

export function isValidCatalogTarget(target: AppCatalogTarget): boolean {
  if (target.kind === 'web') {
    try {
      if (!/^https?:\/\/[^/\\?#]+(?:[/?#]|$)/i.test(target.url) || target.url.includes('\0')) return false;
      const url = new URL(target.url);
      return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
    } catch {
      return false;
    }
  }
  if (target.kind !== 'native' || target.executablePath.includes('\0') || target.args?.includes('\0') || !/^[A-Za-z]:\\[^<>:"|?*]*\.exe$/i.test(target.executablePath)) return false;
  return !target.workingDir || (/^[A-Za-z]:\\[^<>:"|?*]*$/i.test(target.workingDir) && !target.workingDir.includes('\0'));
}

export function projectCatalogToLegacyApps(catalog: AppCatalogConfig): AppLauncherItem[] {
  return catalog.records.map(record => ({
    id: record.id,
    name: record.name,
    category: legacyCategoryFor(record.category),
    iconName: record.iconName,
    executablePath: record.target.kind === 'native' ? record.target.executablePath : '',
    ...(record.target.kind === 'web' ? { uri: record.target.url } : {}),
    ...(record.target.kind === 'native' && record.target.args ? { args: record.target.args } : {}),
    ...(record.target.kind === 'native' && record.target.workingDir ? { workingDir: record.target.workingDir } : {}),
    deps: record.dependencies.map(dependency => dependency.id),
    description: record.description,
    installed: false,
    favorite: record.favorite,
    ...(record.hotkey ? { hotkey: record.hotkey } : {}),
  }));
}

export function setCatalogRecordEnabled(catalog: AppCatalogConfig, id: string, enabled: boolean): AppCatalogConfig {
  return {
    ...catalog,
    records: catalog.records.map(record => record.id === id && record.owner !== 'required_system' && record.policy.disableable ? { ...record, enabled } : record),
  };
}

export function setCatalogRecordFavorite(catalog: AppCatalogConfig, id: string, favorite: boolean): AppCatalogConfig {
  return {
    ...catalog,
    records: catalog.records.map(record => record.id === id ? { ...record, favorite } : record),
  };
}

export function updateCatalogRecord(catalog: AppCatalogConfig, updated: AppCatalogRecord): AppCatalogConfig {
  const current = catalog.records.find(record => record.id === updated.id);
  if (!current || !current.policy.editable || current.owner !== updated.owner || !samePolicy(current.policy, updated.policy) || !isValidCatalogTarget(updated.target)) return catalog;
  const records = catalog.records.map(record => {
    if (record.id !== updated.id) return record;
    const { hotkey: _previousHotkey, ...withoutHotkey } = record;
    return {
      ...withoutHotkey,
      name: updated.name,
      category: updated.category,
      iconName: updated.iconName,
      description: updated.description,
      target: updated.target,
      favorite: updated.favorite,
      ...(updated.hotkey ? { hotkey: updated.hotkey } : {}),
    };
  });
  return isAppCatalogConfig({ ...catalog, records }) ? { ...catalog, records } : catalog;
}

export function addUserManagedRecord(catalog: AppCatalogConfig, record: AppCatalogRecord): AppCatalogConfig {
  if (record.owner !== 'user_managed' || catalog.records.some(existing => existing.id === record.id) || !isAppCatalogRecord(record) || !isValidCatalogTarget(record.target)) return catalog;
  const canonical = { ...record, policy: { editable: true, disableable: true, deletable: true, restorable: false } };
  const next = { ...catalog, records: [...catalog.records, canonical] };
  return isAppCatalogConfig(next) ? next : catalog;
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

function mergeTrustedCuratedDefaults(input: AppCatalogConfig, builtInApps: readonly AppLauncherItem[]): AppCatalogConfig | null {
  const records = [...input.records];
  const existingIds = new Set(records.map(record => record.id));
  const deletedIds = new Set(input.deletedBuiltInIds);
  const builtInIds = new Set(builtInApps.map(app => app.id));
  if (builtInIds.size !== builtInApps.length) return null;
  for (const app of builtInApps) {
    const record = toCatalogRecord(app, builtInIds);
    if (!record) return null;
    const existing = input.records.find(candidate => candidate.id === record.id);
    if (existing && (existing.owner !== record.owner || !samePolicy(existing.policy, record.policy))) return null;
    if (existingIds.has(app.id) || deletedIds.has(app.id) || !builtInIds.has(app.id)) continue;
    records.push(record);
  }
  const merged: AppCatalogConfig = {
    schemaVersion: APP_CATALOG_SCHEMA_VERSION,
    records,
    deletedBuiltInIds: [...input.deletedBuiltInIds],
  };
  return isAppCatalogConfig(merged) ? merged : null;
}

function samePolicy(left: AppCatalogPolicy, right: AppCatalogPolicy): boolean {
  return left.editable === right.editable
    && left.disableable === right.disableable
    && left.deletable === right.deletable
    && left.restorable === right.restorable;
}

function isTarget(value: unknown): value is AppCatalogTarget {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'native') return boundedNonEmptyString(value.executablePath) && optionalBoundedString(value.args) && optionalBoundedString(value.workingDir);
  if (value.kind === 'web') return boundedNonEmptyString(value.url);
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
  return !records.some(record => deletedSet.has(record.id));
}

function isCapability(value: unknown): value is AppCatalogCapability {
  return isRecord(value) && boundedNonEmptyString(value.id) && boundedNonEmptyString(value.label) && optionalBoundedString(value.description);
}

function isDependency(value: unknown): value is AppCatalogDependency {
  return isRecord(value) && boundedNonEmptyString(value.id) && typeof value.required === 'boolean';
}

function optionalBoundedString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= MAX_CATALOG_TEXT_LENGTH);
}

function boundedNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_CATALOG_TEXT_LENGTH;
}

function boundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_CATALOG_TEXT_LENGTH;
}

function legacyCategoryFor(category: AppCatalogCategory): AppLauncherItem['category'] {
  const categories: Record<AppCatalogCategory, AppLauncherItem['category']> = {
    'Digital Comms': 'digital',
    APRS: 'aprs',
    'Satellite Ops': 'satellite',
    'Network Voice': 'network_voice',
    'POTA/SOTA': 'logging',
    'Web Apps': 'web_apps',
    Utilities: 'utilities',
  };
  return categories[category];
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
