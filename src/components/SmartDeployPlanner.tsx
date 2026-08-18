import React, { useEffect, useState } from 'react';
import type { SmartDeployBrief } from '../../server/smartDeployBrief';
import { MODE_OPTIONS, ANTENNA_OPTIONS, getDeploymentOptionsForAntenna, getHeightOptionsForDeployment } from '../propagation/stationProfileCatalog';
import type { StationProfile } from '../propagation/domain';
import type { OperatingLocation } from '../location/operatingLocation';
import { SmartDeployBriefView } from './SmartDeployBriefView';

interface SmartDeployPlannerProps { operatingLocation: OperatingLocation; stationProfile?: StationProfile; }
interface BriefListItem { briefId: string; generatedAtUtc: string; status: SmartDeployBrief['status']; mission: SmartDeployBrief['mission']; }

export const SmartDeployPlanner: React.FC<SmartDeployPlannerProps> = ({ operatingLocation, stationProfile }) => {
  const profile = stationProfile ?? { mode: 'SSB' as const, transmitPowerWatts: 10, antenna: { type: 'EFHW' as const }, deployment: { geometry: 'inverted_v' as const, heightCategory: '15_to_30_ft' as const } };
  const [potaReference, setPotaReference] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [radio, setRadio] = useState('');
  const [antenna, setAntenna] = useState(profile.antenna.type);
  const [modes, setModes] = useState<string[]>([profile.mode]);
  const [power, setPower] = useState(String(profile.transmitPowerWatts));
  const [deploymentGeometry, setDeploymentGeometry] = useState(profile.deployment?.geometry || 'other');
  const [heightCategory, setHeightCategory] = useState(profile.deployment?.heightCategory || 'unknown');
  const [objective, setObjective] = useState('');
  const [brief, setBrief] = useState<SmartDeployBrief | null>(null);
  const [recent, setRecent] = useState<BriefListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const loadRecent = async () => {
    try { const response = await fetch('/api/smartdeploy/briefs'); if (!response.ok) throw new Error('Recent plans are unavailable.'); const payload = await response.json(); setRecent(payload.briefs || []); } catch { setError('Recent plans could not be loaded.'); }
  };
  useEffect(() => { void loadRecent(); }, []);

  const generate = async () => {
    setError(null); setWarning(null); setBrief(null);
    if (!operatingLocation.coordinates || operatingLocation.provenance === 'unavailable') { setError('Generation blocked: no valid operating coordinates are available.'); return; }
    if (!potaReference.trim() || !start || !end || !radio.trim() || modes.length === 0) { setError('Enter a POTA reference, mission window, radio, and at least one mode.'); return; }
    const startUtc = toUtc(start);
    const endUtc = toUtc(end);
    if (!startUtc || !endUtc) { setError('Mission start and end must be valid local date/time values.'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/smartdeploy/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ potaReference, missionWindow: { start: startUtc, end: endUtc }, operatingLocation, equipment: { radio: { name: radio.trim() }, antenna: { type: antenna }, modes, transmitPowerWatts: Number(power), deployment: { geometry: deploymentGeometry, heightCategory } }, ...(objective.trim() ? { objective: objective.trim() } : {}) }) });
      const payload = await response.json();
      if (!response.ok) { setError(formatApiError(payload)); return; }
      setBrief(payload.brief as SmartDeployBrief); if (payload.persistence?.status === 'warning') setWarning(payload.persistence.warning); await loadRecent();
    } catch { setError('SmartDeploy generation could not reach the local server.'); } finally { setBusy(false); }
  };

  const loadBrief = async (id: string) => { setError(null); try { const response = await fetch(`/api/smartdeploy/briefs/${encodeURIComponent(id)}`); const payload = await response.json(); if (!response.ok) throw new Error(payload.message || 'Stored brief could not be loaded.'); setBrief(payload.brief as SmartDeployBrief); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Stored brief could not be loaded.'); } };
  const deleteBrief = async (id: string) => { setError(null); try { const response = await fetch(`/api/smartdeploy/briefs/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!response.ok) throw new Error('Stored brief could not be deleted.'); if (brief?.briefId === id) setBrief(null); await loadRecent(); } catch { setError('Stored brief could not be deleted.'); } };
  const toggleMode = (mode: string) => setModes(current => current.includes(mode) ? current.filter(item => item !== mode) : [...current, mode]);
  const deploymentOptions = getDeploymentOptionsForAntenna(antenna);

  return <div id="smartdeploy-planner" className="space-y-4">
    <div className="p-4 rounded-xl border border-amber-600/70 bg-amber-950/20 space-y-3">
      <div><h3 className="font-black text-sm uppercase text-amber-300">SMARTDEPLOY / POTA PLAN</h3><p className="text-[11px] text-slate-400 mt-1">Activation, mission window, operating location, station, then one intentional generation.</p></div>
      <div className="rounded-lg border border-cyan-700/60 bg-cyan-950/20 p-3 text-[11px]">OPERATING LOCATION: <strong className="text-cyan-200">{operatingLocation.gridSquare || 'Unavailable'}</strong> <span className="text-slate-400">({operatingLocation.provenance})</span>{operatingLocation.coordinates && <span className="block font-mono text-slate-300">{operatingLocation.coordinates.lat.toFixed(5)}, {operatingLocation.coordinates.lon.toFixed(5)}</span>}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-[10px] uppercase text-slate-400">POTA reference<input aria-label="POTA reference" value={potaReference} onChange={event => setPotaReference(event.target.value)} placeholder="US-1234" className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-amber-200 font-bold" /></label>
        <label className="text-[10px] uppercase text-slate-400">Radio<input aria-label="Radio" value={radio} onChange={event => setRadio(event.target.value)} placeholder="Radio model or name" className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-amber-200 font-bold" /></label>
        <label className="text-[10px] uppercase text-slate-400">Mission start (local input)<input aria-label="Mission start" type="datetime-local" value={start} onChange={event => setStart(event.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-cyan-200 font-bold" /></label>
        <label className="text-[10px] uppercase text-slate-400">Mission end (local input)<input aria-label="Mission end" type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-cyan-200 font-bold" /></label>
        <label className="text-[10px] uppercase text-slate-400">Antenna<select aria-label="Antenna" value={antenna} onChange={event => { const value = event.target.value as typeof antenna; setAntenna(value); setDeploymentGeometry(getDeploymentOptionsForAntenna(value)[0]?.id || 'other'); }} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-emerald-200 font-bold">{ANTENNA_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label className="text-[10px] uppercase text-slate-400">TX power (W)<input aria-label="Transmit power" type="number" min="1" value={power} onChange={event => setPower(event.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-emerald-200 font-bold" /></label>
      </div>
      {(start || end) && <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-3 text-[10px] text-cyan-200">UTC WINDOW PREVIEW: {toUtc(start) || 'Start incomplete'} to {toUtc(end) || 'End incomplete'}</div>}
      <fieldset><legend className="text-[10px] uppercase text-slate-400 mb-1">Selected modes</legend><div className="flex flex-wrap gap-2">{MODE_OPTIONS.map(option => <label key={option.id} className="flex items-center gap-1 px-2 py-2 rounded border border-slate-700 bg-slate-900 text-[11px] text-slate-200"><input type="checkbox" checked={modes.includes(option.id)} onChange={() => toggleMode(option.id)} />{option.label}</label>)}</div></fieldset>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label className="text-[10px] uppercase text-slate-400">Deployment geometry<select aria-label="Deployment geometry" value={deploymentGeometry} onChange={event => setDeploymentGeometry(event.target.value as typeof deploymentGeometry)} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-200">{deploymentOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label className="text-[10px] uppercase text-slate-400">Height category<select aria-label="Height category" value={heightCategory} onChange={event => setHeightCategory(event.target.value as typeof heightCategory)} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-200">{getHeightOptionsForDeployment(deploymentGeometry).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label></div>
      <label className="text-[10px] uppercase text-slate-400 block">Objective (optional)<textarea aria-label="Objective" value={objective} onChange={event => setObjective(event.target.value)} rows={2} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-200" /></label>
      <button type="button" onClick={generate} disabled={busy} className="w-full py-3 rounded bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-black text-xs">{busy ? 'GENERATING SMARTDEPLOY PLAN...' : 'GENERATE SMARTDEPLOY PLAN'}</button>
      {error && <div role="alert" className="rounded-lg border border-red-700/70 bg-red-950/30 p-3 text-red-200 text-[11px]">{error}</div>}{warning && <div role="status" className="rounded-lg border border-amber-700/70 bg-amber-950/30 p-3 text-amber-200 text-[11px]">{warning}</div>}
    </div>
    {recent.length > 0 && <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-3 space-y-2"><h3 className="font-black text-[11px] uppercase text-cyan-300">RECENT PLANS</h3>{recent.map(item => <div key={item.briefId} className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900/70 p-2"><button type="button" onClick={() => void loadBrief(item.briefId)} className="text-left flex-1 text-[11px] text-slate-200"><strong className="text-amber-200">{item.mission.activationTarget.reference}</strong> {item.mission.activationTarget.displayName || ''}<span className="block text-[10px] text-slate-500">{item.mission.missionWindow.start} • {item.status} • generated {item.generatedAtUtc}</span></button><button type="button" aria-label={`Delete ${item.mission.activationTarget.reference}`} onClick={() => void deleteBrief(item.briefId)} className="px-3 py-2 rounded border border-red-800 text-red-300 text-[10px]">DELETE</button></div>)}</div>}
    {brief && <SmartDeployBriefView brief={brief} />}
  </div>;
};

function toUtc(value: string): string | null { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null; }
function formatApiError(payload: any): string { if (Array.isArray(payload?.issues) && payload.issues.length) return payload.issues.map((issue: any) => `${issue.path || 'request'}: ${issue.message}`).join(' '); return payload?.message || 'SmartDeploy request was rejected.'; }