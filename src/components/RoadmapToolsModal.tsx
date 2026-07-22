import React, { useState } from 'react';
import { 
  X, 
  Wrench, 
  Radio, 
  BookOpen, 
  Sparkles, 
  Calculator, 
  Compass, 
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
import { DEFAULT_LOG_ENTRIES } from '../data/defaultConfig';
import { playTacticalClick } from '../utils/audio';

interface RoadmapToolsModalProps {
  theme: UIThemeMode;
  audioEnabled: boolean;
  isOpen: boolean;
  onClose: () => void;
  callsign: string;
  gridSquare: string;
  initialTab?: string;
}

export const RoadmapToolsModal: React.FC<RoadmapToolsModalProps> = ({
  theme,
  audioEnabled,
  isOpen,
  onClose,
  callsign,
  gridSquare,
  initialTab = 'smart_deploy',
}) => {
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  // 1. SmartDeploy State (Antenna Length & NVIS vs DX Calculator)
  const [freqMHz, setFreqMHz] = useState<number>(14.074);
  const [velocityFactor, setVelocityFactor] = useState<number>(0.95);
  const [antennaType, setAntennaType] = useState<'dipole' | 'efhw' | 'vertical' | 'random_wire'>('dipole');

  // 2. SmartFrequency State
  const [selectedBandPlan, setSelectedBandPlan] = useState<string>('20m');

  // 3. SmartLog+ State
  const [logs, setLogs] = useState<LogEntry[]>(DEFAULT_LOG_ENTRIES);
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
      text: `Greetings ${callsign || 'Operator'}! FieldOps AI radio advisor online. Ask me about dipole tuning, NVIS propagation, POTA setup, SWR troubleshooting, or Q-codes!`,
      time: new Date().toLocaleTimeString(),
    },
  ]);
  const [aiLoading, setAiLoading] = useState(false);

  if (!isOpen) return null;

  const isNight = theme === 'night_vision';

  // SmartDeploy calculations
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
    let adif = `ADIF Export from FieldOpsDashboard v1.1.4\n<HEADER>\n<ADIF_VER:5>3.1.0\n<PROGRAMID:18>FieldOpsDashboard\n<EOH>\n`;
    logs.forEach((l) => {
      adif += `<CALL:${l.callsign.length}>${l.callsign} <BAND:${l.band.length}>${l.band} <MODE:${l.mode.length}>${l.mode} <FREQ:${l.frequency.length}>${l.frequency} <RST_SENT:${l.rstSent.length}>${l.rstSent} <RST_RCVD:${l.rstRcvd.length}>${l.rstRcvd} <GRIDSQUARE:${l.gridSquare.length}>${l.gridSquare} <MY_POTA_REF:${(l.potaRef||'').length}>${l.potaRef||''} <EOR>\n`;
    });

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 font-mono">
      <div className={`max-w-4xl w-full max-h-[90vh] flex flex-col rounded-2xl border ${
        isNight ? 'bg-black border-red-900 text-red-400' : 'bg-[#0F1115] border-zinc-800 text-zinc-100'
      } shadow-2xl overflow-hidden`}>
        
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400 animate-spin-slow" />
            <h2 className="font-black text-base uppercase tracking-wider text-zinc-100">
              ROADMAP SMART MODULES (v1.2 FIELD SUITE)
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
            id="tab-smart-deploy"
            onClick={() => setActiveTab('smart_deploy')}
            className={`py-2.5 px-4 font-bold text-xs border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-all ${
              activeTab === 'smart_deploy' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wrench className="w-4 h-4" /> 🔧 SmartDeploy (ANTENNA CALCULATOR)
          </button>

          <button
            id="tab-smart-frequency"
            onClick={() => setActiveTab('smart_frequency')}
            className={`py-2.5 px-4 font-bold text-xs border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-all ${
              activeTab === 'smart_frequency' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-4 h-4" /> 📡 SmartFrequency (BAND ADVISOR)
          </button>

          <button
            id="tab-smart-log"
            onClick={() => setActiveTab('smart_log')}
            className={`py-2.5 px-4 font-bold text-xs border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-all ${
              activeTab === 'smart_log' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4" /> 📝 SmartLog+ (ADIF FIELD LOGGER)
          </button>

          <button
            id="tab-smart-assistant"
            onClick={() => setActiveTab('smart_assistant')}
            className={`py-2.5 px-4 font-bold text-xs border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-all ${
              activeTab === 'smart_assistant' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bot className="w-4 h-4 text-emerald-400" /> 🤖 AI Field Radio Advisor
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4 text-xs">
          
          {/* MODULE 1: SmartDeploy Antenna Calculator */}
          {activeTab === 'smart_deploy' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl border border-amber-600/60 bg-amber-950/20 space-y-3">
                <h3 className="font-black text-xs uppercase text-amber-300 flex items-center gap-2">
                  <Calculator className="w-4 h-4" /> FIELD ANTENNA CUTTING & NVIS TAKEOFF CALCULATOR
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase opacity-75 mb-0.5">Target Frequency (MHz)</label>
                    <input
                      id="input-deploy-freq"
                      type="number"
                      step="0.001"
                      value={freqMHz}
                      onChange={(e) => setFreqMHz(parseFloat(e.target.value) || 14.074)}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-amber-300 font-bold font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase opacity-75 mb-0.5">Antenna Topology</label>
                    <select
                      id="select-deploy-topology"
                      value={antennaType}
                      onChange={(e) => setAntennaType(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-cyan-300 font-bold font-mono"
                    >
                      <option value="dipole">Half-Wave Dipole (Driven)</option>
                      <option value="efhw">End-Fed Half-Wave (EFHW 49:1)</option>
                      <option value="vertical">Quarter-Wave Vertical (1/4 λ)</option>
                      <option value="random_wire">Random Wire (Non-Resonant)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase opacity-75 mb-0.5">Wire Velocity Factor (VF)</label>
                    <select
                      id="select-deploy-vf"
                      value={velocityFactor}
                      onChange={(e) => setVelocityFactor(parseFloat(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-emerald-300 font-bold font-mono"
                    >
                      <option value={0.95}>0.95 (Standard Insulated Stranded Copper)</option>
                      <option value={0.98}>0.98 (Bare Copper Field Wire)</option>
                      <option value={0.92}>0.92 (Heavy Duty Tactical Camo Wire)</option>
                    </select>
                  </div>
                </div>

                {/* Calculation Results Card */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div className="p-3 rounded-lg border border-emerald-600/80 bg-emerald-950/40 text-emerald-300 space-y-1">
                    <span className="text-[10px] uppercase opacity-80 block">TOTAL RESONANT WIRE LENGTH</span>
                    <div className="font-black text-xl text-emerald-300">
                      {totalFeet.toFixed(2)} FT ({totalMeters.toFixed(2)} METERS)
                    </div>
                    <span className="text-[10px] text-slate-300 block">
                      Formula: L (ft) = (468 / {freqMHz} MHz) × {velocityFactor} VF
                    </span>
                  </div>

                  <div className="p-3 rounded-lg border border-cyan-600/80 bg-cyan-950/40 text-cyan-300 space-y-1">
                    <span className="text-[10px] uppercase opacity-80 block">LEG / RADIAL CUT LENGTH</span>
                    <div className="font-black text-xl text-cyan-300">
                      {legFeet.toFixed(2)} FT ({legMeters.toFixed(2)} METERS)
                    </div>
                    <span className="text-[10px] text-slate-300 block">
                      {antennaType === 'dipole' ? 'Cut 2 identical wire legs for center feed point' : 'Single continuous wire radiator'}
                    </span>
                  </div>
                </div>

                {/* NVIS vs DX Angle Guidance */}
                <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/80 space-y-1.5 text-[11px]">
                  <h4 className="font-bold text-amber-300 uppercase">PROXIMITY & GROUND ANGLE RECOMMENDATIONS</h4>
                  <p className="text-slate-300">
                    • <strong>NVIS (Near Vertical Incidence Skywave)</strong>: Mount wire horizontal at 8 to 15 feet off ground. Excellent for 40m/80m coverage within 300 miles over mountains.
                  </p>
                  <p className="text-slate-300">
                    • <strong>DX Long Distance</strong>: Mount inverted-V or end-fed at least 35 feet high for low takeoff angle (&lt;20°).
                  </p>
                </div>
              </div>
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
                      ⚡ AI calculating propagation & antenna response...
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
                    disabled={aiLoading}
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
            SmartDeploy • SmartFrequency • SmartLog+ • FieldOps AI
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
