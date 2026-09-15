import React, { useState, useEffect } from 'react';
import { 
  BatteryCharging, 
  WifiOff,
  Sun, 
  Moon, 
  Eye, 
  Menu, 
  Settings, 
  MapPin,
  Volume2,
  VolumeX,
  Sparkles,
  Download,
  Clock
} from 'lucide-react';
import { DualBatteryStatus, GPSStatus, SystemTelemetry, UIThemeMode } from '../types';
import { playTacticalClick } from '../utils/audio';
import { getVersionedDownloadFilename, PRODUCT_METADATA } from '../productMetadata';
import { formatNetworkDisplay } from '../utils/systemTelemetryDisplay';

interface HeaderBarProps {
  callsign: string;
  theme: UIThemeMode;
  onThemeChange: (theme: UIThemeMode) => void;
  gps: GPSStatus;
  battery: DualBatteryStatus;
  systemTelemetry: SystemTelemetry | null;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  onOpenConfig: () => void;
  onOpenRoadmap: (tab?: string) => void;
  onToggleTouchMenu: () => void;
  touchMenuOpen: boolean;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  callsign,
  theme,
  onThemeChange,
  gps,
  battery,
  systemTelemetry,
  audioEnabled,
  onToggleAudio,
  onOpenConfig,
  onOpenRoadmap,
  onToggleTouchMenu,
  touchMenuOpen,
}) => {
  const [localTime, setLocalTime] = useState<string>('');
  const [utcTime, setUtcTime] = useState<string>('');

  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      setLocalTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
      setUtcTime(now.toISOString().substring(11, 19) + ' UTC');
    };
    updateClocks();
    const interval = setInterval(updateClocks, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-30 p-2 sm:p-4 transition-colors">
      <div className="fo-header max-w-7xl mx-auto flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border">
        
        {/* Left: Brand, operator callsign, and release version. */}
        <div className="flex items-center gap-3">
          <button
            id="btn-touch-menu-toggle"
            onClick={() => {
              playTacticalClick(audioEnabled);
              onToggleTouchMenu();
            }}
            className={`min-h-11 min-w-11 p-2 rounded-xl border transition-all active:scale-95 touch-manipulation ${touchMenuOpen ? 'fo-control-primary' : 'fo-control'}`}
            aria-pressed={touchMenuOpen}
            aria-label="Toggle field menu"
            title="Toggle field menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3">
            <div className="fo-brand font-black px-2 py-0.5 rounded text-xs tracking-tighter uppercase shrink-0">
              FieldOps
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="fo-text-primary font-mono text-base sm:text-lg font-black tracking-wider uppercase">
                  {callsign || 'W7FIELD'}
                </span>
                <span className="fo-badge text-[10px] px-2 py-0.5 rounded border uppercase tracking-widest font-mono font-bold">
                  {PRODUCT_METADATA.displayVersion}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Dual Clock (Local & UTC), Maidenhead Grid, Battery, Network */}
        <div className="hidden lg:flex items-center gap-3 font-mono">
          {/* Dual Clock Badge */}
          <div className="fo-badge flex items-center gap-2 px-3 py-1.5 rounded-xl border">
            <Clock className="fo-icon-info w-4 h-4" />
            <div className="flex flex-col">
              <span className="fo-text-muted text-[9px] font-bold uppercase tracking-widest leading-none">TIME SYNC (LOCAL / UTC)</span>
              <span className="fo-text-info text-xs font-black tracking-wider">
                {localTime || '12:00:00'} <span className="fo-text-muted">|</span> {utcTime || '16:00:00 UTC'}
              </span>
            </div>
          </div>

          {/* Maidenhead Grid Square Badge */}
          <div className="fo-badge flex items-center gap-2 px-3 py-1.5 rounded-xl border">
            <MapPin className="fo-icon-neutral w-4 h-4" />
            <div className="flex flex-col">
              <span className="fo-text-muted text-[9px] font-bold uppercase tracking-widest leading-none">GRID SQUARE</span>
              <span className="fo-text-primary text-xs font-black tracking-widest">
                {gps.gridSquare || '—'}
              </span>
            </div>
          </div>

          {/* Dual Battery Status summary */}
          <div className="fo-badge flex items-center gap-2 px-3 py-1.5 rounded-xl border">
            <BatteryCharging className="fo-icon-neutral w-4 h-4" />
            <div className="flex flex-col">
              <span className="fo-text-muted text-[9px] font-bold uppercase tracking-widest leading-none">DUAL BATT</span>
              <span className="fo-text-primary text-xs font-bold">
                M:{battery.mainTablet.percent}% | K:{battery.keyboardDock.attached ? `${battery.keyboardDock.percent}%` : 'N/A'}
              </span>
            </div>
          </div>

          <div
            id="header-network-status"
            role="status"
            aria-label={`Network status: ${formatNetworkDisplay(systemTelemetry?.network ?? null)}`}
            className="fo-badge flex items-center gap-2 px-3 py-1.5 rounded-xl border"
          >
            <WifiOff className="fo-icon-neutral w-4 h-4" />
            <div className="flex flex-col text-left">
              <span className="fo-text-muted text-[9px] font-bold uppercase tracking-widest leading-none">
                NETWORK
              </span>
              <span className="fo-text-secondary text-xs uppercase font-mono font-bold">
                {formatNetworkDisplay(systemTelemetry?.network ?? null)}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Quick Action Controls & Theme Toggles */}
        <div className="flex items-center gap-2">
          {/* Smart Tools Launcher */}
          <button
            id="btn-open-smart-tools"
            onClick={() => {
              playTacticalClick(audioEnabled);
              onOpenRoadmap();
            }}
            className="fo-control min-h-11 px-3 py-1.5 rounded-xl border text-xs font-bold font-mono flex items-center gap-1.5 transition-all active:scale-95 touch-manipulation"
            title="Launch Field Tools (SmartDeploy, location, distance, and solar tools)"
          >
            <Sparkles className="fo-icon-neutral w-4 h-4" />
            <span className="hidden md:inline uppercase">FIELD TOOLS</span>
          </button>

          {/* Theme Selector Switches */}
          <div className="fo-theme-group flex items-center rounded-xl border p-0.5" role="group" aria-label="Display theme">
            <button
              id="btn-theme-dark-tactical"
              onClick={() => {
                playTacticalClick(audioEnabled);
                onThemeChange('dark_tactical');
              }}
              className="fo-theme-choice min-h-11 min-w-11 p-1.5 rounded-lg transition-all touch-manipulation"
              aria-pressed={theme === 'dark_tactical'}
              aria-label="Dark field theme"
              title="Dark field theme"
            >
              <Moon className="w-4 h-4" />
            </button>
            <button
              id="btn-theme-night-vision"
              onClick={() => {
                playTacticalClick(audioEnabled);
                onThemeChange('night_vision');
              }}
              className="fo-theme-choice min-h-11 min-w-11 p-1.5 rounded-lg transition-all touch-manipulation"
              aria-pressed={theme === 'night_vision'}
              aria-label="Red-light field mode"
              title="Red-light field mode"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              id="btn-theme-sunlight"
              onClick={() => {
                playTacticalClick(audioEnabled);
                onThemeChange('sunlight');
              }}
              className="fo-theme-choice min-h-11 min-w-11 p-1.5 rounded-lg transition-all touch-manipulation"
              aria-pressed={theme === 'sunlight'}
              aria-label="Sunlight day mode"
              title="Sunlight day mode"
            >
              <Sun className="w-4 h-4" />
            </button>
          </div>

          {/* Audio Beep Feedback Toggle */}
          <button
            id="btn-toggle-audio-feedback"
            onClick={onToggleAudio}
            className={`fo-control min-h-11 min-w-11 p-2 rounded-xl border transition-all active:scale-95 touch-manipulation ${audioEnabled ? 'fo-text-caution' : 'fo-text-muted'}`}
            aria-pressed={audioEnabled}
            aria-label={audioEnabled ? 'Mute audio feedback' : 'Enable audio feedback'}
            title={audioEnabled ? 'Tactical Audio On' : 'Mute Tactical Audio'}
          >
            {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Config / JSON Launcher Editor */}
          <button
            id="btn-open-config-editor"
            onClick={() => {
              playTacticalClick(audioEnabled);
              onOpenConfig();
            }}
            className="fo-control min-h-11 min-w-11 p-2 rounded-xl border transition-all active:scale-95 touch-manipulation"
            aria-label="Open dashboard configuration"
            title="Configure Dashboard & JSON Apps Launcher"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Download Project ZIP Button */}
          <button
            id="btn-download-project-zip-header"
            onClick={async () => {
              playTacticalClick(audioEnabled);
              try {
                const res = await fetch('/api/download-project-zip');
                if (!res.ok) throw new Error('ZIP build failed');
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = getVersionedDownloadFilename();
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
              } catch (err) {
                console.error("ZIP download failed:", err);
                alert("Failed to download ZIP. Trying direct link...");
                window.location.href = "/api/download-project-zip";
              }
            }}
            className="fo-control-primary min-h-11 px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 touch-manipulation"
            title="Download full project source code ZIP for Toughbook local deployment"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">ZIP</span>
          </button>
        </div>

      </div>
    </header>
  );
};
