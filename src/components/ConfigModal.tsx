import React, { useEffect, useState } from 'react';
import { PRODUCT_METADATA } from '../productMetadata';
import { X, Settings, Download, Upload, Plus, Trash2, Save, RefreshCw, Check, Code, Layers } from 'lucide-react';
import { DashboardConfig, UIThemeMode } from '../types';
import { addUserManagedRecord, AppCatalogRecord, deleteCatalogRecord, isAppCatalogConfig, isValidCatalogTarget, restoreBuiltInRecord, setCatalogRecordEnabled, updateCatalogRecord } from '../appCatalog/domain';
import { INITIAL_CONFIG } from '../data/defaultConfig';
import { playTacticalClick } from '../utils/audio';

interface ConfigModalProps {
  config: DashboardConfig;
  theme: UIThemeMode;
  audioEnabled: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSaveConfig: (updated: DashboardConfig) => Promise<DashboardConfig | null>;
  onResetToDefaults: () => void;
  editingApp?: AppCatalogRecord | null;
  initialTab?: 'general' | 'apps' | 'json_editor';
}

type CatalogForm = Partial<AppCatalogRecord> & {
  targetKind: 'native' | 'web';
  executablePath: string;
  args: string;
  workingDir: string;
  url: string;
};

const emptyForm = (): CatalogForm => ({
  id: `custom-${Date.now()}`,
  name: '',
  category: 'Digital Comms',
  iconName: 'Radio',
  description: '',
  owner: 'user_managed',
  targetKind: 'native',
  executablePath: '',
  args: '',
  workingDir: '',
  url: '',
  capabilities: [],
  dependencies: [],
  enabled: true,
  favorite: false,
  hotkey: '',
  policy: { editable: true, disableable: true, deletable: true, restorable: false },
});

const formFromRecord = (record: AppCatalogRecord): CatalogForm => ({
  ...record,
  targetKind: record.target.kind === 'web' ? 'web' : 'native',
  executablePath: record.target.kind === 'native' ? record.target.executablePath : '',
  args: record.target.kind === 'native' ? record.target.args || '' : '',
  workingDir: record.target.kind === 'native' ? record.target.workingDir || '' : '',
  url: record.target.kind === 'web' ? record.target.url : '',
});

export const ConfigModal: React.FC<ConfigModalProps> = ({
  config,
  theme,
  audioEnabled,
  isOpen,
  onClose,
  onSaveConfig,
  onResetToDefaults,
  editingApp,
  initialTab = 'general',
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'apps' | 'json_editor'>('general');
  const [callsign, setCallsign] = useState(config.callsign);
  const [columns, setColumns] = useState<2 | 3 | 4 | 6>(config.appGridColumns);
  const [comPort, setComPort] = useState<string>(config.gpsComPort || 'COM6 (GPS Receiver)');
  const [isCustomPort, setIsCustomPort] = useState<boolean>(false);
  const [baudRate, setBaudRate] = useState<number>(config.gpsBaudRate || 9600);
  const [appsList, setAppsList] = useState<AppCatalogRecord[]>([...config.appCatalog.records]);
  const [catalogState, setCatalogState] = useState(config.appCatalog);
  const [jsonText, setJsonText] = useState(JSON.stringify(config.appCatalog, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  // New or Edit App Form state
  const [formApp, setFormApp] = useState<CatalogForm>(editingApp ? formFromRecord(editingApp) : emptyForm());

  useEffect(() => {
    if (!isOpen) return;
    setCatalogState(config.appCatalog);
    setAppsList([...config.appCatalog.records]);
    setJsonText(JSON.stringify(config.appCatalog, null, 2));
    setJsonError(null);
    setActiveTab(initialTab);
    setFormApp(editingApp ? formFromRecord(editingApp) : emptyForm());
    setCallsign(config.callsign);
    setColumns(config.appGridColumns);
    setComPort(config.gpsComPort || 'COM6 (GPS Receiver)');
    setBaudRate(config.gpsBaudRate || 9600);
  }, [isOpen, editingApp, initialTab]);

  if (!isOpen) return null;

  const isNight = theme === 'night_vision';

  const persistCatalog = async (catalog: DashboardConfig['appCatalog'], completeConfig?: DashboardConfig): Promise<boolean> => {
    const saved = await onSaveConfig({ ...(completeConfig || config), appCatalog: catalog });
    if (!saved) {
      setJsonError('Catalog could not be saved. The previous catalog remains active.');
      return false;
    }
    setCatalogState(saved.appCatalog);
    setAppsList([...saved.appCatalog.records]);
    setJsonText(JSON.stringify(saved.appCatalog, null, 2));
    return true;
  };

  const handleSaveGeneral = async () => {
    playTacticalClick(audioEnabled);
    const saved = await onSaveConfig({
      ...config,
      callsign,
      appGridColumns: columns,
      gpsComPort: comPort,
      gpsBaudRate: baudRate,
      appCatalog: config.appCatalog,
    });
    if (saved) onClose();
  };

  const handleApplyJsonText = async () => {
    playTacticalClick(audioEnabled);
    try {
      const parsed = JSON.parse(jsonText);
      if (isAppCatalogConfig(parsed)) {
        if (await persistCatalog(parsed)) setJsonError(null);
      } else {
        setJsonError('JSON must be an App Catalog object with records');
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
    a.download = `${PRODUCT_METADATA.productId}-config-${config.callsign || 'W7FIELD'}-${PRODUCT_METADATA.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    playTacticalClick(audioEnabled);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        if (parsed.appCatalog && isAppCatalogConfig(parsed.appCatalog)) {
          if (await persistCatalog(parsed.appCatalog, parsed as DashboardConfig)) onClose();
        } else {
          setJsonError('Imported JSON must contain a valid appCatalog object.');
        }
      } catch (err: any) {
        setJsonError(`Failed to parse JSON config file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleSaveSingleAppForm = async () => {
    playTacticalClick(audioEnabled);
    if (!formApp.name || (formApp.targetKind === 'native' ? !formApp.executablePath : !formApp.url)) {
      setJsonError(formApp.targetKind === 'native' ? 'App name and executable path are required.' : 'App name and HTTP/HTTPS URL are required.');
      return;
    }

    const appToSave: AppCatalogRecord = {
      id: formApp.id || `app-${Date.now()}`,
      name: formApp.name,
      category: formApp.category || 'Digital Comms',
      iconName: formApp.iconName || 'Radio',
      target: formApp.targetKind === 'web'
        ? { kind: 'web', url: formApp.url }
        : { kind: 'native', executablePath: formApp.executablePath, ...(formApp.args ? { args: formApp.args } : {}), ...(formApp.workingDir ? { workingDir: formApp.workingDir } : {}) },
      description: formApp.description || '',
      owner: formApp.owner || 'user_managed',
      capabilities: formApp.capabilities || [],
      dependencies: formApp.dependencies || [],
      enabled: formApp.enabled ?? true,
      policy: formApp.policy || { editable: true, disableable: true, deletable: true, restorable: false },
      favorite: formApp.favorite ?? false,
      hotkey: formApp.hotkey || '',
    };

    const exists = appsList.findIndex((a) => a.id === appToSave.id);
    if (!isValidCatalogTarget(appToSave.target)) {
      setJsonError(formApp.targetKind === 'web' ? 'Web targets must use an HTTP or HTTPS URL.' : 'Native targets require an absolute local Windows .exe path and valid working directory.');
      return;
    }
    const nextCatalog = exists >= 0 ? updateCatalogRecord(catalogState, appToSave) : addUserManagedRecord(catalogState, appToSave);
    if (nextCatalog === catalogState) {
      setJsonError('The catalog rejected this add or edit operation.');
      return;
    }
    if (await persistCatalog(nextCatalog)) setFormApp(formFromRecord(nextCatalog.records.find(record => record.id === appToSave.id) || appToSave));
  };

  const handleDeleteApp = async (id: string) => {
    playTacticalClick(audioEnabled);
    if (confirm('Delete this app entry from launcher?')) {
      const nextCatalog = deleteCatalogRecord(catalogState, id);
      if (nextCatalog === catalogState) setJsonError('The catalog rejected deletion for this record.');
      else await persistCatalog(nextCatalog);
    }
  };

  const handleToggleEnabled = async (record: AppCatalogRecord) => {
    if (!record.policy.disableable) return;
    const nextCatalog = setCatalogRecordEnabled(catalogState, record.id, !record.enabled);
    if (nextCatalog === catalogState) setJsonError('This record cannot be enabled or disabled.');
    else await persistCatalog(nextCatalog);
  };

  const handleRestoreApp = async (id: string) => {
    const nextCatalog = restoreBuiltInRecord(catalogState, id, INITIAL_CONFIG.appCatalog.records);
    if (nextCatalog === catalogState) setJsonError('The catalog rejected restoration for this record.');
    else await persistCatalog(nextCatalog);
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
          {jsonError && (
            <div role="alert" className="p-2.5 rounded bg-red-950 border border-red-700 text-red-300 font-mono text-[11px]">
              {jsonError}
            </div>
          )}
          
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
                        <option value="COM6 (GPS Receiver)">COM6 (Configured GNSS Port)</option>
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
                  {editingApp ? 'EDIT APP ITEM' : 'ADD APP'}
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
                      <option value="Digital Comms">Digital Comms</option>
                      <option value="APRS">APRS</option>
                      <option value="Satellite Ops">Satellite Ops</option>
                      <option value="Network Voice">Network Voice</option>
                      <option value="POTA/SOTA">POTA/SOTA</option>
                      <option value="Web Apps">Web Apps</option>
                      <option value="Utilities">Utilities</option>
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
                  <label className="block text-[10px] uppercase opacity-70 mb-0.5">Target Type</label>
                  <select
                    id="select-app-form-target-kind"
                    value={formApp.targetKind}
                    onChange={(e) => setFormApp({ ...formApp, targetKind: e.target.value as 'native' | 'web', executablePath: '', args: '', workingDir: '', url: '' })}
                    disabled={formApp.owner !== 'user_managed' && formApp.policy?.editable === false}
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-cyan-200 text-xs font-mono"
                  >
                    <option value="native">Native Executable</option>
                    <option value="web">Web URL</option>
                  </select>
                </div>

                {formApp.targetKind === 'native' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input id="input-app-form-executable-path" type="text" value={formApp.executablePath} onChange={(e) => setFormApp({ ...formApp, executablePath: e.target.value })} className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-emerald-300 text-xs font-mono" placeholder="Executable path" />
                    <input id="input-app-form-args" type="text" value={formApp.args} onChange={(e) => setFormApp({ ...formApp, args: e.target.value })} className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-emerald-300 text-xs font-mono" placeholder="Arguments" />
                    <input id="input-app-form-working-dir" type="text" value={formApp.workingDir} onChange={(e) => setFormApp({ ...formApp, workingDir: e.target.value })} className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-emerald-300 text-xs font-mono" placeholder="Working directory" />
                  </div>
                ) : (
                  <input id="input-app-form-url" type="url" value={formApp.url} onChange={(e) => setFormApp({ ...formApp, url: e.target.value })} className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-emerald-300 text-xs font-mono" placeholder="https://example.test" />
                )}

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
                        category: 'Digital Comms',
                        iconName: 'Radio',
                        description: '',
                        owner: 'user_managed',
                        targetKind: 'native',
                        executablePath: '',
                        args: '',
                        workingDir: '',
                        url: '',
                        policy: { editable: true, disableable: true, deletable: true, restorable: false },
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
                <h4 className="font-bold text-xs uppercase opacity-75">CURRENT CATALOG RECORDS</h4>
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
                        {app.target.kind === 'native' ? app.target.executablePath : app.target.kind === 'web' ? app.target.url : 'Unsupported target'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        id={`btn-edit-item-${app.id}`}
                        onClick={() => setFormApp(formFromRecord(app))}
                        disabled={!app.policy.editable}
                        className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300"
                        title="Edit app"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                      <button
                        id={`btn-delete-item-${app.id}`}
                        onClick={() => handleDeleteApp(app.id)}
                        disabled={!app.policy.deletable}
                        className="p-1.5 rounded bg-red-950/80 hover:bg-red-900 text-red-400"
                        title="Delete app"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className={app.enabled ? 'text-emerald-400' : 'text-amber-400'}>{app.enabled ? 'ENABLED' : 'DISABLED'}</span>
                      <button type="button" onClick={() => handleToggleEnabled(app)} disabled={!app.policy.disableable} className="text-cyan-300 disabled:text-slate-600">{app.enabled ? 'DISABLE' : 'ENABLE'}</button>
                    </div>
                  </div>
                ))}
                {config.appCatalog.deletedBuiltInIds.map(id => {
                  const record = INITIAL_CONFIG.appCatalog.records.find(candidate => candidate.id === id);
                  if (!record) return null;
                  return <div key={`tombstone-${id}`} className="p-2.5 rounded-lg border border-amber-800 bg-amber-950/30 flex items-center justify-between"><span className="text-amber-300 text-xs">{record.name} <span className="text-[10px]">TOMBSTONED</span></span><button type="button" onClick={() => handleRestoreApp(id)} className="text-cyan-300 text-xs">RESTORE</button></div>;
                })}
              </div>
            </div>
          )}

          {/* TAB 3: Drag & Drop / Raw JSON Editor */}
          {activeTab === 'json_editor' && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <label className="font-black uppercase text-amber-300 flex items-center gap-1.5">
                  <Code className="w-4 h-4" /> APP CATALOG JSON
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
            {PRODUCT_METADATA.productName} {PRODUCT_METADATA.displayVersion} Config Engine
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
