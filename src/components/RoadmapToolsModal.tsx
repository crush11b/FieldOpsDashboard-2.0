import React, { useState } from 'react';
import { PRODUCT_METADATA } from '../productMetadata';
import { createAdifExport } from '../utils/adif';
import { 
  X, 
  Wrench, 
  Radio, 
  BookOpen, 
  Sparkles, 
  Calculator,
  Compass, 
  Sun,
  Send, 
  Download, 
  Plus, 
  Check, 
  Search, 
  Zap, 
  MapPin,
  Bot
} from 'lucide-react';
import { LogEntry, UIThemeMode } from '../types';
import { playTacticalClick } from '../utils/audio';
import type { GPSProvenance, GPSStatus } from '../types';
import { getTelemetryFreshness } from '../telemetry/TelemetryFreshness';
import { resolveOperatingLocation, type OperatingLocation } from '../location/operatingLocation';
import { parseCoordinates } from '../location/coordinates';
import { calculateDistanceKm, calculateDistanceMiles, calculateInitialBearing, compassDirection } from '../location/geography';
import { calculateSolarEvents, type SolarEventName } from '../location/solarEvents';
import type { StationProfile } from '../propagation/domain';
import { SmartDeployPlanner } from './SmartDeployPlanner';

interface RoadmapToolsModalProps {
  theme: UIThemeMode;
  audioEnabled: boolean;
  isOpen: boolean;
  onClose: () => void;
  callsign: string;
  gridSquare: string;
  gps: GPSStatus;
  gpsProvenance: GPSProvenance;
  stationProfile?: StationProfile;
  initialTab?: string;
}

export const RoadmapToolsModal: React.FC<RoadmapToolsModalProps> = ({
  theme,
  audioEnabled,
  isOpen,
  onClose,
  callsign,
  gridSquare,
  gps,
  gpsProvenance,
  stationProfile,
  initialTab = 'coordinate',
}) => {
  const [activeTab, setActiveTab] = useState<string>(initialTab === 'smart_frequency' ? 'smart_deploy' : initialTab);
  const operatingLocation = resolveOperatingLocation(gps, gpsProvenance);

  // Antenna calculator state
  const [freqMHz, setFreqMHz] = useState<number>(14.074);
  const [velocityFactor, setVelocityFactor] = useState<number>(0.95);
  const [antennaType, setAntennaType] = useState<'dipole' | 'efhw' | 'vertical' | 'random_wire'>('dipole');

  // SmartFrequency State
  const [selectedBandPlan, setSelectedBandPlan] = useState<string>('20m');

  // 3. SmartLog+ State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [newCall, setNewCall] = useState('');
  const [newBand, setNewBand] = useState('20m');
  const [newMode, setNewMode] = useState('FT8');
  const [newFreq, setNewFreq] = useState('14.074');
  const [newRstSent, setNewRstSent] = useState('-10');
  const [newRstRcvd, setNewRstRcvd] = useState('-14');
  const [newGrid, setNewGrid] = useState(gridSquare);
  const [newPota, setNewPota] = useState('K-0182');

  // 4. SmartAssistant State
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiChat, setAiChat] = useState<Array<{ sender: 'user' | 'ai'; text: string; time: string }>>([
    {
      sender: 'ai',
      text: `AI advisor availability depends on a configured Gemini service. Submit a question to check availability.`,
      time: new Date().toLocaleTimeString(),
    },
  ]);
  const [aiLoading, setAiLoading] = useState(false);

  if (!isOpen) return null;

  const isNight = theme === 'night_vision';

  const totalFeet = (468 / freqMHz) * velocityFactor;
  const legFeet = antennaType === 'dipole' ? totalFeet / 2 : totalFeet;
  const totalMeters = totalFeet * 0.3048;
  const legMeters = legFeet * 0.3048;

  const handleAddLog = () => {
    playTacticalClick(audioEnabled);
    if (!newCall) {
      alert('Callsign is required');
      return;
    }

    const entry: LogEntry = {
      id: `log-${Date.now()}`,
      callsign: newCall.toUpperCase(),
      band: newBand,
      mode: newMode,
      frequency: newFreq,
      rstSent: newRstSent,
      rstRcvd: newRstRcvd,
      gridSquare: newGrid || gridSquare,
      potaRef: newPota,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
    };

    setLogs([entry, ...logs]);
    setNewCall('');
  };

  const handleExportADIF = () => {
    playTacticalClick(audioEnabled);
    const adif = createAdifExport(logs);

    const blob = new Blob([adif], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fieldops-log-${callsign || 'W7FIELD'}.adi`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendAiPrompt = async () => {
    if (!aiPrompt.trim()) return;
    playTacticalClick(audioEnabled);

    const userMsg = aiPrompt;
    setAiPrompt('');
    setAiChat((prev) => [...prev, { sender: 'user', text: userMsg, time: new Date().toLocaleTimeString() }]);
    setAiLoading(true);

    try {
      const res = await fetch('/api/ai-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userMsg,
          context: {
            callsign,
            gridSquare,
            freqMHz,
          },
        }),
      });

      const data = await res.json();
      setAiChat((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: data.reply || data.error || 'Server processed request.',
          time: new Date().toLocaleTimeString(),
        },
      ]);
    } catch (err: any) {
      setAiChat((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: '⚠️ Unable to connect to AI server endpoint. Verify network or GEMINI_API_KEY.',
          time: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono">
      <div className={`max-w-4xl w-full max-h-[90vh] flex flex-col rounded-2xl border ${
        isNight ? 'bg-black border-red-900 text-red-400' : 'bg-[#0F1115] border-zinc-800 text-zinc-100'
      } shadow-2xl overflow-hidden`}>
        
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h2 className="font-black text-base uppercase tracking-wider text-zinc-100">
              ROADMAP SMART MODULES ({PRODUCT_METADATA.displayVersion})
            </h2>
          </div>

          <button
            id="btn-close-roadmap-modal"
            onClick={onClose}
            className="p-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-800 active:scale-95 text-zinc-400 hover:text-zinc-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Roadmap Module Tabs */}
        <div className="flex items-center border-b border-zinc-800 px-4 bg-zinc-950/60 overflow-x-auto">
          <button
            id="tab-field-location"
            onClick={() => setActiveTab('coordinate')}
            className={`py-2.5 px-4 font-bold text-xs border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-all ${
              activeTab === 'coordinate' ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <MapPin className="w-4 h-4" /> LOCATION
          </button>

          <button
            id="tab-field-distance-bearing"
            onClick={() => setActiveTab('distance_bearing')}
            className={`py-2.5 px-4 font-bold text-xs border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-all ${
              activeTab === 'distance_bearing' ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Compass className="w-4 h-4" /> DISTANCE / BEARING
          </button>

          <button
            id="tab-field-sun-twilight"
            onClick={() => setActiveTab('sun_twilight')}
            className={`py-2.5 px-4 font-bold text-xs border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-all ${
              activeTab === 'sun_twilight' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sun className="w-4 h-4" /> SUN / TWILIGHT
          </button>

          <button
            id="tab-smart-deploy"
            onClick={() => setActiveTab('smart_deploy')}
            className={`py-2.5 px-4 font-bold text-xs border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-all ${
              activeTab === 'smart_deploy' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wrench className="w-4 h-4" /> SmartDeploy
          </button>

          <button
            id="tab-antenna-calculator"
            onClick={() => setActiveTab('antenna_calculator')}
            className={`py-2.5 px-4 font-bold text-xs border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-all ${
              activeTab === 'antenna_calculator' ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calculator className="w-4 h-4" /> ANTENNA CALCULATOR
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4 text-xs">
          {activeTab === 'coordinate' && (
            <CoordinateTool operatingLocation={operatingLocation} />
          )}

          {activeTab === 'distance_bearing' && (
            <DistanceBearingTool operatingLocation={operatingLocation} />
          )}

          {activeTab === 'sun_twilight' && (
            <SunTwilightTool operatingLocation={operatingLocation} />
          )}
          
          {/* SmartDeploy activation planning */}
          {activeTab === 'smart_deploy' && (
            <div className="space-y-4">
              <SmartDeployPlanner operatingLocation={operatingLocation} stationProfile={stationProfile} />
            </div>
          )}

          {activeTab === 'antenna_calculator' && (
            <div className="p-3.5 rounded-xl border border-amber-600/60 bg-amber-950/20 space-y-3">
              <h3 className="font-black text-xs uppercase text-amber-300 flex items-center gap-2"><Calculator className="w-4 h-4" /> ANTENNA LENGTH CALCULATOR</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="text-[10px] uppercase opacity-75">Target Frequency (MHz)<input type="number" step="0.001" value={freqMHz} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) setFreqMHz(value); }} className="mt-1 w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-amber-300 font-bold font-mono" /></label>
                <label className="text-[10px] uppercase opacity-75">Antenna Topology<select value={antennaType} onChange={event => setAntennaType(event.target.value as typeof antennaType)} className="mt-1 w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-cyan-300 font-bold font-mono"><option value="dipole">Half-Wave Dipole (Driven)</option><option value="efhw">End-Fed Half-Wave (EFHW 49:1)</option><option value="vertical">Quarter-Wave Vertical (1/4 lambda)</option><option value="random_wire">Random Wire (Non-Resonant)</option></select></label>
                <label className="text-[10px] uppercase opacity-75">Wire Velocity Factor (VF)<select value={velocityFactor} onChange={event => setVelocityFactor(Number(event.target.value))} className="mt-1 w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-emerald-300 font-bold font-mono"><option value={0.95}>0.95 (Insulated stranded copper)</option><option value={0.98}>0.98 (Bare copper field wire)</option><option value={0.92}>0.92 (Tactical camo wire)</option></select></label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg border border-emerald-600/80 bg-emerald-950/40 text-emerald-300"><span className="text-[10px] uppercase opacity-80 block">TOTAL RESONANT WIRE LENGTH</span><strong className="block text-xl">{totalFeet.toFixed(2)} FT ({totalMeters.toFixed(2)} METERS)</strong><span className="text-[10px] text-slate-300">Formula: L (ft) = (468 / {freqMHz} MHz) x {velocityFactor} VF</span></div>
                <div className="p-3 rounded-lg border border-cyan-600/80 bg-cyan-950/40 text-cyan-300"><span className="text-[10px] uppercase opacity-80 block">LEG / RADIAL CUT LENGTH</span><strong className="block text-xl">{legFeet.toFixed(2)} FT ({legMeters.toFixed(2)} METERS)</strong><span className="text-[10px] text-slate-300">{antennaType === 'dipole' ? 'Cut 2 identical wire legs for center feed point' : 'Single continuous wire radiator'}</span></div>
              </div>
              <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/80 text-[11px]"><h4 className="font-bold text-amber-300 uppercase">PROXIMITY & GROUND ANGLE RECOMMENDATIONS</h4><p className="text-slate-300">NVIS: mount wire horizontal at 8 to 15 feet off ground for regional coverage.</p><p className="text-slate-300">DX: mount inverted-V or end-fed at least 35 feet high for a lower takeoff angle.</p></div>
            </div>
          )}

          {/* MODULE 2: SmartFrequency Band Advisor */}
          {activeTab === 'smart_frequency' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl border border-cyan-800 bg-cyan-950/20 space-y-3">
                <h3 className="font-black text-xs uppercase text-cyan-300 flex items-center gap-2">
                  <Radio className="w-4 h-4 text-cyan-400" /> BAND & FREQUENCY PLAN ADVISOR
                </h3>

                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {['80m', '40m', '30m', '20m', '17m', '15m', '10m'].map((b) => (
                    <button
                      id={`btn-plan-band-${b}`}
                      key={b}
                      onClick={() => setSelectedBandPlan(b)}
                      className={`px-3 py-1 rounded font-bold uppercase transition-all ${
                        selectedBandPlan === b ? 'bg-cyan-600 text-white font-black' : 'bg-slate-900 border border-slate-800 text-slate-400'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>

                {/* Frequency Band Details */}
                <div className="space-y-2 pt-2">
                  <div className="p-3 rounded-lg border border-slate-800 bg-slate-900 space-y-2">
                    <h4 className="font-bold text-amber-300 text-xs uppercase">{selectedBandPlan} HAM BAND FREQUENCIES</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="p-2 rounded border border-slate-800 bg-slate-950">
                        <span className="text-emerald-400 font-bold block">FT8 DIGITAL CALLING</span>
                        <span className="font-mono">{selectedBandPlan === '20m' ? '14.074 MHz' : selectedBandPlan === '40m' ? '7.074 MHz' : '3.573 MHz'}</span>
                      </div>
                      <div className="p-2 rounded border border-slate-800 bg-slate-950">
                        <span className="text-cyan-400 font-bold block">JS8CALL MESSAGING</span>
                        <span className="font-mono">{selectedBandPlan === '20m' ? '14.078 MHz' : selectedBandPlan === '40m' ? '7.078 MHz' : '3.578 MHz'}</span>
                      </div>
                      <div className="p-2 rounded border border-slate-800 bg-slate-950">
                        <span className="text-amber-400 font-bold block">POTA SSB CALLING</span>
                        <span className="font-mono">{selectedBandPlan === '20m' ? '14.240 - 14.280 MHz' : selectedBandPlan === '40m' ? '7.180 - 7.240 MHz' : '3.820 MHz'}</span>
                      </div>
                      <div className="p-2 rounded border border-slate-800 bg-slate-950">
                        <span className="text-sky-400 font-bold block">CW / QRP BOUNDARIES</span>
                        <span className="font-mono">{selectedBandPlan === '20m' ? '14.060 MHz (QRP)' : selectedBandPlan === '40m' ? '7.030 MHz (QRP)' : '3.560 MHz'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MODULE 3: SmartLog+ ADIF Logger */}
          {activeTab === 'smart_log' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl border border-emerald-800 bg-emerald-950/20 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-xs uppercase text-emerald-300 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-emerald-400" /> FIELD ADIF QUICK LOG & POTA SPOTTER
                  </h3>
                  <button
                    id="btn-export-adif"
                    onClick={handleExportADIF}
                    className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1 active:scale-95"
                  >
                    <Download className="w-3.5 h-3.5" /> EXPORT ADIF (.adi)
                  </button>
                </div>

                {/* Add Quick Contact Log Entry */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-[10px] uppercase opacity-75">Callsign</label>
                    <input
                      id="input-log-callsign"
                      type="text"
                      value={newCall}
                      onChange={(e) => setNewCall(e.target.value.toUpperCase())}
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-emerald-300 font-bold font-mono"
                      placeholder="e.g. K7POTA"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase opacity-75">Band & Mode</label>
                    <div className="flex gap-1">
                      <select id="select-log-band" value={newBand} onChange={(e) => setNewBand(e.target.value)} className="w-full px-1 py-1 bg-slate-900 border border-slate-700 rounded text-xs font-mono">
                        <option value="20m">20m</option>
                        <option value="40m">40m</option>
                        <option value="80m">80m</option>
                        <option value="15m">15m</option>
                      </select>
                      <select id="select-log-mode" value={newMode} onChange={(e) => setNewMode(e.target.value)} className="w-full px-1 py-1 bg-slate-900 border border-slate-700 rounded text-xs font-mono">
                        <option value="FT8">FT8</option>
                        <option value="SSB">SSB</option>
                        <option value="CW">CW</option>
                        <option value="JS8">JS8</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase opacity-75">POTA Ref</label>
                    <input
                      id="input-log-pota"
                      type="text"
                      value={newPota}
                      onChange={(e) => setNewPota(e.target.value.toUpperCase())}
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-amber-300 font-mono"
                      placeholder="K-0182"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      id="btn-add-log-entry"
                      onClick={handleAddLog}
                      className="w-full py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1 active:scale-95"
                    >
                      <Plus className="w-4 h-4" /> LOG QSO
                    </button>
                  </div>
                </div>

                {/* Log entries table */}
                <div className="space-y-1.5 pt-2">
                  <h4 className="font-bold text-[10px] uppercase text-slate-400">SESSION CONTACTS ({logs.length})</h4>
                  <div className="max-h-44 overflow-y-auto space-y-1">
                    {logs.map((l) => (
                      <div key={l.id} className="p-2 rounded border border-slate-800 bg-slate-900 flex items-center justify-between text-[11px] font-mono">
                        <div>
                          <span className="font-black text-emerald-400 mr-2">{l.callsign}</span>
                          <span className="text-cyan-300 mr-2">{l.band} {l.mode}</span>
                          <span className="text-amber-300 mr-2">{l.gridSquare}</span>
                          <span className="text-slate-400">{l.potaRef}</span>
                        </div>
                        <span className="text-[10px] text-slate-500">{l.timestamp}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MODULE 4: AI Field Radio Advisor */}
          {activeTab === 'smart_assistant' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl border border-emerald-700 bg-emerald-950/20 flex flex-col h-80">
                <div className="flex items-center justify-between border-b border-emerald-800/60 pb-2 mb-2">
                  <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                    <Bot className="w-4 h-4 text-emerald-400" /> SERVER-SIDE GEMINI FIELD RADIO ASSISTANT
                  </span>
                  <span className="text-[10px] text-emerald-400/80">
                    OPERATOR: {callsign || 'W7FIELD'} ({gridSquare})
                  </span>
                </div>

                {/* Chat Message Stream */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {aiChat.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-lg text-xs leading-relaxed max-w-[85%] ${
                        msg.sender === 'user'
                          ? 'ml-auto bg-cyan-900 text-cyan-100 border border-cyan-700'
                          : 'mr-auto bg-slate-900 text-slate-200 border border-slate-800'
                      }`}
                    >
                      <div className="text-[9px] text-current/60 mb-0.5 font-mono">
                        {msg.sender === 'user' ? 'YOU' : 'FIELDOPS-AI'} • {msg.time}
                      </div>
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                    </div>
                  ))}
                  {aiLoading && (
                    <div className="p-2 rounded bg-slate-900 text-amber-300 text-xs font-mono animate-pulse">
                      Awaiting AI service response…
                    </div>
                  )}
                </div>

                {/* Prompt Input */}
                <div className="pt-2 flex items-center gap-2">
                  <input
                    id="input-ai-prompt"
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendAiPrompt()}
                    placeholder="Ask about EFHW antenna, FT8 frequencies, POTA rules, or SWR..."
                    className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
                  />
                  <button
                    id="btn-send-ai-prompt"
                    onClick={handleSendAiPrompt}
                    disabled={aiLoading || !aiPrompt.trim()}
                    title={!aiPrompt.trim() ? 'Enter a question before sending' : 'Send question to the configured AI service'}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded flex items-center gap-1 active:scale-95 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" /> ASK
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-current/15 flex items-center justify-between bg-black/40">
          <span className="text-[10px] text-slate-400">
            Location • Distance / Bearing • Sun / Twilight • SmartDeploy
          </span>
          <button
            id="btn-close-roadmap-bottom"
            onClick={onClose}
            className="px-5 py-1.5 rounded bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-xs active:scale-95 shadow"
          >
            CLOSE SUITE
          </button>
        </div>

      </div>
    </div>
  );
};

interface CoordinateToolProps {
  operatingLocation: OperatingLocation;
}

interface DistanceBearingToolProps {
  operatingLocation: OperatingLocation;
}

interface SunTwilightToolProps {
  operatingLocation: OperatingLocation;
}

const SOLAR_EVENT_LABELS: ReadonlyArray<readonly [SolarEventName, string]> = [
  ['astronomicalDawn', 'ASTRONOMICAL DAWN'],
  ['nauticalDawn', 'NAUTICAL DAWN'],
  ['civilDawn', 'CIVIL DAWN'],
  ['sunrise', 'SUNRISE'],
  ['sunset', 'SUNSET'],
  ['civilDusk', 'CIVIL DUSK'],
  ['nauticalDusk', 'NAUTICAL DUSK'],
  ['astronomicalDusk', 'ASTRONOMICAL DUSK'],
];

const getLocalDateValue = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const SunTwilightTool: React.FC<SunTwilightToolProps> = ({ operatingLocation }) => {
  const [selectedDate, setSelectedDate] = useState(getLocalDateValue);
  const displayTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'system local time';
  const solarEvents = operatingLocation.coordinates
    ? calculateSolarEvents(operatingLocation.coordinates, selectedDate)
    : null;
  const originLabel = operatingLocation.provenance === 'manual'
    ? 'MANUAL OPERATING LOCATION'
    : operatingLocation.provenance === 'stale'
      ? 'STALE OPERATING LOCATION'
      : operatingLocation.coordinates
        ? 'CURRENT OPERATING LOCATION'
        : 'OPERATING LOCATION UNAVAILABLE';
  const formatEvent = (event: Date | null) => event
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(event)
    : 'DOES NOT OCCUR';

  return (
    <div id="field-tools-sun-twilight" className="space-y-4">
      <div className="p-4 rounded-xl border border-amber-700/70 bg-amber-950/20 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-black text-sm uppercase text-amber-300 flex items-center gap-2">
              <Sun className="w-4 h-4" /> SUN / TWILIGHT
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">Offline astronomical events for the operating location.</p>
          </div>
          <span className="px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-[10px] font-black text-amber-300 whitespace-nowrap">
            OFFLINE READY
          </span>
        </div>

        <div className="p-3 rounded-lg border border-slate-700 bg-slate-950/70">
          <span className="block text-[10px] uppercase text-slate-400">ORIGIN</span>
          <span className="block mt-1 font-black text-amber-300">{originLabel}</span>
          {operatingLocation.coordinates ? (
            <span className="block mt-1 font-mono text-slate-300">
              {operatingLocation.coordinates.lat.toFixed(6)}°, {operatingLocation.coordinates.lon.toFixed(6)}°
            </span>
          ) : (
            <span className="block mt-1 text-slate-500">No valid coordinates available.</span>
          )}
        </div>

        <label className="block text-[10px] uppercase text-slate-400">
          Selected date
          <input
            id="input-sun-twilight-date"
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="mt-1 w-full sm:w-auto min-w-52 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-amber-300 font-bold font-mono"
          />
        </label>

        <div className="rounded-lg border border-cyan-700/60 bg-cyan-950/20 p-3 text-[11px] text-cyan-200">
          DISPLAY TIMEZONE: <strong>{displayTimeZone}</strong> (ToughBook system local time). Calculations use UTC internally; no geographic timezone lookup is performed.
        </div>

        {!operatingLocation.coordinates ? (
          <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-5 text-center text-slate-300 font-bold uppercase">
            SOLAR EVENTS UNAVAILABLE: NO VALID OPERATING LOCATION
          </div>
        ) : solarEvents ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SOLAR_EVENT_LABELS.map(([eventName, label]) => (
              <div key={eventName} className="p-3 rounded-lg border border-slate-700 bg-slate-950/70 flex items-center justify-between gap-3 min-h-14">
                <span className="text-[10px] uppercase text-slate-400">{label}</span>
                <span className={`font-black text-sm text-right ${solarEvents.events[eventName] ? 'text-amber-200' : 'text-slate-500'}`}>
                  {formatEvent(solarEvents.events[eventName])}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-4 text-center text-amber-200 font-bold uppercase">
            SOLAR EVENTS UNAVAILABLE FOR SELECTED DATE
          </div>
        )}
      </div>
    </div>
  );
};

const DistanceBearingTool: React.FC<DistanceBearingToolProps> = ({ operatingLocation }) => {
  const [destinationLatitude, setDestinationLatitude] = useState('');
  const [destinationLongitude, setDestinationLongitude] = useState('');
  const [result, setResult] = useState<{
    distanceKm: number;
    distanceMiles: number;
    bearing: number | null;
  } | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const calculate = () => {
    setResult(null);
    if (!operatingLocation.coordinates) {
      setValidationMessage('DISTANCE UNAVAILABLE: OPERATING LOCATION HAS NO VALID FIX.');
      return;
    }

    const destination = parseCoordinates(destinationLatitude, destinationLongitude);
    if (!destination) {
      setValidationMessage('ENTER A VALID DESTINATION LATITUDE AND LONGITUDE.');
      return;
    }

    setValidationMessage(null);
    setResult({
      distanceKm: calculateDistanceKm(operatingLocation.coordinates, destination),
      distanceMiles: calculateDistanceMiles(operatingLocation.coordinates, destination),
      bearing: calculateInitialBearing(operatingLocation.coordinates, destination),
    });
  };

  const originLabel = operatingLocation.provenance === 'manual'
    ? 'MANUAL OPERATING LOCATION'
    : operatingLocation.provenance === 'stale'
      ? 'STALE OPERATING LOCATION'
      : operatingLocation.coordinates
        ? 'CURRENT OPERATING LOCATION'
        : 'OPERATING LOCATION UNAVAILABLE';

  return (
    <div id="field-tools-distance-bearing" className="space-y-4">
      <div className="p-4 rounded-xl border border-emerald-700/70 bg-emerald-950/20 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-black text-sm uppercase text-emerald-300 flex items-center gap-2">
              <Compass className="w-4 h-4" /> DISTANCE / BEARING
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">Great-circle distance from the current operating location.</p>
          </div>
          <span className="px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-[10px] font-black text-emerald-300 whitespace-nowrap">
            OFFLINE READY
          </span>
        </div>

        <div className="p-3 rounded-lg border border-slate-700 bg-slate-950/70">
          <span className="block text-[10px] uppercase text-slate-400">ORIGIN</span>
          <span className="block mt-1 font-black text-emerald-300">{originLabel}</span>
          {operatingLocation.coordinates ? (
            <span className="block mt-1 font-mono text-slate-300">
              {operatingLocation.coordinates.lat.toFixed(6)}°, {operatingLocation.coordinates.lon.toFixed(6)}°
            </span>
          ) : (
            <span className="block mt-1 text-slate-500">No valid coordinates available.</span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-[10px] uppercase text-slate-400">
            Destination latitude
            <input
              id="input-distance-destination-latitude"
              type="text"
              inputMode="decimal"
              value={destinationLatitude}
              onChange={(event) => setDestinationLatitude(event.target.value)}
              className="mt-1 w-full px-2.5 py-2 bg-slate-900 border border-slate-700 rounded text-emerald-300 font-bold font-mono"
              placeholder="-90 to 90"
            />
          </label>
          <label className="block text-[10px] uppercase text-slate-400">
            Destination longitude
            <input
              id="input-distance-destination-longitude"
              type="text"
              inputMode="decimal"
              value={destinationLongitude}
              onChange={(event) => setDestinationLongitude(event.target.value)}
              className="mt-1 w-full px-2.5 py-2 bg-slate-900 border border-slate-700 rounded text-emerald-300 font-bold font-mono"
              placeholder="-180 to 180"
            />
          </label>
        </div>

        <button
          id="btn-calculate-distance-bearing"
          onClick={calculate}
          className="w-full py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs active:scale-95"
        >
          CALCULATE DISTANCE / BEARING
        </button>

        {validationMessage && (
          <div id="distance-bearing-validation" className="rounded-lg border border-amber-600/70 bg-amber-950/30 p-3 text-amber-200 font-bold text-[11px]">
            {validationMessage}
          </div>
        )}

        {result && (
          <div id="distance-bearing-results" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border border-cyan-600/70 bg-cyan-950/30">
              <span className="block text-[10px] uppercase text-cyan-300">DISTANCE</span>
              <span className="block mt-1 font-black text-lg text-cyan-200">{result.distanceMiles.toFixed(2)} mi</span>
              <span className="block text-[11px] text-slate-400">{result.distanceKm.toFixed(2)} km</span>
            </div>
            <div className="p-3 rounded-lg border border-amber-600/70 bg-amber-950/30">
              <span className="block text-[10px] uppercase text-amber-300">INITIAL BEARING</span>
              <span className="block mt-1 font-black text-lg text-amber-200">
                {result.bearing === null ? 'N/A' : `${result.bearing.toFixed(1)}°`}
              </span>
            </div>
            <div className="p-3 rounded-lg border border-emerald-600/70 bg-emerald-950/30">
              <span className="block text-[10px] uppercase text-emerald-300">DIRECTION</span>
              <span className="block mt-1 font-black text-lg text-emerald-200">{compassDirection(result.bearing)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const CoordinateTool: React.FC<CoordinateToolProps> = ({ operatingLocation }) => {
  const freshness = operatingLocation.timestamps
    ? getTelemetryFreshness(operatingLocation.timestamps)
    : null;
  const sourceName = operatingLocation.source.name || operatingLocation.source.type;
  const statusLabel = operatingLocation.coordinates
    ? operatingLocation.provenance === 'manual'
      ? 'MANUAL LOCATION'
      : operatingLocation.status === 'stale' || operatingLocation.status === 'cached'
        ? 'STALE LAST FIX'
        : 'CURRENT GNSS LOCATION'
    : operatingLocation.status === 'connecting'
      ? 'ACQUIRING LOCATION'
      : operatingLocation.status === 'error'
        ? 'LOCATION ERROR'
        : 'LOCATION UNAVAILABLE';
  const statusDetail = operatingLocation.coordinates
    ? operatingLocation.provenance === 'manual'
      ? 'Operator-provided coordinates; not a satellite fix.'
      : operatingLocation.status === 'stale' || operatingLocation.status === 'cached'
        ? 'Last known coordinates retained; do not treat as current.'
        : 'Coordinates are from the active local location source.'
    : 'No valid coordinates are available from the selected local source.';

  return (
    <div id="field-tools-coordinate" className="space-y-4">
      <div className="p-4 rounded-xl border border-cyan-700/70 bg-cyan-950/20 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-black text-sm uppercase text-cyan-300 flex items-center gap-2">
              <MapPin className="w-4 h-4" /> OPERATING LOCATION
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">Coordinates for Field Tools calculations and activation context.</p>
          </div>
          <span className="px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-[10px] font-black text-cyan-300 whitespace-nowrap">
            {statusLabel}
          </span>
        </div>

        {operatingLocation.coordinates ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border border-slate-700 bg-slate-950/70">
              <span className="block text-[10px] uppercase text-slate-400">LATITUDE</span>
              <span className="block mt-1 text-lg font-black text-emerald-300">{operatingLocation.coordinates.lat.toFixed(6)}°</span>
            </div>
            <div className="p-3 rounded-lg border border-slate-700 bg-slate-950/70">
              <span className="block text-[10px] uppercase text-slate-400">LONGITUDE</span>
              <span className="block mt-1 text-lg font-black text-emerald-300">{operatingLocation.coordinates.lon.toFixed(6)}°</span>
            </div>
            <div className="p-3 rounded-lg border border-amber-600/60 bg-amber-950/30">
              <span className="block text-[10px] uppercase text-amber-300">MAIDENHEAD GRID</span>
              <span className="block mt-1 text-lg font-black tracking-widest text-amber-200">{operatingLocation.gridSquare || 'Unavailable'}</span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-5 text-center">
            <span className="block text-2xl font-black text-slate-500">--</span>
            <span className="block mt-1 font-bold uppercase text-slate-300">NO VALID COORDINATES</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
          <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/50">
            <span className="block uppercase text-slate-500">SOURCE</span>
            <span className="block mt-1 font-bold text-cyan-300">{sourceName}</span>
            <span className="block mt-0.5 text-slate-400">{operatingLocation.source.type}</span>
          </div>
          <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/50">
            <span className="block uppercase text-slate-500">FRESHNESS</span>
            <span className="block mt-1 font-bold text-amber-300">
              {freshness ? freshness.relativeAge : operatingLocation.provenance === 'manual' ? 'Operator entered' : 'Time unavailable'}
            </span>
            {freshness?.observedAtLabel && <span className="block mt-0.5 text-slate-400">Observed {freshness.observedAtLabel}</span>}
          </div>
        </div>

        <p className="border-t border-cyan-800/60 pt-3 text-[11px] text-slate-300">{statusDetail}</p>
      </div>
    </div>
  );
};
