import React, { useEffect, useState } from 'react';
import { BatteryCharging, Battery, Plug, Zap, AlertTriangle, ShieldCheck, RefreshCw, Sliders, Check } from 'lucide-react';
import { DualBatteryStatus, UIThemeMode } from '../types';

interface BatteryStatusWidgetProps {
  battery: DualBatteryStatus;
  theme: UIThemeMode;
  onUpdateBattery?: (updated: Partial<DualBatteryStatus>) => void;
}

export const BatteryStatusWidget: React.FC<BatteryStatusWidgetProps> = ({ battery, theme, onUpdateBattery }) => {
  const isNight = theme === 'night_vision';
  const isSunlight = theme === 'sunlight';

  const [isPolling, setIsPolling] = useState(false);
  const [pollSource, setPollSource] = useState<string>('Initializing...');
  const [showManualCalib, setShowManualCalib] = useState(false);
  const [lastPolledTime, setLastPolledTime] = useState<string>('');

  const fetchHardwareBattery = async () => {
    setIsPolling(true);
    let updated = false;

    // 1. Try backend API /api/system/battery (queries WMI Win32_Battery on Windows / Linux sysfs)
    try {
      const res = await fetch('/api/system/battery');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.source && !data.source.includes('fallback')) {
          if (onUpdateBattery) {
            onUpdateBattery({
              powerSource: data.powerSource || 'Internal Battery',
              mainTablet: {
                ...battery.mainTablet,
                ...data.mainTablet,
              },
              keyboardDock: {
                ...battery.keyboardDock,
                ...data.keyboardDock,
              },
            });
          }
          setPollSource(`WMI / ${data.source === 'win32_wmi' ? 'Win32_Battery' : 'sysfs'}`);
          setLastPolledTime(new Date().toLocaleTimeString());
          updated = true;
        }
      }
    } catch (e) {
      // API call failed or offline
    }

    // 2. If backend didn't return direct WMI, query browser navigator.getBattery API
    if (!updated && typeof navigator !== 'undefined' && (navigator as any).getBattery) {
      try {
        const batt = await (navigator as any).getBattery();
        const pct = Math.round(batt.level * 100);
        const charging = batt.charging;
        const disTime = batt.dischargingTime !== Infinity ? Math.round(batt.dischargingTime / 60) : 240;

        if (onUpdateBattery) {
          onUpdateBattery({
            powerSource: charging ? 'AC External / Charger' : 'Internal Li-Ion Battery',
            mainTablet: {
              ...battery.mainTablet,
              percent: pct,
              charging,
              timeRemainingMins: disTime,
            },
          });
        }
        setPollSource(`Browser Navigator Battery API (${pct}%)`);
        setLastPolledTime(new Date().toLocaleTimeString());
        updated = true;
      } catch (err) {
        // navigator.getBattery failed
      }
    }

    if (!updated) {
      setPollSource('Virtual Field Simulation');
      setLastPolledTime(new Date().toLocaleTimeString());
    }

    setIsPolling(false);
  };

  useEffect(() => {
    fetchHardwareBattery();

    // Hook into Browser Battery API level/charging change events
    if (typeof navigator !== 'undefined' && (navigator as any).getBattery) {
      (navigator as any).getBattery().then((batt: any) => {
        const updateOnEvent = () => {
          const pct = Math.round(batt.level * 100);
          const charging = batt.charging;
          if (onUpdateBattery) {
            onUpdateBattery({
              powerSource: charging ? 'AC External / Charger' : 'Internal Li-Ion Battery',
              mainTablet: {
                ...battery.mainTablet,
                percent: pct,
                charging,
              },
            });
          }
          setPollSource(`OS Battery Driver (${pct}%)`);
          setLastPolledTime(new Date().toLocaleTimeString());
        };
        batt.addEventListener('levelchange', updateOnEvent);
        batt.addEventListener('chargingchange', updateOnEvent);
      }).catch(() => {});
    }

    // Poll every 30 seconds
    const interval = setInterval(() => {
      fetchHardwareBattery();
    }, 30000);

    return () => clearInterval(interval);
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
        
        <div className="flex items-center gap-2">
          <button
            onClick={fetchHardwareBattery}
            disabled={isPolling}
            title="Poll OS & WMI Hardware Battery Data"
            className="flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-cyan-300 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${isPolling ? 'animate-spin text-amber-400' : ''}`} />
            <span>{isPolling ? 'POLLING...' : 'POLL HARDWARE'}</span>
          </button>

          <button
            onClick={() => setShowManualCalib(!showManualCalib)}
            title="Manual Calibration & Percent Override"
            className={`p-1 rounded-md border text-[10px] font-bold transition-colors ${
              showManualCalib 
                ? 'bg-amber-500/20 border-amber-500 text-amber-300' 
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-zinc-800/80 border border-zinc-700/60 text-zinc-300">
            <Plug className="w-3.5 h-3.5 text-amber-400" />
            <span>{battery.powerSource}</span>
          </div>
        </div>
      </div>

      {/* Manual Calibration & Direct Input Bar */}
      {showManualCalib && (
        <div className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-950/30 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-extrabold text-amber-400 uppercase text-[11px] flex items-center gap-1.5">
              🛠️ EXACT BATTERY LEVEL INPUT & TOUGHBOOK SYNC
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">
              DIRECT OVERRIDE
            </span>
          </div>

          <p className="text-[11px] text-zinc-300 leading-relaxed">
            <strong className="text-amber-300">Note:</strong> Because this web app is hosted on a Cloud container server, the server defaults to simulated 88%/94% values unless synced. Enter your exact ToughBook battery percentages below to update the dashboard instantly:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
            <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-700 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-amber-300">
                  BATT 1 (MAIN TABLET %):
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={mainPct}
                  onChange={(e) => {
                    const val = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                    if (onUpdateBattery) {
                      onUpdateBattery({
                        mainTablet: {
                          ...battery.mainTablet,
                          percent: val,
                          timeRemainingMins: Math.round(val * 3.5),
                        },
                      });
                    }
                    // Sync to backend telemetry
                    fetch('/api/system/battery/telemetry', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ b1: val, b2: kbPct }),
                    }).catch(() => {});
                  }}
                  className="w-16 px-2 py-1 bg-black border border-amber-500/50 rounded font-black text-xs text-amber-300 text-center"
                />
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={mainPct}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (onUpdateBattery) {
                    onUpdateBattery({
                      mainTablet: {
                        ...battery.mainTablet,
                        percent: val,
                        timeRemainingMins: Math.round(val * 3.5),
                      },
                    });
                  }
                  fetch('/api/system/battery/telemetry', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ b1: val, b2: kbPct }),
                  }).catch(() => {});
                }}
                className="w-full accent-amber-400 cursor-pointer"
              />
            </div>

            <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-700 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold text-cyan-300">
                    BATT 2 (KEYBOARD DOCK %):
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={battery.keyboardDock.attached}
                      onChange={(e) => {
                        if (onUpdateBattery) {
                          onUpdateBattery({
                            keyboardDock: {
                              ...battery.keyboardDock,
                              attached: e.target.checked,
                            },
                          });
                        }
                      }}
                      className="accent-cyan-400 rounded"
                    />
                    <span>ATTACHED</span>
                  </label>
                </div>
                <input
                  type="number"
                  min="0"
                  max="100"
                  disabled={!battery.keyboardDock.attached}
                  value={kbPct}
                  onChange={(e) => {
                    const val = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                    if (onUpdateBattery) {
                      onUpdateBattery({
                        keyboardDock: {
                          ...battery.keyboardDock,
                          percent: val,
                          timeRemainingMins: Math.round(val * 4.2),
                        },
                      });
                    }
                    fetch('/api/system/battery/telemetry', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ b1: mainPct, b2: val }),
                    }).catch(() => {});
                  }}
                  className="w-16 px-2 py-1 bg-black border border-cyan-500/50 rounded font-black text-xs text-cyan-300 text-center disabled:opacity-30"
                />
              </div>
              <input
                type="range"
                min="0"
                max="100"
                disabled={!battery.keyboardDock.attached}
                value={kbPct}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (onUpdateBattery) {
                    onUpdateBattery({
                      keyboardDock: {
                        ...battery.keyboardDock,
                        percent: val,
                        timeRemainingMins: Math.round(val * 4.2),
                      },
                    });
                  }
                  fetch('/api/system/battery/telemetry', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ b1: mainPct, b2: val }),
                  }).catch(() => {});
                }}
                className="w-full accent-cyan-400 cursor-pointer disabled:opacity-30"
              />
            </div>
          </div>

          <div className="p-2 bg-zinc-950 rounded border border-zinc-800 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-cyan-300 font-bold">
              <span>⚡ LOCAL TOUGHBOOK AUTOMATIC DUAL-BATTERY WMI SYNC SCRIPT</span>
              <button
                onClick={() => {
                  const cmd = `powershell -NoProfile -Command "$u='${window.location.origin}/api/system/battery/telemetry'; while(1){ $b=Get-CimInstance Win32_Battery; $p1=$b[0].EstimatedChargeRemaining; $p2=if($b[1]){$b[1].EstimatedChargeRemaining}else{94}; Invoke-RestMethod -Uri $u -Method POST -Body (@{b1=$p1;b2=$p2}|ConvertTo-Json) -ContentType 'application/json'; Start-Sleep 10 }"`;
                  navigator.clipboard.writeText(cmd);
                  alert('PowerShell Live Sync Command copied to clipboard! Open PowerShell on your ToughBook and paste to continuously stream real dual battery status.');
                }}
                className="px-2 py-0.5 bg-cyan-900/60 border border-cyan-500/50 rounded text-cyan-200 hover:bg-cyan-800 transition-colors"
              >
                📋 Copy PowerShell Sync Command
              </button>
            </div>
            <p className="text-[10px] text-zinc-400 font-mono overflow-x-auto whitespace-nowrap p-1 bg-black rounded border border-zinc-800">
              powershell -Command &quot;while(1) &#123; $b=Get-CimInstance Win32_Battery; ... Invoke-RestMethod ... &#125;&quot;
            </p>
          </div>
        </div>
      )}

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

      {/* Hardware Polling Source Footer Status */}
      <div className="pt-1.5 flex flex-wrap items-center justify-between text-[10px] text-zinc-400 border-t border-zinc-800/60 font-mono">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
          <span className="font-bold text-zinc-300">LINK:</span>
          <span className="text-cyan-300">{pollSource}</span>
        </div>
        {lastPolledTime && (
          <span className="text-zinc-400">LAST POLLED: {lastPolledTime}</span>
        )}
      </div>
    </div>
  );
};
