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
  percent: number;
  charging: boolean;
  voltage: number;
  health: 'Good' | 'Fair' | 'Service Needed';
  tempC: number;
  timeRemainingMins: number;
  attached?: boolean;
}

export interface DualBatteryStatus {
  mainTablet: BatteryInfo;
  keyboardDock: BatteryInfo;
  powerSource: 'Battery' | 'AC External' | 'Solar Auxiliary';
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

export interface HourlyWeatherItem {
  time: string;
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
  visibilityMiles: number;
  lastUpdated: string;
  cached: boolean;
  hourlyForecast?: HourlyWeatherItem[];
}

export interface NOAAAlert {
  id: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor';
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
  gpsComPort?: string;
  gpsBaudRate?: number;
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
  if (isNaN(lat) || isNaN(lon)) return 'RR99xx';

  let adjustedLon = lon + 180;
  let adjustedLat = lat + 90;

  // 1st pair: Field (A-R)
  const field1 = String.fromCharCode(65 + Math.floor(adjustedLon / 20));
  const field2 = String.fromCharCode(65 + Math.floor(adjustedLat / 10));

  // 2nd pair: Square (0-9)
  const square1 = Math.floor((adjustedLon % 20) / 2);
  const square2 = Math.floor((adjustedLat % 10) / 1);

  // 3rd pair: Subsquare (a-x)
  const subsquare1 = String.fromCharCode(97 + Math.floor(((adjustedLon % 2) * 60) / 5));
  const subsquare2 = String.fromCharCode(97 + Math.floor(((adjustedLat % 1) * 60) / 2.5));

  return `${field1}${field2}${square1}${square2}${subsquare1}${subsquare2}`;
}

export function gridSquareToLatLon(grid: string): { lat: number; lon: number } | null {
  const cleanGrid = grid.trim().toUpperCase();
  if (cleanGrid.length < 4) return null;

  const f1 = cleanGrid.charCodeAt(0) - 65;
  const f2 = cleanGrid.charCodeAt(1) - 65;
  const s1 = parseInt(cleanGrid.charAt(2), 10);
  const s2 = parseInt(cleanGrid.charAt(3), 10);

  if (f1 < 0 || f1 > 17 || f2 < 0 || f2 > 17 || isNaN(s1) || isNaN(s2)) return null;

  let lon = f1 * 20 + s1 * 2 - 180 + 1.0;
  let lat = f2 * 10 + s2 * 1 - 90 + 0.5;

  if (cleanGrid.length >= 6) {
    const sub1 = cleanGrid.charCodeAt(4) - 65;
    const sub2 = cleanGrid.charCodeAt(5) - 65;
    if (sub1 >= 0 && sub1 < 24 && sub2 >= 0 && sub2 < 24) {
      lon = f1 * 20 + s1 * 2 + (sub1 * 5) / 60 - 180 + 2.5 / 60;
      lat = f2 * 10 + s2 * 1 + (sub2 * 2.5) / 60 - 90 + 1.25 / 60;
    }
  }

  return { lat, lon };
}
