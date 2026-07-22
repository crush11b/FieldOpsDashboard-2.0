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
import { AutoAppInstallerModal } from './components/AutoAppInstallerModal';

import { 
  AppLauncherItem, 
  BandPropagation, 
  DashboardConfig, 
  DualBatteryStatus, 
  GPSStatus, 
  NetworkStatus, 
  NOAAAlert, 
  SolarData, 
  UIThemeMode, 
  WeatherData,
  latLonToGridSquare 
} from './types';
import { DEFAULT_APPS, DEFAULT_BAND_PROPAGATION, INITIAL_CONFIG } from './data/defaultConfig';
import { playTacticalClick } from './utils/audio';

const STORAGE_KEY = 'fieldops_dashboard_config_v115';

export default function App() {
  // 1. Dashboard Persistent Config
  const [config, setConfig] = useState<DashboardConfig>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Ensure all default catalog apps are present in the app launcher list
          if (parsed && Array.isArray(parsed.apps)) {
            const existingIds = new Set(parsed.apps.map((a: AppLauncherItem) => a.id));
            const missingApps = DEFAULT_APPS.filter(a => !existingIds.has(a.id));
            if (missingApps.length > 0) {
              parsed.apps = [...parsed.apps, ...missingApps];
            }
          }
          return parsed;
        } catch (e) {
          console.warn('Failed to parse saved config, using initial config');
        }
      }
    }
    return INITIAL_CONFIG;
  });

  // Save config changes to LocalStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  // 2. Dual Battery Status
  const [battery, setBattery] = useState<DualBatteryStatus>({
    mainTablet: {
      percent: 88,
      charging: false,
      voltage: 11.8,
      health: 'Good',
      tempC: 28,
      timeRemainingMins: 310,
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

  // 3. Network Link Status
  const [network, setNetwork] = useState<NetworkStatus>({
    online: true,
    type: 'cellular',
    interfaceName: 'Panasonic LTE Modem (Sierra Wireless)',
    dnsLatencyMs: 34,
    ipAddress: '10.240.82.119',
    signalDbm: -72,
    packetsDropped: 0,
  });

  // 4. GPS & Maidenhead Grid Square (Default: Richmond, VA)
  const [gps, setGps] = useState<GPSStatus>({
    lat: 37.5407,
    lon: -77.4360,
    altitudeM: 51,
    speedKmh: 0,
    gridSquare: 'FM17hd',
    satCount: 11,
    fixType: '3D Fix',
    lockTime: 'UTC ' + new Date().toISOString().substring(11, 19),
    mode: 'auto',
    deviceName: 'u-blox NEO-M8N USB GPS',
  });

  // 5. Weather & NOAA Alerts
  const [weather, setWeather] = useState<WeatherData>({
    tempF: 78,
    tempC: 25,
    humidity: 52,
    pressureInHg: 30.08,
    pressureHpa: 1018,
    windMph: 6,
    windDir: 'SW',
    condition: 'Clear Sky',
    icon: 'sun',
    locationName: 'Richmond, VA (FM17hd)',
    dewPointF: 58,
    uvIndex: 6,
    visibilityMiles: 10,
    lastUpdated: new Date().toLocaleTimeString(),
    cached: false,
  });

  const [noaaAlerts, setNoaaAlerts] = useState<NOAAAlert[]>([]);

  // 6. VOACAP Propagation & Solar Flux Data
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
  const [roadmapActiveTab, setRoadmapActiveTab] = useState('smart_deploy');
  const [touchMenuOpen, setTouchMenuOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<AppLauncherItem | null>(null);
  const [autoInstallerModalOpen, setAutoInstallerModalOpen] = useState(false);

  // Fetch live weather and solar data from backend Express server APIs
  useEffect(() => {
    const fetchSolarAndWeather = async () => {
      try {
        const solarRes = await fetch('/api/solar-data');
        if (solarRes.ok) {
          const sData = await solarRes.json();
          setSolar((prev) => ({
            ...prev,
            solarFlux: sData.solarFlux || prev.solarFlux,
            sunspotNumber: sData.sunspotNumber || prev.sunspotNumber,
            aIndex: sData.aIndex || prev.aIndex,
            kIndex: sData.kIndex || prev.kIndex,
            kDescription: sData.kDescription || prev.kDescription,
            xray: sData.xray || prev.xray,
            lastUpdated: new Date().toLocaleTimeString(),
          }));
        }
      } catch (err) {
        console.warn('Backend solar endpoint fallback');
      }

      try {
        const weatherRes = await fetch(`/api/weather?lat=${gps.lat}&lon=${gps.lon}`);
        if (weatherRes.ok) {
          const wData = await weatherRes.json();
          if (wData.weather) {
            setWeather((prev) => ({ ...prev, ...wData.weather }));
          }
          if (wData.alerts && Array.isArray(wData.alerts)) {
            setNoaaAlerts(wData.alerts);
          }
        }
      } catch (err) {
        console.warn('Backend weather endpoint fallback');
      }
    };

    fetchSolarAndWeather();
  }, [gps.lat, gps.lon]);

  // Handle App Launching
  const handleLaunchApp = (app: AppLauncherItem) => {
    console.log(`Launched ${app.name} (${app.executablePath})`);
  };

  // Toggle Favorite App
  const handleToggleFavorite = (appId: string) => {
    setConfig((prev) => ({
      ...prev,
      apps: prev.apps.map((a) => (a.id === appId ? { ...a, favorite: !a.favorite } : a)),
    }));
  };

  // Handle Theme Change
  const handleThemeChange = (newTheme: UIThemeMode) => {
    setConfig((prev) => ({ ...prev, theme: newTheme }));
  };

  // Handle GPS Updates
  const handleUpdateGPS = (updated: Partial<GPSStatus>) => {
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
      
      {/* 1. Top Header Bar */}
      <HeaderBar
        callsign={config.callsign}
        theme={config.theme}
        onThemeChange={handleThemeChange}
        gps={gps}
        battery={battery}
        network={network}
        audioEnabled={config.audioFeedback}
        onToggleAudio={() => setConfig((prev) => ({ ...prev, audioFeedback: !prev.audioFeedback }))}
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
        
        {/* System Status Bento Grid (Battery, GPS, Weather, VOACAP Propagation) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Dual Battery Status */}
          <BatteryStatusWidget battery={battery} theme={config.theme} />

          {/* GPS & Maidenhead Grid Badge */}
          <GPSGridWidget
            gps={gps}
            theme={config.theme}
            audioEnabled={config.audioFeedback}
            onUpdateGPS={handleUpdateGPS}
          />

          {/* Field Weather Snapshot & NOAA Alert Badge */}
          <WeatherNOAAWidget
            weather={weather}
            alerts={noaaAlerts}
            theme={config.theme}
            audioEnabled={config.audioFeedback}
          />

          {/* Real-time VOACAP HF Propagation Forecast */}
          <VOACAPPropagationWidget
            solar={solar}
            bands={bands}
            theme={config.theme}
            audioEnabled={config.audioFeedback}
            location={config.location}
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
            onOpenAutoInstaller={() => setAutoInstallerModalOpen(true)}
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
              <span className="text-[11px] font-mono text-emerald-400">14%</span>
            </div>
            <div className="flex items-center gap-2 bg-zinc-900/80 border border-zinc-800 px-3 py-1 rounded-lg">
              <span className="text-[10px] text-zinc-500 font-bold uppercase">MEM</span>
              <span className="text-[11px] font-mono text-cyan-400">2.4 GB</span>
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
              CALLSIGN: <strong className="text-amber-400">{config.callsign}</strong> • GRID: <strong className="text-emerald-400">{gps.gridSquare}</strong>
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
        onSaveConfig={(updated) => setConfig(updated)}
        onResetToDefaults={() => setConfig(INITIAL_CONFIG)}
        editingApp={editingApp}
      />

      <RoadmapToolsModal
        theme={config.theme}
        audioEnabled={config.audioFeedback}
        isOpen={roadmapModalOpen}
        onClose={() => setRoadmapModalOpen(false)}
        callsign={config.callsign}
        gridSquare={gps.gridSquare}
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
        gridSquare={gps.gridSquare}
      />

      <AutoAppInstallerModal
        isOpen={autoInstallerModalOpen}
        onClose={() => setAutoInstallerModalOpen(false)}
        theme={config.theme}
        audioEnabled={config.audioFeedback}
        apps={config.apps}
        onUpdateAppPaths={(updatedApps) => {
          setConfig((prev) => ({ ...prev, apps: updatedApps }));
        }}
      />

    </div>
  );
}
