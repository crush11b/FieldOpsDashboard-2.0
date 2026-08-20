import {
  ANTENNA_DEPLOYMENT_COMPATIBILITY,
  ANTENNA_TYPES,
  DEPLOYMENT_GEOMETRIES,
  HEIGHT_CATEGORIES,
  isAntennaType,
  isDeploymentCompatible,
  isDeploymentGeometry,
  isHeightCategory,
  isHeightCategoryValidForDeployment,
  isPropagationMode,
  PROPAGATION_MODES,
  WIRE_HEIGHT_DEPLOYMENTS,
  type AntennaType,
  type DeploymentGeometry,
  type HeightCategory,
  type PropagationMode,
  type StationProfile,
} from './domain';

export interface CatalogOption<T extends string> {
  readonly id: T;
  readonly label: string;
}

export interface PowerPresetOption {
  readonly id: string;
  readonly label: string;
  readonly watts: number | null;
}

export const MODE_OPTIONS: readonly CatalogOption<PropagationMode>[] = PROPAGATION_MODES.map(mode => ({ id: mode, label: mode }));

export const POWER_PRESET_OPTIONS: readonly PowerPresetOption[] = [
  { id: '5w', label: '5 W', watts: 5 },
  { id: '10w', label: '10 W', watts: 10 },
  { id: '20w', label: '20 W', watts: 20 },
  { id: '50w', label: '50 W', watts: 50 },
  { id: '100w', label: '100 W', watts: 100 },
  { id: 'custom', label: 'Custom', watts: null },
];

export const ANTENNA_OPTIONS: readonly CatalogOption<AntennaType>[] = [
  { id: 'EFHW', label: 'EFHW' },
  { id: 'EFRW', label: 'EFRW' },
  { id: 'dipole', label: 'Dipole' },
  { id: 'vertical', label: 'Vertical' },
  { id: 'loaded_vertical', label: 'Hamstick / Loaded Vertical' },
  { id: 'portable_whip', label: 'Portable Whip' },
  { id: 'beam', label: 'Beam / Directional' },
  { id: 'unknown_random_wire', label: 'Random Wire / Unknown' },
  { id: 'custom', label: 'Custom' },
];

const DEPLOYMENT_LABELS: Readonly<Record<DeploymentGeometry, string>> = {
  inverted_v: 'Inverted-V',
  sloper: 'Sloper',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  directional: 'Directional / Elevated',
  other: 'Other / Unknown',
};

const HEIGHT_OPTIONS: readonly CatalogOption<HeightCategory>[] = [
  { id: 'under_15_ft', label: 'Under 15 ft' },
  { id: '15_to_30_ft', label: '15-30 ft' },
  { id: 'over_30_ft', label: 'Over 30 ft' },
  { id: 'unknown', label: 'Unknown' },
  { id: 'not_applicable', label: 'Not applicable' },
];

export const DEFAULT_STATION_PROFILE: StationProfile = {
  mode: 'SSB',
  transmitPowerWatts: 10,
  antenna: { type: 'EFHW' },
  deployment: { geometry: 'inverted_v', heightCategory: '15_to_30_ft' },
};

export function getModeOptions(): readonly CatalogOption<PropagationMode>[] {
  return MODE_OPTIONS;
}

export function getPowerPresetOptions(): readonly PowerPresetOption[] {
  return POWER_PRESET_OPTIONS;
}

export function getAntennaOptions(): readonly CatalogOption<AntennaType>[] {
  return ANTENNA_OPTIONS;
}

export function getDeploymentOptionsForAntenna(antenna: AntennaType): readonly CatalogOption<DeploymentGeometry>[] {
  const compatible = ANTENNA_DEPLOYMENT_COMPATIBILITY[antenna] ?? [];
  return compatible.map(id => ({ id, label: DEPLOYMENT_LABELS[id] }));
}

export function getHeightOptionsForDeployment(deployment: DeploymentGeometry): readonly CatalogOption<HeightCategory>[] {
  if (WIRE_HEIGHT_DEPLOYMENTS.includes(deployment)) return HEIGHT_OPTIONS.filter(option => option.id !== 'not_applicable');
  if (deployment === 'other') return HEIGHT_OPTIONS.filter(option => option.id === 'unknown' || option.id === 'not_applicable');
  return HEIGHT_OPTIONS.filter(option => option.id === 'not_applicable');
}

export function getDefaultHeightCategoryForDeployment(deployment: DeploymentGeometry): HeightCategory {
  return WIRE_HEIGHT_DEPLOYMENTS.includes(deployment) ? DEFAULT_STATION_PROFILE.deployment.heightCategory! : 'not_applicable';
}

export function normalizeStationProfile(input: unknown): StationProfile {
  const source = isRecord(input) ? input : {};
  const antennaType = isRecord(source.antenna) && isAntennaType(source.antenna.type) ? source.antenna.type : DEFAULT_STATION_PROFILE.antenna.type;
  const sourceGeometry = isRecord(source.deployment) && isDeploymentGeometry(source.deployment.geometry) ? source.deployment.geometry : undefined;
  const geometry = sourceGeometry && isDeploymentCompatible(antennaType, sourceGeometry)
    ? sourceGeometry
    : ANTENNA_DEPLOYMENT_COMPATIBILITY[antennaType][0];
  const sourceHeight = isRecord(source.deployment) && isHeightCategory(source.deployment.heightCategory)
    ? source.deployment.heightCategory
    : undefined;
  const heightCategory = sourceHeight && isHeightCategoryValidForDeployment(geometry, sourceHeight)
    ? sourceHeight
    : getDefaultHeightCategoryForDeployment(geometry);

  return {
    mode: isPropagationMode(source.mode) ? source.mode : DEFAULT_STATION_PROFILE.mode,
    transmitPowerWatts: isPositiveFiniteNumber(source.transmitPowerWatts) ? source.transmitPowerWatts : DEFAULT_STATION_PROFILE.transmitPowerWatts,
    antenna: { type: antennaType },
    deployment: { geometry, heightCategory },
  };
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}