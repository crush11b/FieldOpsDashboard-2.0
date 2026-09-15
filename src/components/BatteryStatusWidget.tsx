import React, { useEffect, useState } from 'react';
import { BatteryCharging, Battery, Plug, Zap, AlertTriangle, ShieldCheck, RefreshCw, Sliders, Check } from 'lucide-react';
import { DualBatteryStatus, UIThemeMode } from '../types';
import type { TelemetryEnvelope } from '../telemetry';
import { toFiniteNumber } from '../utils/numbers';
import { getVersionedDownloadFilename } from '../productMetadata';
import type { SystemTelemetry } from '../types';

interface BatteryStatusWidgetProps {
  battery: DualBatteryStatus;
  theme: UIThemeMode;
  onUpdateBattery?: (updated: Partial<DualBatteryStatus>) => void;
  onSystemTelemetry?: (telemetry: SystemTelemetry | null) => void;
}

export const BatteryStatusWidget: React.FC<BatteryStatusWidgetProps> = ({ battery, theme, onUpdateBattery, onSystemTelemetry }) => {
  const [isPolling, setIsPolling] = useState(false);
  const [pollSource, setPollSource] = useState<string>('Initializing Live Auto-Poll...');
  const [showManualCalib, setShowManualCalib] = useState(false);
  const [lastPolledTime, setLastPolledTime] = useState<string>('');

  // Helper to update battery state and broadcast telemetry
  const applyBatteryUpdate = (updated: Partial<DualBatteryStatus>, sourceName?: string, syncTelemetry = false) => {
    if (onUpdateBattery) {
      onUpdateBattery(updated);
    }
    if (sourceName) {
      setPollSource(sourceName);
    }
    setLastPolledTime(new Date().toLocaleTimeString());

    // Only sync telemetry endpoint on explicit user manual calibration
    if (syncTelemetry) {
      const b1 = updated.mainTablet?.percent ?? battery.mainTablet.percent;
      const b2 = updated.keyboardDock?.percent ?? battery.keyboardDock.percent;
      fetch('/api/system/battery/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ b1, b2 }),
      }).catch(() => {});
    }
  };

  // Main automatic hardware poll function
  const fetchHardwareBattery = async () => {
    setIsPolling(true);

    // Native Agent telemetry is authoritative in production. Browser battery
    // data is intentionally not used as a silent fallback.
    try {
      const response = await fetch('/api/system');
      const system = await response.json() as SystemTelemetry;
      onSystemTelemetry?.(system);
      if (system.status === 'Available') {
        const physical = system.physicalBatteryStatus === 'Available' ? (system.physicalBatteries ?? []).filter(b => b.present !== false) : [];
        const main = physical[0];
        const dock = physical[1];
        onUpdateBattery?.({
          powerSource: system.powerSource === 'AC' ? 'AC External' : system.powerSource === 'Battery' ? 'Battery' : 'Unknown',
          mainTablet: { ...battery.mainTablet, percent: main?.percentage ?? null, charging: main?.charging ?? null, timeRemainingMins: null },
          keyboardDock: { ...battery.keyboardDock, percent: dock?.percentage ?? null, charging: dock?.charging ?? null, attached: dock !== undefined, timeRemainingMins: null },
        });
        setPollSource('Windows Agent'); setLastPolledTime(new Date().toLocaleTimeString());
      } else {
        onUpdateBattery?.({ powerSource: 'Unknown', mainTablet: { ...battery.mainTablet, percent: null, charging: null, timeRemainingMins: null }, keyboardDock: { ...battery.keyboardDock, percent: null, charging: null, attached: false, timeRemainingMins: null } });
        setPollSource('Windows telemetry unavailable');
      }
    } catch {
      onSystemTelemetry?.(null);
      onUpdateBattery?.({ powerSource: 'Unknown', mainTablet: { ...battery.mainTablet, percent: null, charging: null, timeRemainingMins: null }, keyboardDock: { ...battery.keyboardDock, percent: null, charging: null, attached: false, timeRemainingMins: null } });
      setPollSource('Windows telemetry unavailable');
    }
    setIsPolling(false);
    return;

    // 1. Primary Priority: Query Backend Telemetry / WMI API for Dual-Battery details
    try {
      const res = await fetch('/api/telemetry/battery');
      if (res.ok) {
        const envelope = await res.json() as TelemetryEnvelope<DualBatteryStatus>;
        const data = envelope.data;
        const source = envelope.source.type;
        if (data?.mainTablet?.percent !== undefined) {
          const isLiveTelemetry = envelope.status === 'ok' && (source === 'local_telemetry_agent' || source === 'win32_wmi' || source === 'sysfs' || source === 'linux_sysfs');
          
          if (onUpdateBattery) {
            const isAttached = data.keyboardDock?.attached ?? battery.keyboardDock.attached ?? true;
            const kbPct = data.keyboardDock?.percent !== undefined ? data.keyboardDock.percent : battery.keyboardDock.percent;
            onUpdateBattery({
              powerSource: data.powerSource || (data.mainTablet?.charging ? 'AC External' : 'Battery'),
              mainTablet: {
                ...battery.mainTablet,
                ...data.mainTablet,
              },
              keyboardDock: {
                ...battery.keyboardDock,
                ...data.keyboardDock,
                attached: isAttached,
                percent: isAttached ? kbPct : 0,
              },
            });
          }

          setPollSource(
            isLiveTelemetry
              ? `Live Sync (${source === 'local_telemetry_agent' ? 'ToughBook Agent' : source})`
              : `Active Poll (${source || 'Server'})`
          );
          setLastPolledTime(new Date().toLocaleTimeString());
          setIsPolling(false);
          
          // IF WE GOT REAL TELEMETRY OR WMI, STOP HERE! Do not let browser getBattery override it!
          if (isLiveTelemetry) {
            return;
          }
        }
      }
    } catch (e) {
      // Backend query error
    }

    // 2. Secondary Fallback: Query Browser OS Battery Driver if backend telemetry is not active
    if (typeof navigator !== 'undefined' && (navigator as any).getBattery) {
      try {
        const batt = await (navigator as any).getBattery();
        const pct = Math.round(batt.level * 100);
        const charging = batt.charging;
        const disTime = batt.dischargingTime !== Infinity && !isNaN(batt.dischargingTime)
          ? Math.round(batt.dischargingTime / 60)
          : Math.round(pct * 3.5);

        if (onUpdateBattery) {
          onUpdateBattery({
              powerSource: charging ? 'AC External' : 'Battery',
            mainTablet: {
              ...battery.mainTablet,
              percent: pct,
              charging,
              timeRemainingMins: disTime,
            },
            keyboardDock: {
              ...battery.keyboardDock,
            },
          });
        }
        setPollSource(`OS Battery Driver (Live ${pct}%)`);
        setLastPolledTime(new Date().toLocaleTimeString());
      } catch (err) {
        // Driver API query skipped
      }
    }

    setIsPolling(false);
  };

  useEffect(() => {
    // Initial immediate poll on mount
    fetchHardwareBattery();

    // Continuous Auto-Polling Interval (every 5 seconds)
    const interval = setInterval(() => {
      fetchHardwareBattery();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const mainPct = battery.mainTablet.percent;
  const kbPct = battery.keyboardDock.percent;
  const mainLow = mainPct !== null && mainPct <= 20;
  const kbLow = battery.keyboardDock.attached === true && kbPct !== null && kbPct <= 20;
  const pollingUnavailable = pollSource.toLowerCase().includes('unavailable');

  return (
    <div data-theme={theme} className="fo-surface border rounded-2xl p-4 sm:p-5 font-mono transition-all space-y-3">
      {/* Widget Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[var(--fo-border-subtle)]">
        <div className="flex items-center gap-2">
          <Zap className="fo-icon-caution w-4 h-4" />
          <h3 className="fo-text-secondary text-xs font-bold uppercase tracking-widest">
            DUAL-BATTERY SYSTEM (CF-20 / FZ-G1)
          </h3>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchHardwareBattery()}
            disabled={isPolling}
            title="Poll Real-Time OS & WMI Hardware Battery Data"
            className="fo-control min-h-11 flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-md border transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isPolling ? 'animate-spin motion-reduce:animate-none fo-text-caution' : ''}`} />
            <span>{isPolling ? 'POLLING...' : 'POLL HARDWARE'}</span>
          </button>

          <button
            onClick={() => setShowManualCalib(!showManualCalib)}
            title="Test Presets & Simulator Tools"
            className={`min-h-11 p-1 px-2 rounded-md border text-[10px] font-bold flex items-center gap-1 transition-colors ${showManualCalib ? 'fo-status-caution' : 'fo-control'}`}
            aria-expanded={showManualCalib}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">TESTING TOOLS</span>
          </button>

          <div className="fo-badge flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg border">
            <Plug className="fo-icon-neutral w-3.5 h-3.5" />
            <span>{battery.powerSource}</span>
          </div>
        </div>
      </div>

      {/* Field Testing & Calibration Drawer */}
      {showManualCalib && (
        <div className="fo-surface-subtle p-3.5 rounded-xl border space-y-3.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="fo-text-caution font-extrabold uppercase text-[11px] flex items-center gap-1.5">
              🛠️ FIELD TEST SIMULATOR & POWERSHELL WMI SYNC
            </span>
            <span className="fo-status-info text-[10px] px-2 py-0.5 rounded border font-bold">
              AUTO-POLLING ACTIVE
            </span>
          </div>

          {/* PowerShell CSV Parser Section */}
          <div className="fo-surface-raised p-3 rounded-lg border space-y-2">
            <div className="fo-text-secondary flex items-center justify-between font-bold text-[11px]">
              <span>📋 PASTE POWERSHELL / WMI CSV OUTPUT:</span>
              <span className="fo-text-muted text-[10px] font-normal">Matches Electron Get-CimInstance Win32_Battery</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder='e.g. "Tablet","100"  or  "Keyboard","94"'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const raw = (e.currentTarget as HTMLInputElement).value;
                    const re = /^"([^\"]+)","?(\d+)"?$/;
                    let b1Val: number | null = null;
                    let b2Val: number | null = null;
                    raw.split(/\r?\n|;/).forEach(l => {
                      const m = l.trim().match(re);
                      if (m) {
                        const val = parseInt(m[2], 10);
                        if (b1Val === null) b1Val = val;
                        else if (b2Val === null) b2Val = val;
                      }
                    });
                    if (b1Val !== null) {
                      applyBatteryUpdate({
                        mainTablet: { ...battery.mainTablet, percent: b1Val, timeRemainingMins: Math.round(b1Val * 3.5) },
                        keyboardDock: { ...battery.keyboardDock, percent: b2Val ?? battery.keyboardDock.percent, timeRemainingMins: Math.round((b2Val ?? battery.keyboardDock.percent) * 4.2) }
                      }, `Parsed WMI CSV (${b1Val}% / ${b2Val ?? 'N/A'}%)`);
                    }
                  }
                }}
                onChange={(e) => {
                  const raw = e.target.value;
                  const re = /^"([^\"]+)","?(\d+)"?$/;
                  let b1Val: number | null = null;
                  let b2Val: number | null = null;
                  raw.split(/\r?\n|;/).forEach(l => {
                    const m = l.trim().match(re);
                    if (m) {
                      const val = parseInt(m[2], 10);
                      if (b1Val === null) b1Val = val;
                      else if (b2Val === null) b2Val = val;
                    }
                  });
                  if (b1Val !== null) {
                    applyBatteryUpdate({
                      mainTablet: { ...battery.mainTablet, percent: b1Val, timeRemainingMins: Math.round(b1Val * 3.5) },
                      keyboardDock: { ...battery.keyboardDock, percent: b2Val ?? battery.keyboardDock.percent, timeRemainingMins: Math.round((b2Val ?? battery.keyboardDock.percent) * 4.2) }
                    }, `Parsed WMI CSV (${b1Val}% / ${b2Val ?? 'N/A'}%)`);
                  }
                }}
                className="fo-input flex-1 min-h-11 px-2.5 py-1.5 border rounded text-xs font-mono"
              />
            </div>
            <p className="fo-text-muted text-[10px] leading-normal">
              Paste the string from PowerShell: <code className="fo-text-caution font-mono">(Get-CimInstance Win32_Battery) | Select Name,EstimatedChargeRemaining | ConvertTo-Csv -NoTypeInformation</code>
            </p>
          </div>

          <p className="fo-text-secondary text-[11px] leading-relaxed">
            Quickly test threshold alerts or custom configurations. Note: Live automatic polling continues every 10 seconds.
          </p>

          {/* Quick Presets Row */}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => applyBatteryUpdate({
                mainTablet: { ...battery.mainTablet, percent: 100, timeRemainingMins: 350 },
                keyboardDock: { ...battery.keyboardDock, percent: 94, attached: true, timeRemainingMins: 420 },
              }, 'Preset (100% / 94%)')}
              className="fo-control min-h-11 px-2.5 py-1 border rounded text-[11px] font-bold transition-colors"
            >
              ⚡ 100% Main / 94% Dock
            </button>

            <button
              type="button"
              onClick={() => applyBatteryUpdate({
                mainTablet: { ...battery.mainTablet, percent: 100, timeRemainingMins: 350 },
                keyboardDock: { ...battery.keyboardDock, percent: 100, attached: true, timeRemainingMins: 450 },
              }, 'Preset (100% / 100%)')}
              className="fo-control min-h-11 px-2.5 py-1 border rounded text-[11px] font-bold transition-colors"
            >
              🔋 100% / 100% Full
            </button>

            <button
              type="button"
              onClick={() => applyBatteryUpdate({
                mainTablet: { ...battery.mainTablet, percent: 20, timeRemainingMins: 70 },
                keyboardDock: { ...battery.keyboardDock, percent: 15, attached: true, timeRemainingMins: 60 },
              }, 'Preset (Low Battery Alert Test)')}
              className="fo-control fo-text-danger min-h-11 px-2.5 py-1 border rounded text-[11px] font-bold transition-colors"
            >
              🪫 20% / 15% Low Alert Test
            </button>

            <button
              type="button"
              onClick={() => applyBatteryUpdate({
                mainTablet: { ...battery.mainTablet, percent: 100, timeRemainingMins: 350 },
                keyboardDock: { ...battery.keyboardDock, percent: 0, attached: false, timeRemainingMins: 0 },
              }, 'Preset (Tablet Only Mode)')}
              className="fo-control min-h-11 px-2.5 py-1 border rounded text-[11px] font-bold transition-colors"
            >
              💻 Tablet Only Mode
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
            <div className="fo-surface-raised p-2.5 rounded-lg border space-y-2">
              <div className="flex items-center justify-between">
                <label className="fo-text-secondary text-[11px] font-bold">
                  BATT 1 (MAIN TABLET %):
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={mainPct ?? ''}
                  onChange={(e) => {
                    const parsed = toFiniteNumber(e.target.value);
                    if (parsed === null) return;
                    const val = Math.min(100, Math.max(0, parsed));
                    applyBatteryUpdate({
                      mainTablet: {
                        ...battery.mainTablet,
                        percent: val,
                        timeRemainingMins: Math.round(val * 3.5),
                      },
                    }, `Simulated Input (${val}%)`);
                  }}
                  className="fo-input w-16 min-h-11 px-2 py-1 border rounded font-black text-xs text-center"
                />
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={mainPct ?? 0}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  applyBatteryUpdate({
                    mainTablet: {
                      ...battery.mainTablet,
                      percent: val,
                      timeRemainingMins: Math.round(val * 3.5),
                    },
                  }, `Simulated Slider (${val}%)`);
                }}
                className="w-full accent-[var(--fo-action-primary)] cursor-pointer"
              />
            </div>

            <div className="fo-surface-raised p-2.5 rounded-lg border space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="fo-text-secondary text-[11px] font-bold">
                    BATT 2 (KEYBOARD DOCK %):
                  </label>
                  <label className="fo-text-muted flex items-center gap-1 text-[10px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={battery.keyboardDock.attached}
                      onChange={(e) => {
                        applyBatteryUpdate({
                          keyboardDock: {
                            ...battery.keyboardDock,
                            attached: e.target.checked,
                          },
                        }, e.target.checked ? 'Dock Attached' : 'Dock Uncoupled');
                      }}
                      className="accent-[var(--fo-action-primary)] rounded"
                    />
                    <span>ATTACHED</span>
                  </label>
                </div>
                <input
                  type="number"
                  min="0"
                  max="100"
                  disabled={!battery.keyboardDock.attached}
                  value={kbPct ?? ''}
                  onChange={(e) => {
                    const parsed = toFiniteNumber(e.target.value);
                    if (parsed === null) return;
                    const val = Math.min(100, Math.max(0, parsed));
                    applyBatteryUpdate({
                      keyboardDock: {
                        ...battery.keyboardDock,
                        percent: val,
                        timeRemainingMins: Math.round(val * 4.2),
                      },
                    }, `Simulated Input Dock (${val}%)`);
                  }}
                  className="fo-input w-16 min-h-11 px-2 py-1 border rounded font-black text-xs text-center disabled:opacity-30"
                />
              </div>
              <input
                type="range"
                min="0"
                max="100"
                disabled={!battery.keyboardDock.attached}
                value={kbPct ?? 0}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  applyBatteryUpdate({
                    keyboardDock: {
                      ...battery.keyboardDock,
                      percent: val,
                      timeRemainingMins: Math.round(val * 4.2),
                    },
                  }, `Simulated Slider Dock (${val}%)`);
                }}
                className="w-full accent-[var(--fo-action-primary)] cursor-pointer disabled:opacity-30"
              />
            </div>
          </div>

          <div className="fo-surface-raised p-3 rounded-lg border space-y-3">
            <div className="fo-text-info flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
              <span>⚡ LOCAL TOUGHBOOK AUTOMATIC DUAL-BATTERY WMI SYNC SCRIPT</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
                    const url = `${origin}/api/system/battery/telemetry`;
                    const cmd = `powershell -NoExit -ExecutionPolicy Bypass -Command "$u='${url}'; while($true){ try { $b=@(Get-CimInstance Win32_Battery); $p1=if($b.Count -gt 0 -and $b[0].EstimatedChargeRemaining){[int]$b[0].EstimatedChargeRemaining}else{100}; $p2=if($b.Count -gt 1 -and $b[1].EstimatedChargeRemaining){[int]$b[1].EstimatedChargeRemaining}else{$null}; $payload=@{b1=$p1}; if($p2 -ne $null){$payload['b2']=$p2}; Invoke-RestMethod -Uri $u -Method POST -Body ($payload|ConvertTo-Json) -ContentType 'application/json' -UseBasicParsing; Write-Host ('['+(Get-Date -Format 'HH:mm:ss')+'] Synced Main:'+$p1+'% Dock:'+(if($p2){$p2}else{'N/A'})+'%') -ForegroundColor Green } catch { Write-Host ('['+(Get-Date -Format 'HH:mm:ss')+'] Notice: '+$_.Exception.Message) -ForegroundColor Yellow }; Start-Sleep 5 }"`;
                    navigator.clipboard.writeText(cmd);
                    alert('PowerShell Battery Sync Command copied! Paste into PowerShell on your ToughBook and press Enter.');
                  }}
                  className="fo-control min-h-11 px-2.5 py-1 border rounded transition-colors font-sans flex items-center gap-1"
                >
                  📋 Copy Battery Sync Command
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
                    const url = `${origin}/api/system/battery/telemetry`;
                    const rawScript = `# ToughBook Dual Battery Live Telemetry Sync Utility
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

$u = '${url}'
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host " ToughBook Dual Battery Telemetry Sync Active " -ForegroundColor Cyan
Write-Host " Endpoint: $u " -ForegroundColor Gray
Write-Host "=======================================================" -ForegroundColor Cyan

while ($true) {
    try {
        $b = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue)
        $p1 = 100
        $p2 = $null
        if ($b.Count -gt 0 -and $b[0].EstimatedChargeRemaining -ne $null) {
            $p1 = [int]$b[0].EstimatedChargeRemaining
        }
        if ($b.Count -gt 1 -and $b[1].EstimatedChargeRemaining -ne $null) {
            $p2 = [int]$b[1].EstimatedChargeRemaining
        }
        
        $payload = @{
            b1 = $p1
            mainTabletPercent = $p1
        }
        if ($p2 -ne $null) {
            $payload['b2'] = $p2
            $payload['keyboardDockPercent'] = $p2
        }
        
        $json = $payload | ConvertTo-Json -Compress
        $res = Invoke-RestMethod -Uri $u -Method POST -Body $json -ContentType 'application/json' -UseBasicParsing -TimeoutSec 5
        
        $timeStr = Get-Date -Format 'HH:mm:ss'
        $b2Str = if ($p2 -ne $null) { "$p2%" } else { 'N/A' }
        Write-Host "[$timeStr] Synced Main Tablet: $p1% | Keyboard Dock: $b2Str" -ForegroundColor Green
    } catch {
        $timeStr = Get-Date -Format 'HH:mm:ss'
        Write-Host "[$timeStr] Sync Notice: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    Start-Sleep -Seconds 5
}
`;
                    const blob = new Blob([rawScript], { type: 'text/plain' });
                    const downloadUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = downloadUrl;
                    a.download = 'sync_toughbook_battery.ps1';
                    a.click();
                    URL.revokeObjectURL(downloadUrl);
                  }}
                  className="fo-control min-h-11 px-2.5 py-1 border rounded transition-colors font-sans flex items-center gap-1"
                >
                  💾 Download sync_toughbook_battery.ps1
                </button>
              </div>
            </div>

            <p className="fo-input text-[10px] font-mono overflow-x-auto whitespace-pre-wrap p-2 rounded border leading-relaxed select-all">
              powershell -ExecutionPolicy Bypass -File .\sync_toughbook_battery.ps1
            </p>

            {/* Dashboard Updater Section */}
            <div className="pt-2 border-t border-[var(--fo-border-subtle)] flex flex-wrap items-center justify-between gap-2">
              <span className="fo-text-secondary text-[10px] font-bold">🚀 DASHBOARD AUTO-UPDATER:</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText('powershell -NoProfile -ExecutionPolicy Bypass -File .\\UpdateDashboard.ps1');
                    alert('Command copied! In PowerShell inside C:\\FieldOpsDashboard, run: powershell -NoProfile -ExecutionPolicy Bypass -File .\\UpdateDashboard.ps1');
                  }}
                  className="fo-control min-h-11 px-2.5 py-1 border rounded transition-colors font-sans text-[10px]"
                >
                  📋 Copy Updater Command
                </button>

                <a
                  href="/api/download-project-zip"
                  download={getVersionedDownloadFilename()}
                  className="fo-control min-h-11 px-2.5 py-1 border rounded transition-colors font-sans text-[10px] flex items-center gap-1"
                >
                  📦 Download Complete Project Zip
                </a>
              </div>
            </div>
            <p className="fo-text-muted text-[10px] leading-normal">
              <strong>Updating on ToughBook:</strong> Double-click <code className="fo-text-primary">UpdateDashboard.bat</code> or run <code className="fo-text-primary">.\UpdateDashboard.ps1</code> in PowerShell. It safely stops active Node processes, downloads the latest code from this server, overwrites files in <code className="fo-text-primary">C:\FieldOpsDashboard</code>, and relaunches automatically.
            </p>
          </div>
        </div>
      )}

      {/* Main Tablet Battery & Keyboard Dock Battery Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        
        {/* Battery 1: Tablet Main */}
        <div className={`p-3.5 rounded-xl border transition-all ${mainLow ? 'fo-status-danger animate-pulse motion-reduce:animate-none' : 'fo-surface-subtle'}`}>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="fo-text-secondary font-bold flex items-center gap-1.5">
              <Battery className="fo-icon-neutral w-4 h-4" /> BATT 1 (TABLET MAIN)
            </span>
            <span className={`font-black text-sm ${mainLow ? 'fo-text-danger' : mainPct === null ? 'fo-text-muted' : 'fo-text-primary'}`}>
              {mainPct === null ? 'UNAVAILABLE' : `${mainPct}%`}
            </span>
          </div>

          {/* Battery level progress bar */}
          <div className="fo-meter-track w-full h-2.5 rounded-full overflow-hidden mb-2 border" role="progressbar" aria-label="Main tablet battery" aria-valuemin={0} aria-valuemax={100} aria-valuenow={mainPct ?? undefined} aria-valuetext={mainPct === null ? 'Unavailable' : `${mainPct}%`}>
            <div
              className={`h-full transition-all duration-500 ${
                mainLow
                  ? 'fo-meter-danger'
                  : mainPct === null
                  ? 'fo-meter-unknown'
                  : mainPct < 50
                  ? 'fo-meter-caution'
                  : 'fo-meter-success'
              }`}
              style={{ width: mainPct === null ? '0%' : `${mainPct}%` }}
            />
          </div>

          <div className="fo-text-muted flex items-center justify-between text-[10px] font-mono">
            <span>{battery.mainTablet.voltage}V | {battery.mainTablet.tempC}°C</span>
            <span className="fo-text-secondary font-semibold">{battery.mainTablet.timeRemainingMins === null ? 'UNKNOWN' : `${battery.mainTablet.timeRemainingMins}m REMAINING`}</span>
          </div>
        </div>

        {/* Battery 2: Keyboard Dock / External Aux */}
        <div className={`p-3.5 rounded-xl border transition-all ${!battery.keyboardDock.attached ? 'fo-status-neutral' : kbLow ? 'fo-status-danger' : 'fo-surface-subtle'}`}>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="fo-text-secondary font-bold flex items-center gap-1.5">
              <BatteryCharging className="fo-icon-neutral w-4 h-4" /> BATT 2 (KEYBOARD DOCK)
            </span>
            <span className={`font-black text-sm ${
              !battery.keyboardDock.attached
                ? 'fo-text-muted font-mono text-xs'
                : kbLow ? 'fo-text-danger' : kbPct === null ? 'fo-text-muted' : 'fo-text-primary'
            }`}>
              {!battery.keyboardDock.attached ? 'UNCOUPLED' : kbPct === null ? 'UNAVAILABLE' : `${kbPct}%`}
            </span>
          </div>

          {/* Battery level progress bar */}
          <div className="fo-meter-track w-full h-2.5 rounded-full overflow-hidden mb-2 border" role="progressbar" aria-label="Keyboard dock battery" aria-valuemin={0} aria-valuemax={100} aria-valuenow={battery.keyboardDock.attached ? kbPct ?? undefined : undefined} aria-valuetext={!battery.keyboardDock.attached ? 'Uncoupled' : kbPct === null ? 'Unavailable' : `${kbPct}%`}>
            <div
              className={`h-full transition-all duration-500 ${
                !battery.keyboardDock.attached
                  ? 'fo-meter-unknown'
                  : kbLow
                  ? 'fo-meter-danger'
                  : kbPct === null
                  ? 'fo-meter-unknown'
                  : kbPct < 50
                  ? 'fo-meter-caution'
                  : 'fo-meter-success'
              }`}
              style={{ width: battery.keyboardDock.attached && kbPct !== null ? `${kbPct}%` : '0%' }}
            />
          </div>

          <div className="fo-text-muted flex items-center justify-between text-[10px] font-mono">
            {battery.keyboardDock.attached ? (
              <>
                <span>{battery.keyboardDock.voltage}V | HEALTH: {battery.keyboardDock.health}</span>
                <span className="fo-text-secondary font-semibold">{battery.keyboardDock.timeRemainingMins}m REMAINING</span>
              </>
            ) : (
              <div className="w-full flex items-center justify-between">
                <span>DOCK DISCONNECTED</span>
                <button
                  type="button"
                  disabled
                  aria-label="Dock coupling unavailable; hardware detection is required"
                  className="fo-control min-h-11 px-2 py-0.5 rounded border font-bold text-[9px] cursor-not-allowed opacity-70"
                >
                  HARDWARE DETECTION REQUIRED
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Hardware Polling Source Footer Status */}
      <div className="fo-text-muted pt-1.5 flex flex-wrap items-center justify-between text-[10px] border-t border-[var(--fo-border-subtle)] font-mono">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${pollingUnavailable ? 'fo-meter-unknown' : 'fo-meter-success animate-ping motion-reduce:animate-none'}`} aria-hidden="true"></span>
          <span className="fo-text-secondary font-bold">LINK:</span>
          <span className={pollingUnavailable ? 'fo-text-muted' : 'fo-text-info'}>{pollSource}</span>
        </div>
        {lastPolledTime && (
          <span className="fo-text-muted">LAST POLLED: {lastPolledTime}</span>
        )}
      </div>
    </div>
  );
};
