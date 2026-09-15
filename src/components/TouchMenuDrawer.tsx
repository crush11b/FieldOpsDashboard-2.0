import React from 'react';
import { 
  X, 
  Wrench, 
  Settings, 
  Eye, 
  Sun, 
  Moon, 
  AlertOctagon,
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

  return (
    <div className="fixed inset-0 z-50 flex font-mono animate-in fade-in duration-200" data-theme={theme}>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close touch menu"
        className="fixed inset-0 bg-black/70"
        onClick={() => {
          playTacticalClick(audioEnabled);
          onClose();
        }}
      />

      {/* Drawer Panel */}
      <div role="dialog" aria-modal="true" aria-labelledby="touch-menu-title" className="fo-surface relative w-80 max-w-[85vw] h-full flex flex-col justify-between p-4 border-r shadow-2xl z-10 overflow-y-auto">
        
        <div>
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b mb-4" style={{ borderColor: 'var(--fo-border-subtle)' }}>
            <div>
              <h2 id="touch-menu-title" className="fo-text-primary font-black text-sm uppercase tracking-wider">
                TOUCH MENU SYSTEM
              </h2>
              <span className="fo-text-muted text-[10px] block">
                {callsign || 'W7FIELD'} • GRID {gridSquare || 'Unavailable'}
              </span>
            </div>

            <button
              id="btn-close-touch-drawer"
              aria-label="Close touch menu"
              onClick={() => {
                playTacticalClick(audioEnabled);
                onClose();
              }}
              className="fo-control min-h-11 min-w-11 p-2 rounded-xl border active:scale-95 flex items-center justify-center"
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
              className="fo-control min-h-11 w-full p-3 rounded-xl border text-left flex items-center gap-3 transition-all active:scale-95 touch-manipulation"
            >
              <Wrench className="fo-icon-caution w-5 h-5" />
              <div>
                <span className="font-black block uppercase">SmartDeploy</span>
                <span className="text-[10px] opacity-75">Activation planning workspace</span>
              </div>
            </button>

            <button
              id="drawer-btn-config"
              onClick={() => {
                playTacticalClick(audioEnabled);
                onOpenConfig();
                onClose();
              }}
              className="fo-control min-h-11 w-full p-3 rounded-xl border text-left flex items-center gap-3 transition-all active:scale-95 touch-manipulation"
            >
              <Settings className="fo-icon-neutral w-5 h-5" />
              <div>
                <span className="font-black block uppercase">JSON Launcher Config</span>
                <span className="text-[10px] opacity-75">Add and edit configured app entries</span>
              </div>
            </button>
          </div>

          {/* Theme Quick Switches */}
          <div className="mt-5 space-y-2">
            <span className="fo-text-muted text-[10px] uppercase font-bold block">DISPLAY THEME</span>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                id="drawer-theme-dark"
                aria-pressed={theme === 'dark_tactical'}
                onClick={() => {
                  playTacticalClick(audioEnabled);
                  onThemeChange('dark_tactical');
                }}
                className="fo-theme-choice min-h-11 p-2 rounded-xl border border-transparent text-[10px] font-bold flex flex-col items-center justify-center gap-1"
              >
                <Moon className="w-4 h-4" /> TACTICAL
              </button>

              <button
                id="drawer-theme-red"
                aria-pressed={theme === 'night_vision'}
                onClick={() => {
                  playTacticalClick(audioEnabled);
                  onThemeChange('night_vision');
                }}
                className="fo-theme-choice min-h-11 p-2 rounded-xl border border-transparent text-[10px] font-bold flex flex-col items-center justify-center gap-1"
              >
                <Eye className="w-4 h-4" /> NIGHT RED
              </button>

              <button
                id="drawer-theme-sun"
                aria-pressed={theme === 'sunlight'}
                onClick={() => {
                  playTacticalClick(audioEnabled);
                  onThemeChange('sunlight');
                }}
                className="fo-theme-choice min-h-11 p-2 rounded-xl border border-transparent text-[10px] font-bold flex flex-col items-center justify-center gap-1"
              >
                <Sun className="w-4 h-4" /> SUNLIGHT
              </button>
            </div>
          </div>
        </div>

        {/* Emergency Distress Beacon Button at bottom */}
        <div className="pt-4 border-t" style={{ borderColor: 'var(--fo-border-subtle)' }}>
          <button
            id="btn-emergency-sos"
            disabled
            aria-describedby="sos-unavailable-reason"
            className="fo-status-neutral min-h-11 w-full py-3 px-4 rounded-xl border font-black text-xs flex items-center justify-center gap-2 cursor-not-allowed opacity-70"
          >
            <AlertOctagon className="w-5 h-5" />
            <span>SOS TRANSMISSION UNAVAILABLE</span>
          </button>
          <p id="sos-unavailable-reason" className="fo-text-muted mt-1.5 text-[10px] text-center">
            No emergency transmitter or mesh gateway is configured. Use established emergency channels.
          </p>
        </div>

      </div>
    </div>
  );
};
