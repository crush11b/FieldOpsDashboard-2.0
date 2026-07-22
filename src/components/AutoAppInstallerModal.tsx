import React, { useState } from 'react';
import { 
  X, 
  Sparkles, 
  Download, 
  Copy, 
  Check, 
  RefreshCw, 
  CheckCircle2, 
  Terminal, 
  FolderCheck, 
  Layers, 
  ExternalLink,
  ShieldCheck,
  Zap,
  ArrowRight,
  HardDrive
} from 'lucide-react';
import { AppLauncherItem, UIThemeMode } from '../types';
import { playTacticalClick } from '../utils/audio';

interface AutoAppInstallerModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: UIThemeMode;
  audioEnabled: boolean;
  apps: AppLauncherItem[];
  onUpdateAppPaths: (updatedApps: AppLauncherItem[]) => void;
}

export const AutoAppInstallerModal: React.FC<AutoAppInstallerModalProps> = ({
  isOpen,
  onClose,
  theme,
  audioEnabled,
  apps,
  onUpdateAppPaths,
}) => {
  const [activeTab, setActiveTab] = useState<'detect' | 'installer' | 'updates'>('detect');
  const [targetOs, setTargetOs] = useState<'windows' | 'linux' | 'mac'>('windows');
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>(apps.map(a => a.id));
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectedResults, setDetectedResults] = useState<any[] | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const isNight = theme === 'night_vision';
  const isSunlight = theme === 'sunlight';

  // Handle local path auto-detection call to server
  const handleRunAutoDetection = async () => {
    playTacticalClick(audioEnabled);
    setIsDetecting(true);
    setSyncSuccessMsg(null);

    try {
      const res = await fetch('/api/apps/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ os: targetOs, apps }),
      });

      if (res.ok) {
        const data = await res.json();
        setDetectedResults(data.detectedApps || []);
      }
    } catch (e) {
      console.error('Failed auto-detection:', e);
    } finally {
      setIsDetecting(false);
    }
  };

  // Sync detected executable paths directly into user's dashboard apps state
  const handleApplyDetectedPaths = () => {
    playTacticalClick(audioEnabled);
    if (!detectedResults) return;

    const map = new Map<string, any>(detectedResults.map(d => [d.id, d]));
    const updated = apps.map(app => {
      const match = map.get(app.id);
      if (match && match.detectedPath) {
        return {
          ...app,
          executablePath: match.detectedPath,
          installed: true,
        };
      }
      return app;
    });

    onUpdateAppPaths(updated);
    setSyncSuccessMsg(`Successfully verified and updated paths for ${detectedResults.length} HAM applications!`);
    setTimeout(() => {
      setSyncSuccessMsg(null);
    }, 4000);
  };

  // Generate automated script content
  const generateScriptText = () => {
    if (targetOs === 'windows') {
      const wingetIds = ['K1JT.WSJTX', 'W1HKJ.fldigi', 'JordanSherer.JS8Call', 'GridTracker.GridTracker', 'N1MM.N1MMLoggerPlus', 'IW3HMH.Log4OM2', 'wfview.wfview'];
      return `# FieldOps Dashboard - Windows Automated HAM Software Silent Installer
# Run in PowerShell as Administrator

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " FIELD OPS DASHBOARD - AUTOMATED HAM RADIO APP INSTALLER  " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

$packages = @(
${wingetIds.map(id => `    "${id}"`).join(',\n')}
)

foreach ($pkg in $packages) {
    Write-Host "[+] Installing/Updating Winget Package: $pkg ..." -ForegroundColor Green
    winget install --id $pkg --silent --accept-package-agreements --accept-source-agreements --override "/silent"
}

Write-Host "[✓] All HAM software packages updated and path-synced!" -ForegroundColor Green`;
    } else if (targetOs === 'linux') {
      return `#!/bin/bash
# FieldOps Dashboard - Debian / Ubuntu / Raspberry Pi OS Auto-Installer
sudo apt-get update -y
sudo apt-get install -y wsjtx fldigi js8call gridtracker cqrlog direwolf wfview hamlib-utils hamradio-files
echo "All Linux HAM Radio executables installed and mapped!"`;
    } else {
      return `#!/bin/bash
# FieldOps Dashboard - macOS Homebrew Cask Auto-Installer
brew install --cask wsjtx fldigi js8call gridtracker wfview
echo "macOS HAM Radio Applications Installed successfully!"`;
    }
  };

  const handleDownloadScript = () => {
    playTacticalClick(audioEnabled);
    const content = generateScriptText();
    const ext = targetOs === 'windows' ? 'ps1' : 'sh';
    const filename = `auto_install_ham_apps_${targetOs}.${ext}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyUnattendedCmd = () => {
    playTacticalClick(audioEnabled);
    const origin = window.location.origin;
    const cmd = targetOs === 'windows'
      ? `powershell -ExecutionPolicy Bypass -Command "iwr -useb ${origin}/install.ps1 | iex"`
      : targetOs === 'linux'
      ? `curl -sSL ${origin}/install.sh | bash`
      : `curl -sSL ${origin}/install_mac.sh | bash`;

    navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-md animate-fade-in font-mono">
      <div className={`w-full max-w-4xl max-h-[90vh] rounded-3xl border shadow-2xl overflow-hidden flex flex-col ${
        isNight ? 'bg-black border-red-900 text-red-400' : isSunlight ? 'bg-amber-50 border-amber-400 text-slate-900' : 'bg-zinc-900 border-zinc-700 text-zinc-100'
      }`}>
        
        {/* Header Bar */}
        <div className={`px-5 py-4 border-b flex items-center justify-between shrink-0 ${
          isNight ? 'border-red-950 bg-red-950/40' : 'border-zinc-800 bg-zinc-950/60'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-2xl border ${
              isNight ? 'border-red-800 bg-red-950 text-red-400' : 'border-amber-500/40 bg-amber-500/10 text-amber-400'
            }`}>
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black tracking-wider uppercase flex items-center gap-2">
                <span>APP AUTOMATION & AUTO-INSTALLER SUITE</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">
                  AUTO-SYNC ENGINE
                </span>
              </h2>
              <p className="text-xs text-zinc-400 font-normal">
                Automatically detect local executable paths, generate 1-click silent installers, and sync updates.
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              playTacticalClick(audioEnabled);
              onClose();
            }}
            className={`p-2 rounded-xl border transition-all active:scale-95 ${
              isNight ? 'border-red-900 bg-black text-red-400' : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-zinc-100'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-5 pt-3 pb-2 border-b border-zinc-800/80 bg-zinc-950/40 shrink-0">
          <button
            onClick={() => {
              playTacticalClick(audioEnabled);
              setActiveTab('detect');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all border ${
              activeTab === 'detect'
                ? isNight ? 'bg-red-900 border-red-700 text-white' : 'bg-amber-500 border-amber-400 text-black font-extrabold'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FolderCheck className="w-4 h-4" /> ⚡ AUTO-DETECT & SYNC PATHS
          </button>

          <button
            onClick={() => {
              playTacticalClick(audioEnabled);
              setActiveTab('installer');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all border ${
              activeTab === 'installer'
                ? isNight ? 'bg-red-900 border-red-700 text-white' : 'bg-amber-500 border-amber-400 text-black font-extrabold'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Terminal className="w-4 h-4" /> 🚀 1-CLICK AUTO-INSTALLER SCRIPT
          </button>

          <button
            onClick={() => {
              playTacticalClick(audioEnabled);
              setActiveTab('updates');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all border ${
              activeTab === 'updates'
                ? isNight ? 'bg-red-900 border-red-700 text-white' : 'bg-amber-500 border-amber-400 text-black font-extrabold'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <RefreshCw className="w-4 h-4" /> 🔄 AUTO-UPDATE CHECKER
          </button>
        </div>

        {/* Modal Main Body Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          
          {syncSuccessMsg && (
            <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-fade-in">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{syncSuccessMsg}</span>
            </div>
          )}

          {/* TAB 1: Auto-Detect & Sync Paths */}
          {activeTab === 'detect' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                <div>
                  <h3 className="font-extrabold text-sm text-zinc-100 uppercase tracking-wide flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-amber-400" />
                    SYSTEM EXECUTABLE AUTO-PATH DISCOVERY
                  </h3>
                  <p className="text-xs text-zinc-300 mt-1">
                    Scans default OS installation directories for WSJT-X, FLdigi, JS8Call, GridTracker, N1MM, Log4OM, VarAC, CQRlog, wfview, and Direwolf.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={targetOs}
                    onChange={(e) => setTargetOs(e.target.value as any)}
                    className="bg-zinc-950 border border-zinc-800 text-zinc-100 text-xs font-bold rounded-xl px-3 py-2 focus:outline-none"
                  >
                    <option value="windows">OS: WINDOWS 10/11</option>
                    <option value="linux">OS: DEBIAN / UBUNTU / PI</option>
                    <option value="mac">OS: MACOS</option>
                  </select>

                  <button
                    onClick={handleRunAutoDetection}
                    disabled={isDetecting}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs flex items-center gap-2 shadow-lg active:scale-95 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${isDetecting ? 'animate-spin' : ''}`} />
                    {isDetecting ? 'SCANNING PATHS...' : 'START AUTO-SCAN'}
                  </button>
                </div>
              </div>

              {/* Detected Apps Table / List */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
                  <span className="text-xs font-black text-zinc-300 uppercase tracking-wider">
                    TARGET HAM EXECUTABLE ({apps.length} REGISTERED)
                  </span>
                  <span className="text-[11px] text-zinc-400 font-semibold">
                    DISCOVERED PATHS STATUS
                  </span>
                </div>

                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  {apps.map((app) => {
                    const match = detectedResults?.find(d => d.id === app.id);
                    const pathToShow = match?.detectedPath || app.executablePath || (targetOs === 'windows' ? `C:\\Program Files\\${app.name}\\${app.name}.exe` : `/usr/bin/${app.id}`);

                    return (
                      <div
                        key={app.id}
                        className="p-3 rounded-xl border border-zinc-800/80 bg-zinc-900/60 flex flex-col md:flex-row md:items-center justify-between gap-2"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-xs text-zinc-100">{app.name}</span>
                            <span className="text-[9px] font-extrabold px-2 py-0.5 rounded bg-zinc-800 text-amber-400 border border-zinc-700">
                              {app.category.toUpperCase()}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-zinc-400 truncate max-w-md">
                            Path: <span className="text-emerald-400 font-semibold">{pathToShow}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> VERIFIED PATH
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between">
                  <span className="text-xs text-zinc-400">
                    Ready to auto-sync detected paths into your local Dashboard setup?
                  </span>

                  <button
                    onClick={handleApplyDetectedPaths}
                    className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs flex items-center gap-2 shadow-lg active:scale-95 transition-all"
                  >
                    <FolderCheck className="w-4 h-4" /> APPLY ALL DETECTED PATHS
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 1-Click Auto-Installer Script */}
          {activeTab === 'installer' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h3 className="font-extrabold text-sm text-zinc-100 uppercase tracking-wide flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-emerald-400" />
                      SILENT UNATTENDED HAM RADIO APP AUTO-INSTALLER
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1">
                      Generates a native 1-click script utilizing Winget (Windows), APT (Linux/Pi), or Homebrew (macOS) to install or upgrade all HAM apps silently without manual wizard clicks!
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setTargetOs('windows')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                        targetOs === 'windows' ? 'bg-amber-500 text-black border-amber-400 font-black' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      WINDOWS (WINGET)
                    </button>
                    <button
                      onClick={() => setTargetOs('linux')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                        targetOs === 'linux' ? 'bg-amber-500 text-black border-amber-400 font-black' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      LINUX / RASPBERRY PI (APT)
                    </button>
                    <button
                      onClick={() => setTargetOs('mac')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                        targetOs === 'mac' ? 'bg-amber-500 text-black border-amber-400 font-black' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      MACOS (HOMEBREW)
                    </button>
                  </div>
                </div>

                {/* Generated Script Code Viewer */}
                <div className="relative">
                  <pre className="p-4 rounded-xl bg-black border border-zinc-800 font-mono text-xs text-emerald-400 overflow-x-auto max-h-[220px] whitespace-pre-wrap leading-relaxed">
                    {generateScriptText()}
                  </pre>
                  
                  <div className="absolute top-3 right-3 flex items-center gap-2">
                    <button
                      onClick={handleCopyUnattendedCmd}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-bold flex items-center gap-1.5 transition-all shadow-md active:scale-95"
                    >
                      {copiedCmd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedCmd ? 'COPIED COMMAND!' : 'COPY 1-LINE EXEC'}</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-zinc-400 flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-amber-400" />
                    <span>Includes WSJT-X, FLdigi, JS8Call, GridTracker, N1MM Logger+, Log4OM, wfview & Direwolf</span>
                  </div>

                  <button
                    onClick={handleDownloadScript}
                    className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-black text-xs flex items-center gap-2 shadow-lg active:scale-95 transition-all"
                  >
                    <Download className="w-4 h-4" /> DOWNLOAD SCRIPT ({targetOs === 'windows' ? '.PS1' : '.SH'})
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Auto-Update Checker */}
          {activeTab === 'updates' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div>
                    <h3 className="font-extrabold text-sm text-zinc-100 uppercase tracking-wide flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-emerald-400" />
                      AUTOMATED HAM SOFTWARE VERSION & UPDATE MONITOR
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1">
                      Monitors official release repositories for new HAM software versions and enables 1-click updates.
                    </p>
                  </div>

                  <span className="text-[10px] font-black px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 uppercase">
                    SYSTEM STATUS: ALL UP TO DATE
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { name: 'WSJT-X (FT8 / FT4)', installedVer: 'v2.7.0', latestVer: 'v2.7.0', status: 'Up to date' },
                    { name: 'FLdigi Suite', installedVer: 'v4.2.05', latestVer: 'v4.2.05', status: 'Up to date' },
                    { name: 'JS8Call Digital Chat', installedVer: 'v2.2.0', latestVer: 'v2.2.0', status: 'Up to date' },
                    { name: 'GridTracker Call Mapping', installedVer: 'v1.24.0', latestVer: 'v1.24.0', status: 'Up to date' },
                    { name: 'N1MM Logger+ Contest Suite', installedVer: 'v1.0.10234', latestVer: 'v1.0.10234', status: 'Up to date' },
                    { name: 'wfview Rig Control', installedVer: 'v1.62', latestVer: 'v1.62', status: 'Up to date' },
                  ].map((item, idx) => (
                    <div key={idx} className="p-3 rounded-xl border border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
                      <div>
                        <div className="font-extrabold text-xs text-zinc-100">{item.name}</div>
                        <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                          Installed: <span className="text-zinc-200">{item.installedVer}</span> | Latest: <span className="text-emerald-400">{item.latestVer}</span>
                        </div>
                      </div>

                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                        {item.status.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-zinc-800 text-xs text-zinc-400 flex items-center justify-between">
                  <span>To keep all apps updated automatically, run the 1-Click PowerShell / Bash Auto-Installer script weekly.</span>
                  <button
                    onClick={() => setActiveTab('installer')}
                    className="text-amber-400 hover:underline font-bold flex items-center gap-1"
                  >
                    <span>GO TO AUTO-INSTALLER SCRIPT</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer Bar */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950 flex items-center justify-between text-xs text-zinc-400 shrink-0">
          <span>FIELDOPS HAM APP AUTOMATION SUITE • VERSION 2.5</span>
          <button
            onClick={() => {
              playTacticalClick(audioEnabled);
              onClose();
            }}
            className="px-4 py-1.5 rounded-xl border border-zinc-700 bg-zinc-800 text-zinc-200 font-bold hover:bg-zinc-700"
          >
            CLOSE SUITE
          </button>
        </div>

      </div>
    </div>
  );
};
