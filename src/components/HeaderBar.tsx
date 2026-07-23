import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  BatteryCharging, 
  Wifi, 
  WifiOff, 
  Navigation, 
  Sun, 
  Moon, 
  Eye, 
  Menu, 
  Settings, 
  Zap,
  MapPin,
  Volume2,
  VolumeX,
  Sparkles,
  Download,
  Clock
} from 'lucide-react';
import { DualBatteryStatus, GPSStatus, NetworkStatus, UIThemeMode } from '../types';
import { playTacticalClick } from '../utils/audio';

interface HeaderBarProps {
  callsign: string;
  theme: UIThemeMode;
  onThemeChange: (theme: UIThemeMode) => void;
  gps: GPSStatus;
  battery: DualBatteryStatus;
  network: NetworkStatus;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  onOpenConfig: () => void;
  onOpenRoadmap: (tab?: string) => void;
  onToggleTouchMenu: () => void;
  touchMenuOpen: boolean;
  onToggleNetwork?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  callsign,
  theme,
  onThemeChange,
  gps,
  battery,
  network,
  audioEnabled,
  onToggleAudio,
  onOpenConfig,
  onOpenRoadmap,
  onToggleTouchMenu,
  touchMenuOpen,
  onToggleNetwork,
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

  const isNight = theme === 'night_vision';
  const isSunlight = theme === 'sunlight';

  // Theme-specific color classes
  const headerBg = isNight
    ? 'bg-black border-red-900/80 text-red-500'
    : isSunlight
    ? 'bg-amber-100/90 border-amber-400 text-slate-900'
    : 'bg-zinc-900/80 border-zinc-800 text-zinc-100 shadow-2xl';

  const badgeBorder = isNight
    ? 'border-red-800 bg-red-950/40 text-red-400'
    : isSunlight
    ? 'border-slate-400 bg-amber-200 text-slate-950 font-bold'
    : 'border-zinc-800 bg-zinc-800/60 text-zinc-300';

  return (
    <header className="sticky top-0 z-30 p-2 sm:p-4 transition-colors">
      <div className={`max-w-7xl mx-auto flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border ${headerBg} backdrop-blur-md`}>
        
        {/* Left: Brand & Operator Callsign & Version v2.1 */}
        <div className="flex items-center gap-3">
          <button
            id="btn-touch-menu-toggle"
            onClick={() => {
              playTacticalClick(audioEnabled);
              onToggleTouchMenu();
            }}
            className={`p-2 rounded-xl border transition-all active:scale-95 touch-manipulation ${
              touchMenuOpen
                ? isNight ? 'bg-red-900 text-black border-red-600' : 'bg-amber-500 text-black border-amber-400 font-bold'
                : isNight ? 'border-red-900 bg-red-950/50 text-red-400 hover:bg-red-900/40' : 'border-zinc-800 bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700'
            }`}
            title="Toggle Tactical Touch Menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3">
            <div className="bg-amber-500 text-black font-black px-2 py-0.5 rounded text-xs tracking-tighter uppercase shrink-0">
              FieldOps
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-base sm:text-lg font-black tracking-wider uppercase text-zinc-100">
                  {callsign || 'W7FIELD'}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded border uppercase tracking-widest font-mono font-bold ${
                  isNight ? 'border-red-900 text-red-400 bg-black' : isSunlight ? 'border-slate-500 bg-amber-300 text-slate-900' : 'border-zinc-700 bg-zinc-800/80 text-amber-400'
                }`}>
                  v2.1
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Dual Clock (Local & UTC), Maidenhead Grid, Battery, Network */}
        <div className="hidden lg:flex items-center gap-3 font-mono">
          {/* Dual Clock Badge */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${badgeBorder}`}>
            <Clock className="w-4 h-4 text-cyan-400 animate-pulse" />
            <div className="flex flex-col">
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-none">TIME SYNC (LOCAL / UTC)</span>
              <span className="text-xs font-black text-cyan-300 tracking-wider">
                {localTime || '12:00:00'} <span className="text-zinc-500">|</span> {utcTime || '16:00:00 UTC'}
              </span>
            </div>
          </div>

          {/* Maidenhead Grid Square Badge */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${badgeBorder}`}>
            <MapPin className="w-4 h-4 text-emerald-400" />
            <div className="flex flex-col">
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-none">GRID SQUARE</span>
              <span className="text-xs font-black tracking-widest text-emerald-400">
                {gps.gridSquare || 'FM17hd'}
              </span>
            </div>
          </div>

          {/* Dual Battery Status summary */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${badgeBorder}`}>
            <BatteryCharging className="w-4 h-4 text-amber-400" />
            <div className="flex flex-col">
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-none">DUAL BATT</span>
              <span className="text-xs font-bold text-zinc-200">
                M:{battery.mainTablet.percent}% | K:{battery.keyboardDock.attached ? `${battery.keyboardDock.percent}%` : 'N/A'}
              </span>
            </div>
          </div>

          {/* Network link status (Interactive Toggle) */}
          <button
            id="btn-header-network-toggle"
            onClick={() => {
              playTacticalClick(audioEnabled);
              if (onToggleNetwork) onToggleNetwork();
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all active:scale-95 ${
              network.online 
                ? badgeBorder 
                : isNight ? 'border-red-600 bg-red-950 text-red-500' : 'border-amber-600 bg-amber-950/40 text-amber-400'
            }`}
            title="Click to toggle Network Interface (Wi-Fi / Cellular / Mesh RF / Offline)"
          >
            {network.online ? (
              <Wifi className="w-4 h-4 text-emerald-400" />
            ) : (
              <WifiOff className="w-4 h-4 text-amber-400" />
            )}
            <div className="flex flex-col text-left">
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-none">
                NET ({network.type.toUpperCase()})
              </span>
              <span className="text-xs uppercase font-mono font-bold text-emerald-400">
                {network.online ? `${network.type} (${network.dnsLatencyMs}ms)` : 'OFFLINE RF'}
              </span>
            </div>
          </button>
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
            className={`px-3 py-1.5 rounded-xl border text-xs font-bold font-mono flex items-center gap-1.5 transition-all active:scale-95 touch-manipulation ${
              isNight 
                ? 'border-red-800 bg-red-950 text-red-400 hover:bg-red-900' 
                : isSunlight 
                ? 'border-slate-500 bg-amber-300 text-slate-900 hover:bg-amber-400' 
                : 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
            }`}
            title="Launch Field Tools (SmartDeploy, SmartLog+, AI Assistant)"
          >
            <Sparkles className="w-4 h-4 text-amber-400 animate-spin-slow" />
            <span className="hidden md:inline uppercase">FIELD TOOLS</span>
          </button>

          {/* Theme Selector Switches */}
          <div className="flex items-center rounded-xl border p-0.5 bg-zinc-950 border-zinc-800">
            <button
              id="btn-theme-dark-tactical"
              onClick={() => {
                playTacticalClick(audioEnabled);
                onThemeChange('dark_tactical');
              }}
              className={`p-1.5 rounded-lg transition-all ${
                theme === 'dark_tactical' 
                  ? 'bg-amber-500 text-black font-bold shadow' 
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Bento Dark Tactical Theme"
            >
              <Moon className="w-4 h-4" />
            </button>
            <button
              id="btn-theme-night-vision"
              onClick={() => {
                playTacticalClick(audioEnabled);
                onThemeChange('night_vision');
              }}
              className={`p-1.5 rounded-lg transition-all ${
                theme === 'night_vision' 
                  ? 'bg-red-800 text-red-100 font-bold shadow' 
                  : 'text-zinc-400 hover:text-red-400'
              }`}
              title="Red Night Vision Mode (Monochromatic)"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              id="btn-theme-sunlight"
              onClick={() => {
                playTacticalClick(audioEnabled);
                onThemeChange('sunlight');
              }}
              className={`p-1.5 rounded-lg transition-all ${
                theme === 'sunlight' 
                  ? 'bg-amber-400 text-slate-950 font-bold shadow' 
                  : 'text-zinc-400 hover:text-amber-300'
              }`}
              title="Sunlight Readable High-Contrast Light Mode"
            >
              <Sun className="w-4 h-4" />
            </button>
          </div>

          {/* Audio Beep Feedback Toggle */}
          <button
            id="btn-toggle-audio-feedback"
            onClick={onToggleAudio}
            className={`p-2 rounded-xl border transition-all active:scale-95 touch-manipulation ${
              audioEnabled 
                ? isNight ? 'border-red-800 bg-red-950 text-red-400' : 'border-zinc-700 bg-zinc-800 text-amber-400' 
                : 'border-zinc-800 bg-zinc-900 text-zinc-600'
            }`}
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
            className={`p-2 rounded-xl border transition-all active:scale-95 touch-manipulation ${
              isNight ? 'border-red-900 bg-red-950/50 text-red-400 hover:bg-red-900' : 'border-zinc-800 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
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
                a.download = 'FieldOpsDashboard_v2.0.zip';
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
            className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 touch-manipulation ${
              isNight 
                ? 'border-red-700 bg-red-900 text-red-100 hover:bg-red-800' 
                : 'border-amber-500 bg-amber-500 text-slate-950 hover:bg-amber-400 font-extrabold'
            }`}
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
