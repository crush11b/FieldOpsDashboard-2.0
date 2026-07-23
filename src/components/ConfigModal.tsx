import React, { useState } from 'react';
import { X, Settings, Download, Upload, Plus, Trash2, Save, RefreshCw, Check, Code, Layers } from 'lucide-react';
import { AppLauncherItem, DashboardConfig, UIThemeMode } from '../types';
import { playTacticalClick } from '../utils/audio';

interface ConfigModalProps {
  config: DashboardConfig;
  theme: UIThemeMode;
  audioEnabled: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSaveConfig: (updated: DashboardConfig) => void;
  onResetToDefaults: () => void;
  editingApp?: AppLauncherItem | null;
}

export const ConfigModal: React.FC<ConfigModalProps> = ({
  config,
  theme,
  audioEnabled,
  isOpen,
  onClose,
  onSaveConfig,
  onResetToDefaults,
  editingApp,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'apps' | 'json_editor'>('general');
  const [callsign, setCallsign] = useState(config.callsign);
  const [columns, setColumns] = useState<2 | 3 | 4 | 6>(config.appGridColumns);
  const [comPort, setComPort] = useState<string>(config.gpsComPort || 'COM6 (GPS Receiver)');
  const [isCustomPort, setIsCustomPort] = useState<boolean>(false);
  const [baudRate, setBaudRate] = useState<number>(config.gpsBaudRate || 9600);
  const [appsList, setAppsList] = useState<AppLauncherItem[]>(config.apps);
  const [jsonText, setJsonText] = useState(JSON.stringify(config.apps, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  // New or Edit App Form state
  const [formApp, setFormApp] = useState<Partial<AppLauncherItem>>(
    editingApp || {
      id: `custom-${Date.now()}`,
      name: '',
      category: 'digital',
      iconName: 'Radio',
      executablePath: '',
      description: '',
      installed: true,
      favorite: false,
      hotkey: '',
      args: '',
    }
  );

  if (!isOpen) return null;

  const isNight = theme === 'night_vision';

  const handleSaveGeneral = () => {
    playTacticalClick(audioEnabled);
    onSaveConfig({
      ...config,
      callsign,
      appGridColumns: columns,
      gpsComPort: comPort,
      gpsBaudRate: baudRate,
      apps: appsList,
    });
    onClose();
  };

  const handleApplyJsonText = () => {
    playTacticalClick(audioEnabled);
    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed)) {
        setAppsList(parsed);
        onSaveConfig({
          ...config,
          apps: parsed,
        });
        setJsonError(null);
        alert('JSON Config successfully updated and saved!');
      } else {
        setJsonError('JSON must be an array of AppLauncherItems');
      }
    } catch (e: any) {
      setJsonError(`Invalid JSON format: ${e.message}`);
    }
  };

  const handleExportJson = () => {
    playTacticalClick(audioEnabled);
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fieldops-config-${config.callsign || 'W7FIELD'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    playTacticalClick(audioEnabled);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        if (parsed.apps && Array.isArray(parsed.apps)) {
          onSaveConfig(parsed);
          setAppsList(parsed.apps);
          setJsonText(JSON.stringify(parsed.apps, null, 2));
          alert('Config loaded successfully!');
          onClose();
        } else if (Array.isArray(parsed)) {
          setAppsList(parsed);
          onSaveConfig({ ...config, apps: parsed });
          setJsonText(JSON.stringify(parsed, null, 2));
          alert('Apps list updated successfully!');
          onClose();
        }
      } catch (err: any) {
        alert('Failed to parse JSON config file.');
      }
    };
    reader.readAsText(file);
  };

  const handleSaveSingleAppForm = () => {
    playTacticalClick(audioEnabled);
    if (!formApp.name || !formApp.executablePath) {
      alert('App Name and Executable Path are required.');
      return;
    }

    const appToSave: AppLauncherItem = {
      id: formApp.id || `app-${Date.now()}`,
      name: formApp.name,
      category: formApp.category || 'digital',
      iconName: formApp.iconName || 'Radio',
      executablePath: formApp.executablePath,
      description: formApp.description || '',
      installed: formApp.installed ?? true,
      favorite: formApp.favorite ?? false,
      hotkey: formApp.hotkey || '',
      args: formApp.args || '',
    };

    const exists = appsList.findIndex((a) => a.id === appToSave.id);
    let updated: AppLauncherItem[];
    if (exists >= 0) {
      updated = [...appsList];
      updated[exists] = appToSave;
    } else {
      updated = [...appsList, appToSave];
    }

    setAppsList(updated);
    setJsonText(JSON.stringify(updated, null, 2));
    onSaveConfig({ ...config, apps: updated });
    alert(`App "${appToSave.name}" saved!`);
  };

  const handleDeleteApp = (id: string) => {
    playTacticalClick(audioEnabled);
    if (confirm('Delete this app entry from launcher?')) {
      const updated = appsList.filter((a) => a.id !== id);
      setAppsList(updated);
      setJsonText(JSON.stringify(updated, null, 2));
      onSaveConfig({ ...config, apps: updated });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 font-mono">
      <div className={`max-w-4xl w-full max-h-[90vh] flex flex-col rounded-2xl border ${
        isNight ? 'bg-black border-red-900 text-red-400' : 'bg-[#0F1115] border-zinc-800 text-zinc-100'
      } shadow-2xl overflow-hidden`}>
        
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-amber-400" />
            <h2 className="font-black text-base uppercase tracking-wider text-zinc-100">
              DASHBOARD CONFIGURATION & JSON APPS LAUNCHER
            </h2>
          </div>

          <button
            id="btn-close-config-modal"
            onClick={onClose}
            className="p-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-800 active:scale-95 text-zinc-400 hover:text-zinc-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex items-center border-b border-zinc-800 px-4 bg-zinc-950/60">
          <button
            id="tab-config-general"
            onClick={() => setActiveTab('general')}
            className={`py-2.5 px-4 font-bold text-xs border-b-2 transition-all ${
              activeTab === 'general' ? 'border-amber-400 text-amber-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            GENERAL & OPERATOR
          </button>
          <button
            id="tab-config-apps"
            onClick={() => setActiveTab('apps')}
            className={`py-2.5 px-4 font-bold text-xs border-b-2 transition-all ${
              activeTab === 'apps' ? 'border-amber-400 text-amber-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            APPS MANAGER ({appsList.length})
          </button>
          <button
            id="tab-config-json"
            onClick={() => setActiveTab('json_editor')}
            className={`py-2.5 px-4 font-bold text-xs border-b-2 transition-all ${
              activeTab === 'json_editor' ? 'border-amber-400 text-amber-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            🛠️ JSON CONFIG EDITOR
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          
          {/* TAB 1: General & Operator */}
          {activeTab === 'general' && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase mb-1 text-cyan-300">
                    FIELD OPERATOR CALLSIGN
                  </label>
                  <input
                    id="input-config-callsign"
                    type="text"
                    value={callsign}
                    onChange={(e) => setCallsign(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded font-black text-sm uppercase text-emerald-400 font-mono"
                    placeholder="e.g. W7FIELD"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Displayed on top dashboard banner and appended to log exports.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase mb-1 text-cyan-300">
                    TOUCH SCREEN GRID COLUMNS
                  </label>
                  <select
                    id="select-config-grid-cols"
                    value={columns}
                    onChange={(e) => setColumns(Number(e.target.value) as any)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded font-bold text-xs text-cyan-300 font-mono"
                  >
                    <option value={2}>2 Columns (Large Touch Targets)</option>
                    <option value={3}>3 Columns (Standard Tablet CF-20/FZ-G1)</option>
                    <option value={4}>4 Columns (Compact Layout)</option>
                    <option value={6}>6 Columns (Ultra High Density)</option>
                  </select>
                </div>
              </div>

              {/* GNSS Satellite Serial COM Port & Baud Rate Configuration */}
              <div className="p-3.5 rounded-xl border border-cyan-500/30 bg-slate-900/80 space-y-3 font-mono">
                <div className="flex items-center justify-between">
                  <h4 className="font-black text-xs uppercase text-cyan-300 flex items-center gap-1.5">
                    🛰️ SATELLITE GNSS SERIAL COM PORT CONFIG
                  </h4>
                  <span className="text-[10px] px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-bold">
                    BOOT DIRECT LINK
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                      DEFAULT COM PORT / SERIAL DEVICE
                    </label>
                    {!isCustomPort ? (
                      <select
                        id="select-config-com-port"
                        value={comPort}
                        onChange={(e) => {
                          if (e.target.value === 'CUSTOM_INPUT') {
                            setIsCustomPort(true);
                            setComPort('COM6');
                          } else {
                            setComPort(e.target.value);
                          }
                        }}
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded font-bold text-xs text-amber-300 font-mono"
                      >
                        <option value="COM6 (GPS Receiver)">COM6 (Active GNSS Receiver)</option>
                        <option value="COM6">COM6 (Standard Serial)</option>
                        <option value="COM1">COM1 (Standard System Serial)</option>
                        <option value="COM2">COM2 (Serial Port 2)</option>
                        <option value="COM3">COM3 (USB Serial Adapter)</option>
                        <option value="COM4">COM4 (Serial Port 4)</option>
                        <option value="COM5">COM5 (Serial Port 5)</option>
                        <option value="COM7">COM7 (Serial Port 7)</option>
                        <option value="COM8">COM8 (Serial Port 8)</option>
                        <option value="COM9">COM9 (Serial Port 9)</option>
                        <option value="COM10">COM10 (Serial Port 10)</option>
                        <option value="COM11">COM11 (Serial Port 11)</option>
                        <option value="COM12">COM12 (Serial Port 12)</option>
                        <option value="COM13">COM13 (Serial Port 13)</option>
                        <option value="COM14">COM14 (Serial Port 14)</option>
                        <option value="COM15">COM15 (Serial Port 15)</option>
                        <option value="COM16">COM16 (Serial Port 16)</option>
                        <option value="/dev/ttyUSB0">/dev/ttyUSB0 (Linux USB-Serial)</option>
                        <option value="/dev/ttyUSB1">/dev/ttyUSB1 (Linux USB-Serial 2)</option>
                        <option value="/dev/ttyACM0">/dev/ttyACM0 (Linux USB Modem/GNSS)</option>
                        <option value="AUTO_DETECT">⚡ Auto-Detect Satellite Dongle</option>
                        <option value="CUSTOM_INPUT">✏️ Custom / Type Manual COM Port...</option>
                      </select>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={comPort}
                          onChange={(e) => setComPort(e.target.value)}
                          placeholder="e.g. COM6 or /dev/ttyUSB0"
                          className="w-full px-2.5 py-1.5 bg-slate-950 border border-amber-500/50 rounded font-bold text-xs text-amber-300 font-mono focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setIsCustomPort(false)}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-[10px] text-slate-300 font-bold"
                        >
                          List
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                      NMEA BAUD RATE
                    </label>
                    <select
                      id="select-config-baud-rate"
                      value={baudRate}
                      onChange={(e) => setBaudRate(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded font-bold text-xs text-cyan-300 font-mono"
                    >
                      <option value={4800}>4800 BAUD (Standard NMEA 0183)</option>
                      <option value={9600}>9600 BAUD (Default u-Blox / Garmin)</option>
                      <option value={19200}>19200 BAUD (High-Speed NMEA)</option>
                      <option value={38400}>38400 BAUD (AIS / High Rate GNSS)</option>
                      <option value={57600}>57600 BAUD (RTK Differential)</option>
                      <option value={115200}>115200 BAUD (UBX Binary / Multi-GNSS)</option>
                    </select>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400">
                  Selects the hardware COM Port and NMEA Baud Rate used on startup. Replaces prompt popups for location permissions in field operations.
                </p>
              </div>

              {/* Import / Export JSON buttons */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
                <h4 className="font-black text-xs uppercase text-amber-300">
                  EXPORT / IMPORT CONFIGURATION
                </h4>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    id="btn-export-json-config"
                    onClick={handleExportJson}
                    className="px-4 py-2 rounded bg-cyan-700 hover:bg-cyan-600 text-white font-bold text-xs flex items-center gap-1.5 active:scale-95"
                  >
                    <Download className="w-4 h-4" /> EXPORT JSON CONFIG
                  </button>

                  <label id="lbl-import-json-config" className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5 cursor-pointer active:scale-95 border border-slate-700">
                    <Upload className="w-4 h-4" /> IMPORT JSON FILE
                    <input type="file" accept=".json" onChange={handleImportJsonFile} className="hidden" />
                  </label>

                  <button
                    id="btn-reset-default-config"
                    onClick={() => {
                      playTacticalClick(audioEnabled);
                      if (confirm('Reset entire dashboard to Panasonic Toughbook factory defaults?')) {
                        onResetToDefaults();
                        onClose();
                      }
                    }}
                    className="px-4 py-2 rounded border border-red-800 text-red-400 hover:bg-red-950 font-bold text-xs flex items-center gap-1.5 active:scale-95"
                  >
                    <RefreshCw className="w-4 h-4" /> RESET TO DEFAULTS
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Apps Manager */}
          {activeTab === 'apps' && (
            <div className="space-y-4 text-xs">
              {/* Form to Add / Edit Single App */}
              <div className="p-3.5 rounded-xl border border-cyan-800 bg-cyan-950/20 space-y-3">
                <h4 className="font-black text-xs uppercase text-cyan-300">
                  {formApp.id ? 'EDIT APP ITEM' : 'ADD NEW HAM RADIO EXECUTABLE'}
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] uppercase opacity-70 mb-0.5">App Name</label>
                    <input
                      id="input-app-form-name"
                      type="text"
                      value={formApp.name || ''}
                      onChange={(e) => setFormApp({ ...formApp, name: e.target.value })}
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-cyan-200 text-xs font-mono"
                      placeholder="e.g. WSJT-X"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase opacity-70 mb-0.5">Category</label>
                    <select
                      id="select-app-form-category"
                      value={formApp.category || 'digital'}
                      onChange={(e) => setFormApp({ ...formApp, category: e.target.value as any })}
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-cyan-200 text-xs font-mono"
                    >
                      <option value="digital">Digital Modes</option>
                      <option value="logging">Logging & POTA</option>
                      <option value="mapping">Mapping & APRS</option>
                      <option value="radio_control">Radio CAT</option>
                      <option value="utilities">Utilities</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase opacity-70 mb-0.5">Hotkey (F1 - F12)</label>
                    <input
                      id="input-app-form-hotkey"
                      type="text"
                      value={formApp.hotkey || ''}
                      onChange={(e) => setFormApp({ ...formApp, hotkey: e.target.value })}
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-amber-300 text-xs font-mono"
                      placeholder="e.g. F1"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase opacity-70 mb-0.5">Executable Path</label>
                  <input
                    id="input-app-form-executable-path"
                    type="text"
                    value={formApp.executablePath || ''}
                    onChange={(e) => setFormApp({ ...formApp, executablePath: e.target.value })}
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-emerald-300 text-xs font-mono"
                    placeholder="C:\Program Files\WSJTX\bin\wsjtx.exe"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <button
                    id="btn-save-app-form"
                    onClick={handleSaveSingleAppForm}
                    className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1 active:scale-95"
                  >
                    <Save className="w-4 h-4" /> SAVE APP ITEM
                  </button>

                  <button
                    id="btn-clear-app-form"
                    onClick={() => {
                      setFormApp({
                        id: `custom-${Date.now()}`,
                        name: '',
                        category: 'digital',
                        iconName: 'Radio',
                        executablePath: '',
                        description: '',
                        installed: true,
                        favorite: false,
                      });
                    }}
                    className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                  >
                    CLEAR FORM
                  </button>
                </div>
              </div>

              {/* List of configured apps */}
              <div className="space-y-2">
                <h4 className="font-bold text-xs uppercase opacity-75">CURRENT EXECUTABLE LIST</h4>
                {appsList.map((app) => (
                  <div key={app.id} className="p-2.5 rounded-lg border border-slate-800 bg-slate-900 flex items-center justify-between gap-2">
                    <div className="truncate">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-cyan-300 text-xs">{app.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 uppercase font-mono">
                          {app.category}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 block truncate font-mono">
                        {app.executablePath}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        id={`btn-edit-item-${app.id}`}
                        onClick={() => setFormApp(app)}
                        className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300"
                        title="Edit app"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                      <button
                        id={`btn-delete-item-${app.id}`}
                        onClick={() => handleDeleteApp(app.id)}
                        className="p-1.5 rounded bg-red-950/80 hover:bg-red-900 text-red-400"
                        title="Delete app"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Drag & Drop / Raw JSON Editor */}
          {activeTab === 'json_editor' && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <label className="font-black uppercase text-amber-300 flex items-center gap-1.5">
                  <Code className="w-4 h-4" /> RAW JSON CONFIGURATION CODE
                </label>
                <button
                  id="btn-apply-json-text"
                  onClick={handleApplyJsonText}
                  className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs flex items-center gap-1 active:scale-95"
                >
                  <Check className="w-4 h-4" /> APPLY JSON CHANGES
                </button>
              </div>

              {jsonError && (
                <div className="p-2.5 rounded bg-red-950 border border-red-700 text-red-300 font-mono text-[11px]">
                  ❌ {jsonError}
                </div>
              )}

              <textarea
                id="textarea-json-editor"
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  setJsonError(null);
                }}
                rows={16}
                className="w-full p-3 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-emerald-400 leading-relaxed focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-current/15 flex items-center justify-between bg-black/40">
          <span className="text-[10px] text-slate-400">
            FieldOpsDashboard v1.1.4 Config Engine
          </span>
          <button
            id="btn-save-and-close-config"
            onClick={handleSaveGeneral}
            className="px-5 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-black text-xs active:scale-95 shadow"
          >
            SAVE & CLOSE
          </button>
        </div>

      </div>
    </div>
  );
};
