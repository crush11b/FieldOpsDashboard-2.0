import type { TelemetrySource, TelemetryStatus, TelemetryTimestamps } from './telemetry';
import { coordinatesToMaidenhead, maidenheadToCell } from './location/maidenhead';
import type { StationProfile } from './propagation/domain';
import type { AppCatalogConfig } from './appCatalog/domain';

export type AppCategory = 
  | 'digital'
  | 'aprs'
  | 'satellite'
  | 'network_voice'
  | 'web_apps'
  | 'utilities'
  | 'logging'
  | 'mapping'
  | 'radio_control'
  | 'custom';

export interface AppLauncherItem {
  id: string;
  name: string;
  category: AppCategory;
  iconName: string;
  executablePath: string;
  uri?: string;
  deps?: string[];
  description: string;
  installed: boolean;
  hotkey?: string;
  args?: string;
  favorite: boolean;
  workingDir?: string;
}

export interface BatteryInfo {
  percent: number | null;
  charging: boolean | null;
  voltage: number;
  health: 'Good' | 'Fair' | 'Service Needed';
  tempC: number;
  timeRemainingMins: number | null;
  attached?: boolean;
}

export interface SystemTelemetry {
  status: 'Available' | 'Unavailable' | 'Error';
  observedAtUtc: string;
  source: string;
  batteryPresent: boolean | null;
  chargePercent: number | null;
  charging: boolean | null;
  powerSource: 'AC' | 'Battery' | 'Unknown';
  remainingRuntimeSeconds: number | null;
  error: string | null;
  physicalBatteryStatus?: 'Available' | 'Unavailable' | 'Error';
  physicalBatteries: Array<{ deviceId: string; name: string | null; present: boolean | null; percentage: number | null; charging: boolean | null }>;
  cpu: { usagePercent: number; logicalProcessorCount: number; model: string | null } | null;
  memory: { totalBytes: number; availableBytes: number; usedBytes: number; usedPercent: number } | null;
  storage: { volume: string; totalBytes: number; availableBytes: number; usedBytes: number; usedPercent: number } | null;
  network: { available: boolean; interfaces: Array<{ name: string; description: string | null; type: string; ipv4Address: string | null; linkSpeedBitsPerSecond: number | null; ssid?: string | null }> } | null;
}

export interface DualBatteryStatus {
  mainTablet: BatteryInfo;
  keyboardDock: BatteryInfo;
  powerSource: 'Battery' | 'AC External' | 'Unknown' | 'Solar Auxiliary';
}

export interface NetworkStatus {
  online: boolean;
  type: 'cellular' | 'wifi' | 'mesh_rf' | 'offline';
  interfaceName: string;
  dnsLatencyMs: number;
  ipAddress: string;
  signalDbm: number;
  packetsDropped: number;
}

export interface GPSStatus {
  lat: number;
  lon: number;
  altitudeM: number;
  speedKmh: number;
  gridSquare: string;
  satCount: number;
  fixType: '3D Fix' | '2D Fix' | 'Searching' | 'No Fix' | '3D RTK Fix' | '3D GPS Fix' | string;
  lockTime: string;
  mode: 'auto' | 'manual' | 'nmea_sim';
  deviceName: string;
  comPort?: string;
  baudRate?: number;
}

export interface GPSProvenance {
  status: TelemetryStatus;
  source: TelemetrySource;
  timestamps?: TelemetryTimestamps;
}

export interface HourlyWeatherItem {
  time: string;
  utcTime?: string;
  tempF: number;
  precipProb: number;
  windMph: number;
  weatherCode: number;
}

export interface WeatherData {
  tempF: number;
  tempC: number;
  humidity: number;
  pressureInHg: number;
  pressureHpa: number;
  windMph: number;
  windGustMph?: number;
  windDir: string;
  condition: string;
  icon: string;
  locationName: string;
  dewPointF: number;
  uvIndex: number;
  visibilityMiles?: number;
  lastUpdated: string;
  cached: boolean;
  timezone?: string;
  hourlyForecast?: HourlyWeatherItem[];
}

export interface NOAAAlert {
  id: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  title: string;
  description: string;
  area: string;
  expires: string;
  issued: string;
}

export interface BandPropagation {
  band: '160m' | '80m' | '60m' | '40m' | '30m' | '20m' | '17m' | '15m' | '12m' | '10m' | '6m' | string;
  frequencyMHz: string;
  dayProb: number;   // 0 - 100%
  nightProb: number; // 0 - 100%
  muf: number;       // Maximum Usable Frequency in MHz
  status: 'Excellent' | 'Good' | 'Fair' | 'Poor';
  recommendedModes: string[];
  currentProb?: number;
  currentMuf?: number;
}

export interface SolarData {
  solarFlux: number;       // SFI
  sunspotNumber: number;   // SSN
  aIndex: number;
  kIndex: number;
  kDescription: string;
  xray: string;
  geomagStatus: string;
  lastUpdated: string;
  source: string;
}

export type UIThemeMode = 'dark_tactical' | 'night_vision' | 'sunlight';

export interface DashboardConfig {
  theme: UIThemeMode;
  audioFeedback: boolean;
  autoGps: boolean;
  appGridColumns: 2 | 3 | 4 | 6;
  showRoadmapTools: boolean;
  favoriteCategoryOnly: boolean;
  callsign: string;
  potaParkRef: string;
  apps: AppLauncherItem[];
  appCatalog: AppCatalogConfig;
  gpsComPort?: string;
  gpsBaudRate?: number;
  wsjtx: {
    mode: 'multicast' | 'unicast';
    multicastAddress: string;
    multicastInterface: string;
    host: string;
    port: number;
  };
  propagation: {
    stationProfile: StationProfile;
    destinationRegion: import('./propagation/regionalDestinations').PropagationRegionId;
  };
}

// ADIF Log entry for SmartLog+
export interface LogEntry {
  id: string;
  callsign: string;
  band: string;
  mode: string;
  frequency: string;
  rstSent: string;
  rstRcvd: string;
  gridSquare: string;
  potaRef?: string;
  sotaRef?: string;
  timestamp: string;
  notes?: string;
}

// Maidenhead Grid Square Utility Functions
export function latLonToGridSquare(lat: number, lon: number): string {
  return coordinatesToMaidenhead(lat, lon, 6) ?? '';
}

export function gridSquareToLatLon(grid: string): { lat: number; lon: number } | null {
  return maidenheadToCell(grid)?.center ?? null;
}

export type ExternalDataStatus = 'loading' | 'live' | 'unavailable';
