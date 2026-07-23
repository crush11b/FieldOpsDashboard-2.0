import React, { useEffect, useState } from 'react';
import { BatteryCharging, Battery, Plug, Zap, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import { DualBatteryStatus, UIThemeMode } from '../types';

interface BatteryStatusWidgetProps {
  battery: DualBatteryStatus;
  theme: UIThemeMode;
  onUpdateBattery?: (updated: Partial<DualBatteryStatus>) => void;
}

export const BatteryStatusWidget: React.FC<BatteryStatusWidgetProps> = ({ battery, theme, onUpdateBattery }) => {
  const isNight = theme === 'night_vision';
  const isSunlight = theme === 'sunlight';

  useEffect(() => {
    // Hook into Web Battery API if supported by OS/browser
    if (typeof navigator !== 'undefined' && (navigator as any).getBattery) {
      (navigator as any).getBattery().then((batt: any) => {
        const updateHardwareBatt = () => {
          const pct = Math.round(batt.level * 100);
          const charging = batt.charging;
          const disTime = batt.dischargingTime !== Infinity ? Math.round(batt.dischargingTime / 60) : 240;

          if (onUpdateBattery) {
            onUpdateBattery({
              powerSource: charging ? 'AC Power & Charger' : 'Internal Li-Ion Battery',
              mainTablet: {
                ...battery.mainTablet,
                percent: pct,
                charging,
                timeRemainingMins: disTime,
              },
            });
          }
        };

        updateHardwareBatt();
        batt.addEventListener('levelchange', updateHardwareBatt);
        batt.addEventListener('chargingchange', updateHardwareBatt);
      }).catch(() => {});
    }
  }, []);

  const cardBg = isNight
    ? 'bg-black border-red-900/90 text-red-500 rounded-2xl p-4 sm:p-5 shadow-lg'
    : isSunlight
    ? 'bg-white border-amber-400 text-slate-900 shadow-sm rounded-2xl p-4 sm:p-5'
    : 'bg-zinc-900/50 border-zinc-800 text-zinc-100 shadow-lg rounded-2xl p-4 sm:p-5';

  const mainPct = battery.mainTablet.percent;
  const kbPct = battery.keyboardDock.percent;
  const mainLow = mainPct <= 20;
  const kbLow = battery.keyboardDock.attached && kbPct <= 20;

  return (
    <div className={`border ${cardBg} font-mono transition-all space-y-3`}>
      {/* Widget Header */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          <Zap className={`w-4 h-4 ${isNight ? 'text-red-500' : 'text-amber-400'}`} />
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
            DUAL-BATTERY SYSTEM (CF-20 / FZ-G1)
          </h3>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-zinc-800/80 border border-zinc-700/60 text-zinc-300">
          <Plug className="w-3.5 h-3.5 text-amber-400" />
          <span>{battery.powerSource}</span>
        </div>
      </div>

      {/* Main Tablet Battery & Keyboard Dock Battery Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        
        {/* Battery 1: Tablet Main */}
        <div className={`p-3.5 rounded-xl border transition-all ${
          mainLow 
            ? isNight ? 'border-red-600 bg-red-950/80 text-red-400 animate-pulse' : 'border-red-500/80 bg-red-950/40 text-red-200'
            : isNight ? 'border-red-900 bg-red-950/20' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-zinc-800 bg-zinc-800/50'
        }`}>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-bold flex items-center gap-1.5 text-zinc-300">
              <Battery className="w-4 h-4 text-amber-400" /> BATT 1 (TABLET MAIN)
            </span>
            <span className={`font-black text-sm ${mainLow ? 'text-red-400' : 'text-emerald-400'}`}>
              {mainPct}%
            </span>
          </div>

          {/* Battery level progress bar */}
          <div className="w-full h-2.5 bg-zinc-950 rounded-full overflow-hidden mb-2 border border-zinc-800">
            <div
              className={`h-full transition-all duration-500 ${
                mainLow
                  ? 'bg-red-500'
                  : mainPct < 50
                  ? 'bg-amber-400'
                  : 'bg-emerald-400'
              }`}
              style={{ width: `${mainPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
            <span>{battery.mainTablet.voltage}V | {battery.mainTablet.tempC}°C</span>
            <span className="text-zinc-300 font-semibold">{battery.mainTablet.timeRemainingMins}m REMAINING</span>
          </div>
        </div>

        {/* Battery 2: Keyboard Dock / External Aux */}
        <div className={`p-3.5 rounded-xl border transition-all ${
          !battery.keyboardDock.attached
            ? isNight ? 'border-red-950 bg-black text-red-900' : 'border-zinc-800 bg-zinc-950/30 text-zinc-500'
            : kbLow
            ? isNight ? 'border-red-600 bg-red-950/80 text-red-400' : 'border-red-500/80 bg-red-950/40 text-red-200'
            : isNight ? 'border-red-900 bg-red-950/20' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-zinc-800 bg-zinc-800/50'
        }`}>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-bold flex items-center gap-1.5 text-zinc-300">
              <BatteryCharging className="w-4 h-4 text-cyan-400" /> BATT 2 (KEYBOARD DOCK)
            </span>
            <span className={`font-black text-sm ${
              !battery.keyboardDock.attached 
                ? 'text-zinc-500' 
                : kbLow ? 'text-red-400' : 'text-emerald-400'
            }`}>
              {battery.keyboardDock.attached ? `${kbPct}%` : 'UNCOUPLED'}
            </span>
          </div>

          {/* Battery level progress bar */}
          <div className="w-full h-2.5 bg-zinc-950 rounded-full overflow-hidden mb-2 border border-zinc-800">
            <div
              className={`h-full transition-all duration-500 ${
                !battery.keyboardDock.attached
                  ? 'bg-zinc-800'
                  : kbLow
                  ? 'bg-red-500'
                  : kbPct < 50
                  ? 'bg-amber-400'
                  : 'bg-emerald-400'
              }`}
              style={{ width: battery.keyboardDock.attached ? `${kbPct}%` : '0%' }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
            {battery.keyboardDock.attached ? (
              <>
                <span>{battery.keyboardDock.voltage}V | HEALTH: {battery.keyboardDock.health}</span>
                <span className="text-zinc-300 font-semibold">{battery.keyboardDock.timeRemainingMins}m REMAINING</span>
              </>
            ) : (
              <span>KEYBOARD DOCK UNCOUPLED</span>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
