import React from 'react';
import { 
  X, 
  Radio, 
  Battery, 
  Navigation, 
  CloudRain, 
  Activity, 
  Wrench, 
  BookOpen, 
  Settings, 
  Bot, 
  Eye, 
  Sun, 
  Moon, 
  Volume2, 
  AlertOctagon,
  Sparkles
} from 'lucide-react';
import { UIThemeMode } from '../types';
import { playTacticalClick } from '../utils/audio';

interface TouchMenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  theme: UIThemeMode;
  audioEnabled: boolean;
  onThemeChange: (t: UIThemeMode) => void;
  onOpenConfig: () => void;
  onOpenRoadmap: (tab?: string) => void;
  callsign: string;
  gridSquare: string;
}

export const TouchMenuDrawer: React.FC<TouchMenuDrawerProps> = ({
  isOpen,
  onClose,
  theme,
  audioEnabled,
  onThemeChange,
  onOpenConfig,
  onOpenRoadmap,
  callsign,
  gridSquare,
}) => {
  if (!isOpen) return null;

  const isNight = theme === 'night_vision';
  const isSunlight = theme === 'sunlight';

  const drawerBg = isNight
    ? 'bg-black border-r border-red-900 text-red-500'
    : isSunlight
    ? 'bg-amber-50 border-r border-amber-400 text-slate-900'
    : 'bg-[#0F1115] border-r border-zinc-800 text-zinc-100';

  const btnBg = isNight
    ? 'bg-red-950/60 border-red-800 text-red-400 hover:bg-red-900'
    : isSunlight
    ? 'bg-amber-200/80 border-slate-400 text-slate-950 font-bold hover:bg-amber-300'
    : 'bg-zinc-900 border-zinc-800 text-zinc-200 hover:bg-zinc-800 hover:border-amber-500/60';

  return (
    <div className="fixed inset-0 z-50 flex font-mono animate-in fade-in duration-200">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => {
          playTacticalClick(audioEnabled);
          onClose();
        }}
      />

      {/* Drawer Panel */}
      <div className={`relative w-80 max-w-[85vw] h-full flex flex-col justify-between p-4 ${drawerBg} shadow-2xl z-10 overflow-y-auto`}>
        
        <div>
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-current/20 mb-4">
            <div>
              <h2 className="font-black text-sm uppercase tracking-wider text-cyan-400">
                TOUCH MENU SYSTEM
              </h2>
              <span className="text-[10px] text-current/70 block">
                {callsign || 'W7FIELD'} • GRID {gridSquare || 'Unavailable'}
              </span>
            </div>

            <button
              id="btn-close-touch-drawer"
              onClick={() => {
                playTacticalClick(audioEnabled);
                onClose();
              }}
              className="p-2 rounded-lg border border-current/30 hover:bg-current/10 active:scale-95"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Action Large Touch Buttons */}
          <div className="space-y-2 text-xs">
            <button
              id="drawer-btn-smart-deploy"
              onClick={() => {
                playTacticalClick(audioEnabled);
                onOpenRoadmap('smart_deploy');
                onClose();
              }}
              className={`w-full p-3 rounded-xl border text-left flex items-center gap-3 transition-all active:scale-95 touch-manipulation ${btnBg}`}
            >
              <Wrench className="w-5 h-5 text-amber-400" />
              <div>
                <span className="font-black block uppercase">SmartDeploy</span>
                <span className="text-[10px] opacity-75">Activation planning and antenna length calculator</span>
              </div>
            </button>

            <button
              id="drawer-btn-config"
              onClick={() => {
                playTacticalClick(audioEnabled);
                onOpenConfig();
                onClose();
              }}
              className={`w-full p-3 rounded-xl border text-left flex items-center gap-3 transition-all active:scale-95 touch-manipulation ${btnBg}`}
            >
              <Settings className="w-5 h-5 text-amber-300" />
              <div>
                <span className="font-black block uppercase">JSON Launcher Config</span>
                <span className="text-[10px] opacity-75">Add and edit configured app entries</span>
              </div>
            </button>
          </div>

          {/* Theme Quick Switches */}
          <div className="mt-5 space-y-2">
            <span className="text-[10px] uppercase font-bold text-current/60 block">TACTICAL DISPLAY THEME</span>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                id="drawer-theme-dark"
                onClick={() => {
                  playTacticalClick(audioEnabled);
                  onThemeChange('dark_tactical');
                }}
                className={`p-2 rounded border text-[10px] font-bold flex flex-col items-center justify-center gap-1 ${
                  theme === 'dark_tactical' ? 'border-cyan-500 bg-cyan-950 text-cyan-300' : 'border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                <Moon className="w-4 h-4" /> TACTICAL
              </button>

              <button
                id="drawer-theme-red"
                onClick={() => {
                  playTacticalClick(audioEnabled);
                  onThemeChange('night_vision');
                }}
                className={`p-2 rounded border text-[10px] font-bold flex flex-col items-center justify-center gap-1 ${
                  theme === 'night_vision' ? 'border-red-600 bg-red-950 text-red-400' : 'border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                <Eye className="w-4 h-4" /> NIGHT RED
              </button>

              <button
                id="drawer-theme-sun"
                onClick={() => {
                  playTacticalClick(audioEnabled);
                  onThemeChange('sunlight');
                }}
                className={`p-2 rounded border text-[10px] font-bold flex flex-col items-center justify-center gap-1 ${
                  theme === 'sunlight' ? 'border-amber-500 bg-amber-300 text-slate-950 font-bold' : 'border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                <Sun className="w-4 h-4" /> SUNLIGHT
              </button>
            </div>
          </div>
        </div>

        {/* Emergency Distress Beacon Button at bottom */}
        <div className="pt-4 border-t border-current/20">
          <button
            id="btn-emergency-sos"
            disabled
            aria-describedby="sos-unavailable-reason"
            className="w-full py-3 px-4 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-500 font-black text-xs flex items-center justify-center gap-2 cursor-not-allowed opacity-70"
          >
            <AlertOctagon className="w-5 h-5" />
            <span>SOS TRANSMISSION UNAVAILABLE</span>
          </button>
          <p id="sos-unavailable-reason" className="mt-1.5 text-[10px] text-zinc-500 text-center">
            No emergency transmitter or mesh gateway is configured. Use established emergency channels.
          </p>
        </div>

      </div>
    </div>
  );
};
