import React, { useState, useEffect } from 'react';
import { HeaderBar } from './components/HeaderBar';
import { BatteryStatusWidget } from './components/BatteryStatusWidget';
import { GPSGridWidget } from './components/GPSGridWidget';
import { WeatherNOAAWidget } from './components/WeatherNOAAWidget';
import { VOACAPPropagationWidget } from './components/VOACAPPropagationWidget';
import { AppLauncherGrid } from './components/AppLauncherGrid';
import { ConfigModal } from './components/ConfigModal';
import { RoadmapToolsModal } from './components/RoadmapToolsModal';
import { TouchMenuDrawer } from './components/TouchMenuDrawer';
import { SerialPortInventoryWidget } from './components/SerialPortInventoryWidget';

import { 
  AppLauncherItem, 
  BandPropagation, 
  DashboardConfig, 
  DualBatteryStatus, 
  ExternalDataStatus,
  GPSStatus, 
  GPSProvenance,
  NOAAAlert, 
  SolarData, 
  UIThemeMode, 
  WeatherData,
  latLonToGridSquare,
  SystemTelemetry
} from './types';
import { DEFAULT_BAND_PROPAGATION, INITIAL_CONFIG } from './data/defaultConfig';
import { playTacticalClick } from './utils/audio';
import { isCurrentOperatingLocation, parseCoordinates, resolveGpsCoordinates } from './location/coordinates';
import { toFiniteNumber } from './utils/numbers';
import { formatNetworkDisplay, formatStorageDisplay } from './utils/systemTelemetryDisplay';
import { CONFIG_STORAGE_KEY, loadDashboardConfig, saveDashboardConfig } from './configPersistence';

const GPS_STORAGE_KEY = 'fieldops_gps_status_v1';

interface InitialGpsState {
  gps: GPSStatus;
  provenance: GPSProvenance;
}

const loadInitialGpsState = (): InitialGpsState => {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(GPS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const coordinates = parsed ? parseCoordinates(parsed.lat, parsed.lon) : null;
        if (parsed && coordinates) {
          return {
            gps: {
              ...parsed,
              lat: coordinates.lat,
              lon: coordinates.lon,
              mode: parsed.mode === 'manual' ? 'manual' : 'auto',
            },
            provenance: {
              status: 'cached',
              source: {
                id: 'gps:local-storage',
                type: 'cached_local_storage',
                name: 'Cached GPS Position',
              },
            },
          };
        }
      }
    } catch (e) {
      console.warn('Failed to restore saved GPS status');
    }
  }

  return {
    gps: {
      lat: Number.NaN,
      lon: Number.NaN,
      altitudeM: 0,
      speedKmh: 0,
      gridSquare: '',
      satCount: 0,
      fixType: 'Searching',
      lockTime: '',
      mode: 'auto',
      deviceName: 'GPS Receiver',
    },
    provenance: {
      status: 'connecting',
      source: {
        id: 'gps:startup',
        type: 'gps_acquisition',
        name: 'Waiting for GPS Location',
      },
    },
  };
};

export default function App() {
  // 1. Dashboard Persistent Config
  const [config, setConfig] = useState<DashboardConfig>(INITIAL_CONFIG);
  const [configReady, setConfigReady] = useState(false);
  const [configPersistenceError, setConfigPersistenceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDashboardConfig().then(result => {
      if (cancelled) return;
      setConfig(result.config);
      setConfigPersistenceError(result.persistenceError ?? null);
      setConfigReady(true);
    }).catch(error => {
      if (cancelled) return;
      console.warn('Dashboard configuration load failed', error);
      setConfigPersistenceError('Dashboard configuration could not be loaded from the local backend.');
      setConfigReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  const updateConfig = (updated: DashboardConfig) => {
    setConfig(updated);
    setConfigPersistenceError(null);
    saveDashboardConfig(updated).then(saved => {
      setConfig(saved);
    }).catch(error => {
      console.warn('Dashboard configuration persistence failed', error);
      try { localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updated)); } catch { /* compatibility cache is best effort */ }
      setConfigPersistenceError('Dashboard configuration is active but was not saved to the local backend.');
    });
  };

  // 2. Dual Battery Status
  const [battery, setBattery] = useState<DualBatteryStatus>({
    mainTablet: {
      percent: 100,
      charging: false,
      voltage: 11.8,
      health: 'Good',
      tempC: 28,
      timeRemainingMins: 350,
    },
    keyboardDock: {
      percent: 94,
      charging: false,
      voltage: 12.1,
      health: 'Good',
      tempC: 26,
      timeRemainingMins: 420,
      attached: true,
    },
    powerSource: 'Battery',
  });
  const [systemTelemetry, setSystemTelemetry] = useState<SystemTelemetry | null>(null);
  const [launchStates, setLaunchStates] = useState<Record<string, string>>({});

  const handleLaunchApp = async (appId: string) => {
    setLaunchStates(previous => ({ ...previous, [appId]: 'LAUNCHING' }));
    try {
      const response = await fetch('/api/apps/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId }),
      });
      const result = await response.json() as { status?: string };
      setLaunchStates(previous => ({ ...previous, [appId]: result.status ?? 'LaunchFailed' }));
    } catch {
      setLaunchStates(previous => ({ ...previous, [appId]: 'LauncherUnavailable' }));
    }
  };

  // 3. GPS & Maidenhead Grid Square (Saved to LocalStorage)
  const [initialGpsState] = useState(loadInitialGpsState);
  const [gps, setGps] = useState<GPSStatus>(initialGpsState.gps);
  const [gpsProvenance, setGpsProvenance] = useState<GPSProvenance>(initialGpsState.provenance);
  const operatingLocation = resolveGpsCoordinates(gps, gpsProvenance);
  const operatingGridSquare = isCurrentOperatingLocation(operatingLocation) ? gps.gridSquare : '';

  // Persist GPS changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        if (operatingLocation) {
          localStorage.setItem(GPS_STORAGE_KEY, JSON.stringify(gps));
        }
      } catch (e) {
        console.warn('Failed to persist GPS status');
      }
    }
  }, [gps, gpsProvenance]);

  // 5. Weather & NOAA Alerts
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<ExternalDataStatus>('loading');
  const [noaaAlerts, setNoaaAlerts] = useState<NOAAAlert[] | null>(null);
  const [alertsStatus, setAlertsStatus] = useState<ExternalDataStatus>('loading');

  // 6. Regional HF Band Guidance & Solar Flux Data
  const [solar, setSolar] = useState<SolarData>({
    solarFlux: 162,
    sunspotNumber: 138,
    aIndex: 7,
    kIndex: 2,
    kDescription: 'Quiet (0-2)',
    xray: 'B3.8',
    geomagStatus: 'QUIET',
    lastUpdated: new Date().toLocaleTimeString(),
    source: 'NOAA SWPC',
  });

  const [bands, setBands] = useState<BandPropagation[]>(DEFAULT_BAND_PROPAGATION);

  // Modal / Drawer UI States
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [roadmapModalOpen, setRoadmapModalOpen] = useState(false);
  const [roadmapActiveTab, setRoadmapActiveTab] = useState('coordinate');
  const [touchMenuOpen, setTouchMenuOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<AppLauncherItem | null>(null);

  // Fetch live weather and solar data from backend Express server APIs
  useEffect(() => {
    let cancelled = false;
    const weatherController = new AbortController();
    const alertsController = new AbortController();

    const refreshSolar = async () => {
      try {
        const solarRes = await fetch('/api/solar-data');
        if (solarRes.ok) {
          const sData = await solarRes.json();
          setSolar((prev) => ({
            ...prev,
            solarFlux: toFiniteNumber(sData.solarFlux) ?? prev.solarFlux,
            sunspotNumber: toFiniteNumber(sData.sunspotNumber) ?? prev.sunspotNumber,
            aIndex: toFiniteNumber(sData.aIndex) ?? prev.aIndex,
            kIndex: toFiniteNumber(sData.kIndex) ?? prev.kIndex,
            kDescription: sData.kDescription || prev.kDescription,
            xray: sData.xray || prev.xray,
            lastUpdated: new Date().toLocaleTimeString(),
          }));
        }
      } catch (err) {
        console.warn('Backend solar endpoint fallback');
      }
    };

    const fetchSolarAndWeather = async () => {
      if (!isCurrentOperatingLocation(operatingLocation)) {
        setWeather(null);
        setWeatherStatus('unavailable');
        setNoaaAlerts(null);
        setAlertsStatus('unavailable');
        await refreshSolar();
        return;
      }

      const coordinates = `lat=${operatingLocation.lat}&lon=${operatingLocation.lon}`;
      const refreshWeather = async () => {
        if (cancelled) return;
        setWeather(null);
        setWeatherStatus('loading');
        try {
          const response = await fetch(`/api/weather/current?${coordinates}`, {
            signal: weatherController.signal,
          });
          const data = response.ok ? await response.json() : null;
          if (!cancelled) {
            setWeather(data?.weather ?? null);
            setWeatherStatus(data?.weatherStatus === 'live' ? 'live' : 'unavailable');
          }
        } catch {
          if (!cancelled) {
            setWeather(null);
            setWeatherStatus('unavailable');
            console.warn('Field weather unavailable');
          }
        }
      };

      const refreshAlerts = async () => {
        if (cancelled) return;
        setNoaaAlerts(null);
        setAlertsStatus('loading');
        try {
          const response = await fetch(`/api/weather/alerts?${coordinates}`, {
            signal: alertsController.signal,
          });
          const data = response.ok ? await response.json() : null;
          if (!cancelled) {
            setNoaaAlerts(Array.isArray(data?.alerts) ? data.alerts : null);
            setAlertsStatus(data?.alertsStatus === 'live' ? 'live' : 'unavailable');
          }
        } catch {
          if (!cancelled) {
            setNoaaAlerts(null);
            setAlertsStatus('unavailable');
            console.warn('NOAA alert status unavailable');
          }
        }
      };

      await Promise.allSettled([refreshSolar(), refreshWeather(), refreshAlerts()]);
    };

    fetchSolarAndWeather();
    return () => {
      cancelled = true;
      weatherController.abort();
      alertsController.abort();
    };
  }, [gps.lat, gps.lon, gpsProvenance.status, gpsProvenance.source.type]);

  // Toggle Favorite App
  const handleToggleFavorite = (appId: string) => {
    updateConfig({
      ...config,
      apps: config.apps.map((a) => (a.id === appId ? { ...a, favorite: !a.favorite } : a)),
    });
  };

  // Handle Theme Change
  const handleThemeChange = (newTheme: UIThemeMode) => {
    updateConfig({ ...config, theme: newTheme });
  };

  // Handle GPS Updates
  const handleUpdateGPS = (updated: Partial<GPSStatus>, provenance?: GPSProvenance) => {
    if (provenance) {
      setGpsProvenance(provenance);
    }
    setGps((prev) => {
      const lat = updated.lat ?? prev.lat;
      const lon = updated.lon ?? prev.lon;
      const gridSquare = updated.gridSquare || latLonToGridSquare(lat, lon);
      return {
        ...prev,
        ...updated,
        lat,
        lon,
        gridSquare,
      };
    });
  };

  if (!configReady) {
    return <div className="min-h-screen bg-[#0F1115] text-amber-400 flex items-center justify-center font-mono text-sm">LOADING DASHBOARD CONFIGURATION...</div>;
  }

  // Root class for chosen Theme (Dark Tactical, Red Night Vision, Sunlight High-Contrast)
  const isNight = config.theme === 'night_vision';
  const isSunlight = config.theme === 'sunlight';

  const rootBg = isNight
    ? 'bg-black text-red-500'
    : isSunlight
    ? 'bg-amber-100 text-slate-900 font-sans'
    : 'bg-[#0F1115] text-zinc-100 font-sans';

  return (
    <div className={`min-h-screen ${rootBg} transition-colors flex flex-col selection:bg-amber-500 selection:text-black`}>
      {configPersistenceError && (
        <div role="alert" className="border-b border-red-700 bg-red-950 px-4 py-2 text-center text-xs font-mono text-red-300">
          {configPersistenceError}
        </div>
      )}
      
      {/* 1. Top Header Bar */}
      <HeaderBar
        callsign={config.callsign}
        theme={config.theme}
        onThemeChange={handleThemeChange}
        gps={{ ...gps, gridSquare: operatingGridSquare }}
        battery={battery}
        audioEnabled={config.audioFeedback}
        onToggleAudio={() => updateConfig({ ...config, audioFeedback: !config.audioFeedback })}
        onOpenConfig={() => setConfigModalOpen(true)}
        onOpenRoadmap={(tab) => {
          if (tab) setRoadmapActiveTab(tab);
          setRoadmapModalOpen(true);
        }}
        onToggleTouchMenu={() => setTouchMenuOpen(!touchMenuOpen)}
        touchMenuOpen={touchMenuOpen}
      />

      {/* 2. Main Bento Grid Dashboard Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 space-y-4">
        
        {/* System Status Bento Grid (Battery, GPS, Weather, Regional HF Band Guidance) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SerialPortInventoryWidget />
          {/* Dual Battery Status */}
          <BatteryStatusWidget
            battery={battery}
            theme={config.theme}
            onUpdateBattery={(updated) => setBattery((prev) => ({ ...prev, ...updated }))}
            onSystemTelemetry={setSystemTelemetry}
          />

          {/* GPS & Maidenhead Grid Badge */}
          <GPSGridWidget
            gps={gps}
            provenance={gpsProvenance}
            theme={config.theme}
            audioEnabled={config.audioFeedback}
            onUpdateGPS={handleUpdateGPS}
            comPort={config.gpsComPort}
            baudRate={config.gpsBaudRate}
            onSelectComPort={(port, baud) => {
              updateConfig({ ...config, gpsComPort: port, gpsBaudRate: baud });
            }}
          />

          {/* Field Weather Snapshot & NOAA Alert Badge */}
          <WeatherNOAAWidget
            weather={weather}
            alerts={noaaAlerts}
            weatherStatus={weatherStatus}
            alertsStatus={alertsStatus}
            theme={config.theme}
            audioEnabled={config.audioFeedback}
          />

          {/* Regional HF Band Guidance */}
          <VOACAPPropagationWidget
            solar={solar}
            bands={bands}
            theme={config.theme}
            audioEnabled={config.audioFeedback}
            location={isCurrentOperatingLocation(operatingLocation) ? operatingLocation : undefined}
            onRefreshSolar={async () => {
              const res = await fetch('/api/solar-data');
              if (res.ok) {
                const data = await res.json();
                setSolar((prev) => ({ ...prev, ...data }));
              }
            }}
          />
        </div>

        {/* 3. JSON-based Ham Radio App Launcher Bento Block */}
        <section className="pt-1">
          <AppLauncherGrid
            apps={config.apps}
            theme={config.theme}
            audioEnabled={config.audioFeedback}
            gridColumns={config.appGridColumns}
            launchStates={launchStates}
            onLaunchApp={handleLaunchApp}
            onToggleFavorite={handleToggleFavorite}
            onEditApp={(app) => {
              setEditingApp(app);
              setConfigModalOpen(true);
            }}
            onAddNewApp={() => {
              setEditingApp(null);
              setConfigModalOpen(true);
            }}
          />
        </section>

      </main>

      {/* 4. Bento Task Bar Footer */}
      <footer className={`border-t py-3.5 px-6 text-xs font-mono tracking-wide ${
        isNight ? 'border-red-950 text-red-800 bg-black' : isSunlight ? 'border-amber-300 text-slate-700 bg-amber-200/50' : 'border-zinc-800 text-zinc-400 bg-zinc-900/60'
      }`}>
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-zinc-900/80 border border-zinc-800 px-3 py-1 rounded-lg">
              <span className="text-[10px] text-zinc-500 font-bold uppercase">CPU</span>
              <span className="text-[11px] font-mono text-emerald-400">{systemTelemetry?.cpu?.usagePercent != null ? `${systemTelemetry.cpu.usagePercent}%` : 'Unavailable'}</span>
            </div>
            <div className="flex items-center gap-2 bg-zinc-900/80 border border-zinc-800 px-3 py-1 rounded-lg">
              <span className="text-[10px] text-zinc-500 font-bold uppercase">MEM</span>
              <span className="text-[11px] font-mono text-cyan-400">{systemTelemetry?.memory != null ? `${(systemTelemetry.memory.usedBytes / 1024 ** 3).toFixed(1)} GB (${systemTelemetry.memory.usedPercent}%)` : 'Unavailable'}</span>
            </div>
            <div className="flex items-center gap-2 bg-zinc-900/80 border border-zinc-800 px-3 py-1 rounded-lg">
              <span className="text-[10px] text-zinc-500 font-bold uppercase">DISK</span>
              <span className="text-[11px] font-mono text-amber-400">{formatStorageDisplay(systemTelemetry?.storage ?? null)}</span>
            </div>
            <div className="flex items-center gap-2 bg-zinc-900/80 border border-zinc-800 px-3 py-1 rounded-lg">
              <span className="text-[10px] text-zinc-500 font-bold uppercase">NET</span>
              <span className="text-[11px] font-mono text-sky-400">{formatNetworkDisplay(systemTelemetry?.network ?? null)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">TOUCH MODE:</span>
            <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-mono font-bold uppercase">
              ACTIVE
            </span>
          </div>

          <div className="text-right">
            <span>
              CALLSIGN: <strong className="text-amber-400">{config.callsign}</strong> • GRID: <strong className="text-emerald-400">{operatingGridSquare || 'Unavailable'}</strong>
            </span>
          </div>
        </div>
      </footer>

      {/* 5. Modals & Touch Menu Drawer */}
      <ConfigModal
        config={config}
        theme={config.theme}
        audioEnabled={config.audioFeedback}
        isOpen={configModalOpen}
        onClose={() => {
          setConfigModalOpen(false);
          setEditingApp(null);
        }}
        onSaveConfig={updateConfig}
        onResetToDefaults={() => updateConfig(INITIAL_CONFIG)}
        editingApp={editingApp}
      />

      <RoadmapToolsModal
        theme={config.theme}
        audioEnabled={config.audioFeedback}
        isOpen={roadmapModalOpen}
        onClose={() => setRoadmapModalOpen(false)}
        callsign={config.callsign}
        gridSquare={operatingGridSquare}
        gps={gps}
        gpsProvenance={gpsProvenance}
        initialTab={roadmapActiveTab}
      />

      <TouchMenuDrawer
        isOpen={touchMenuOpen}
        onClose={() => setTouchMenuOpen(false)}
        theme={config.theme}
        audioEnabled={config.audioFeedback}
        onThemeChange={handleThemeChange}
        onOpenConfig={() => setConfigModalOpen(true)}
        onOpenRoadmap={(tab) => {
          if (tab) setRoadmapActiveTab(tab);
          setRoadmapModalOpen(true);
        }}
        callsign={config.callsign}
        gridSquare={operatingGridSquare}
      />

    </div>
  );
}
