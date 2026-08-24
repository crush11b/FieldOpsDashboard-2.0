import type { AppCategory, AppLauncherItem, DashboardConfig } from './types';
import { isAntennaType, isDeploymentCompatible, isDeploymentGeometry, isHeightCategory, isHeightCategoryValidForDeployment, isPropagationMode } from './propagation/domain';
import { PROPAGATION_REGION_IDS } from './propagation/regionalDestinations';

const APP_CATEGORIES: readonly AppCategory[] = [
  'digital', 'aprs', 'satellite', 'network_voice', 'web_apps', 'utilities',
  'logging', 'mapping', 'radio_control', 'custom',
];
const VALID_BAUD_RATES = new Set([4800, 9600, 19200, 38400, 57600, 115200]);

export function isUsableDashboardConfig(value: unknown): value is DashboardConfig {
  if (!isRecord(value)) return false;
  return (value.theme === 'dark_tactical' || value.theme === 'night_vision' || value.theme === 'sunlight')
    && typeof value.audioFeedback === 'boolean'
    && typeof value.autoGps === 'boolean'
    && (value.appGridColumns === 2 || value.appGridColumns === 3 || value.appGridColumns === 4 || value.appGridColumns === 6)
    && typeof value.showRoadmapTools === 'boolean'
    && typeof value.favoriteCategoryOnly === 'boolean'
    && typeof value.callsign === 'string'
    && typeof value.potaParkRef === 'string'
    && (value.gpsComPort === undefined || typeof value.gpsComPort === 'string')
    && (value.gpsBaudRate === undefined || (typeof value.gpsBaudRate === 'number' && VALID_BAUD_RATES.has(value.gpsBaudRate)))
    && Array.isArray(value.apps) && value.apps.every(isUsableApp)
    && isUsablePropagation(value.propagation);
}

function isUsableApp(value: unknown): value is AppLauncherItem {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && value.id.length > 0
    && typeof value.name === 'string' && value.name.length > 0
    && APP_CATEGORIES.includes(value.category as AppCategory)
    && typeof value.iconName === 'string'
    && typeof value.executablePath === 'string'
    && typeof value.description === 'string'
    && typeof value.installed === 'boolean'
    && typeof value.favorite === 'boolean'
    && (value.uri === undefined || typeof value.uri === 'string')
    && (value.deps === undefined || (Array.isArray(value.deps) && value.deps.every(item => typeof item === 'string')))
    && (value.hotkey === undefined || typeof value.hotkey === 'string')
    && (value.args === undefined || typeof value.args === 'string')
    && (value.workingDir === undefined || typeof value.workingDir === 'string');
}

function isUsablePropagation(value: unknown): value is DashboardConfig['propagation'] {
  if (!isRecord(value) || !PROPAGATION_REGION_IDS.includes(value.destinationRegion as typeof PROPAGATION_REGION_IDS[number])) return false;
  const profile = value.stationProfile;
  if (!isRecord(profile) || !isPropagationMode(profile.mode) || typeof profile.transmitPowerWatts !== 'number' || !Number.isFinite(profile.transmitPowerWatts) || profile.transmitPowerWatts <= 0) return false;
  if (!isRecord(profile.antenna) || !isAntennaType(profile.antenna.type)) return false;
  if (!isRecord(profile.deployment) || !isDeploymentGeometry(profile.deployment.geometry) || !isDeploymentCompatible(profile.antenna.type, profile.deployment.geometry)) return false;
  return isHeightCategory(profile.deployment.heightCategory) && isHeightCategoryValidForDeployment(profile.deployment.geometry, profile.deployment.heightCategory);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}