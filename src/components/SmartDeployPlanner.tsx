import React, { useEffect, useState } from 'react';
import type { SmartDeployBrief } from '../../server/smartDeployBrief';
import { MODE_OPTIONS, ANTENNA_OPTIONS, getDeploymentOptionsForAntenna, getHeightOptionsForDeployment } from '../propagation/stationProfileCatalog';
import type { StationProfile } from '../propagation/domain';
import type { OperatingLocation } from '../location/operatingLocation';
import { getPropagationRegionOptions } from '../propagation/regionalDestinations';
import { resolvePlannedOperatingLocation, type ActivationTarget, type ManualPlannedOperatingLocationInput, type PlannedOperatingLocationSelection } from '../planning/smartDeployPlanning';
import { SmartDeployBriefView } from './SmartDeployBriefView';

interface SmartDeployPlannerProps { operatingLocation: OperatingLocation; stationProfile?: StationProfile; }
interface BriefListItem { briefId: string; generatedAtUtc: string; status: SmartDeployBrief['status']; activation: { reference: string; displayName?: string }; }
interface SotaDataStatus { state: 'AVAILABLE' | 'STALE' | 'UNAVAILABLE'; metadata: { downloadedAtUtc: string; sourceVersion: string | null } | null; refreshError?: string; }
type ActivationProgram = 'POTA' | 'SOTA';
type TargetResolutionStatus = 'live' | 'cached' | 'stale' | 'unknown' | 'unavailable' | 'invalid' | 'unsupported';

export const SmartDeployPlanner: React.FC<SmartDeployPlannerProps> = ({ operatingLocation, stationProfile }) => {
  const profile = stationProfile ?? { mode: 'SSB' as const, transmitPowerWatts: 10, antenna: { type: 'EFHW' as const }, deployment: { geometry: 'inverted_v' as const, heightCategory: '15_to_30_ft' as const } };
  const [activationProgram, setActivationProgram] = useState<ActivationProgram>('POTA');
  const [activationReference, setActivationReference] = useState('');
  const [resolvedTarget, setResolvedTarget] = useState<ActivationTarget | null>(null);
  const [targetResolutionStatus, setTargetResolutionStatus] = useState<TargetResolutionStatus | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [radio, setRadio] = useState('');
  const [antenna, setAntenna] = useState(profile.antenna.type);
  const [modes, setModes] = useState<string[]>([profile.mode]);
  const [power, setPower] = useState(String(profile.transmitPowerWatts));
  const [deploymentGeometry, setDeploymentGeometry] = useState(profile.deployment?.geometry || 'other');
  const [heightCategory, setHeightCategory] = useState(profile.deployment?.heightCategory || 'unknown');
  const [objective, setObjective] = useState('');
  const [plannedSiteSelection, setPlannedSiteSelection] = useState<PlannedOperatingLocationSelection>('provider_reference');
  const [manualPlannedSite, setManualPlannedSite] = useState<ManualPlannedOperatingLocationInput>({});
  const [propagationRegion, setPropagationRegion] = useState('');
  const [brief, setBrief] = useState<SmartDeployBrief | null>(null);
  const [recent, setRecent] = useState<BriefListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [sotaDataStatus, setSotaDataStatus] = useState<SotaDataStatus>({ state: 'UNAVAILABLE', metadata: null });
  const [sotaRefreshBusy, setSotaRefreshBusy] = useState(false);

  const loadRecent = async () => {
    try { const response = await fetch('/api/smartdeploy/briefs'); if (!response.ok) throw new Error('Recent plans are unavailable.'); const payload = await response.json(); setRecent((payload.briefs || []).map(toBriefListItem)); } catch { setError('Recent plans could not be loaded.'); }
  };
  const loadSotaDataStatus = async () => {
    try { const response = await fetch('/api/sota-data/status'); if (!response.ok) throw new Error('SOTA data status is unavailable.'); setSotaDataStatus(await response.json()); } catch { setSotaDataStatus({ state: 'UNAVAILABLE', metadata: null }); }
  };
  const refreshSotaData = async () => {
    setSotaRefreshBusy(true);
    try { const response = await fetch('/api/sota-data/refresh', { method: 'POST' }); const payload = await response.json(); setSotaDataStatus(payload); if (!response.ok) setError(payload.message || 'SOTA summit data refresh failed.'); } catch { setError('SOTA summit data refresh could not reach the local server.'); } finally { setSotaRefreshBusy(false); }
  };
  useEffect(() => { void Promise.all([loadRecent(), loadSotaDataStatus()]); }, []);

  const resolveTarget = async (): Promise<ActivationTarget | null> => {
    const reference = activationReference.trim();
    if (!reference) { setError(`Enter a ${activationProgram} reference.`); return null; }
    try {
      const response = await fetch('/api/smartdeploy/target', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetRequest: { program: activationProgram, reference } }) });
      const payload = await response.json();
      if (!response.ok || !payload.target) { setResolvedTarget(null); setTargetResolutionStatus(payload.status || 'unavailable'); setError(payload.message || payload.error || `${activationProgram} target resolution failed.`); return null; }
      setResolvedTarget(payload.target as ActivationTarget);
      setTargetResolutionStatus(payload.status as TargetResolutionStatus);
      if (payload.status === 'stale') setWarning(`${activationProgram} target data is stale but usable for planning.`);
      return payload.target as ActivationTarget;
    } catch { setResolvedTarget(null); setTargetResolutionStatus('unavailable'); setError(`${activationProgram} target resolution could not reach the local server.`); return null; }
  };

  const changeActivationProgram = (program: ActivationProgram) => {
    setActivationProgram(program); setActivationReference(''); setResolvedTarget(null); setTargetResolutionStatus(null); setError(null); setWarning(null);
  };

  const generate = async () => {
    setError(null); setWarning(null); setBrief(null);
    if (plannedSiteSelection === 'current_device' && (!operatingLocation.coordinates || operatingLocation.provenance === 'unavailable')) { setError('Generation blocked: current device location is unavailable for the selected planned site.'); return; }
    if (!activationReference.trim() || !start || !end || !radio.trim() || modes.length === 0 || !propagationRegion) { setError(`Enter a ${activationProgram} reference, mission window, radio, mode, and RF target region.`); return; }
    const startUtc = toUtc(start);
    const endUtc = toUtc(end);
    if (!startUtc || !endUtc) { setError('Mission start and end must be valid local date/time values.'); return; }
    setBusy(true);
    try {
      const activationTarget = await resolveTarget();
      if (!activationTarget) return;
      const planned = resolvePlannedOperatingLocation(activationTarget, operatingLocation, plannedSiteSelection, manualPlannedSite);
      if (planned.status !== 'resolved') { setError(planned.reason); return; }
      const response = await fetch('/api/smartdeploy/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetRequest: { program: activationProgram, reference: activationReference.trim() }, activationTarget, plannedOperatingLocation: planned.location, ...(operatingLocation.coordinates && operatingLocation.provenance !== 'unavailable' ? { currentDeviceLocation: operatingLocation } : {}), plannedOperatingLocationSelection: plannedSiteSelection, propagationObjective: { kind: 'regional', regionId: propagationRegion }, missionWindow: { start: startUtc, end: endUtc }, equipment: { radio: { name: radio.trim() }, antenna: { type: antenna }, modes, transmitPowerWatts: Number(power), deployment: { geometry: deploymentGeometry, heightCategory } }, ...(objective.trim() ? { objective: objective.trim() } : {}) }) });
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
    <div className="p-3 rounded-xl border border-cyan-700/60 bg-cyan-950/20 flex flex-wrap items-center justify-between gap-3">
      <div className="text-[11px]"><strong className="text-cyan-200">SOTA DATA</strong><span className="block text-slate-400">{sotaDataStatus.state === 'AVAILABLE' ? 'Available' : sotaDataStatus.state === 'STALE' ? 'Stale' : 'Unavailable'}{sotaDataStatus.metadata?.downloadedAtUtc ? ` • updated ${sotaDataStatus.metadata.downloadedAtUtc}` : ''}</span>{sotaDataStatus.refreshError && <span className="block text-amber-300">{sotaDataStatus.refreshError}</span>}</div>
      <button type="button" onClick={() => void refreshSotaData()} disabled={sotaRefreshBusy} className="px-3 py-2 rounded border border-cyan-600 text-cyan-200 font-bold text-[10px] disabled:opacity-50">{sotaRefreshBusy ? 'REFRESHING...' : 'REFRESH SOTA DATA'}</button>
    </div>
    <div className="p-4 rounded-xl border border-amber-600/70 bg-amber-950/20 space-y-3">
      <div><h3 className="font-black text-sm uppercase text-amber-300">SMARTDEPLOY / {activationProgram} PLAN</h3><p className="text-[11px] text-slate-400 mt-1">Resolve an activation target, then use the shared mission planning workflow.</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-[10px] uppercase text-slate-400">Activation program<select aria-label="Activation program" value={activationProgram} onChange={event => changeActivationProgram(event.target.value as ActivationProgram)} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-cyan-200 font-bold"><option value="POTA">POTA</option><option value="SOTA">SOTA</option></select></label>
        <label className="text-[10px] uppercase text-slate-400 sm:col-span-2">{activationProgram} reference<input aria-label={`${activationProgram} reference`} value={activationReference} onChange={event => { setActivationReference(event.target.value); setResolvedTarget(null); setTargetResolutionStatus(null); }} placeholder={activationProgram === 'POTA' ? 'US-1234' : 'W4V/SH-001'} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-amber-200 font-bold" /></label>
      </div>
      <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => void resolveTarget()} disabled={busy} className="px-3 py-2 rounded border border-cyan-600 text-cyan-200 font-bold text-[10px] disabled:opacity-50">RESOLVE {activationProgram} TARGET</button>{targetResolutionStatus && <span className={`text-[10px] uppercase font-bold ${targetResolutionStatus === 'stale' ? 'text-amber-300' : targetResolutionStatus === 'unavailable' ? 'text-red-300' : 'text-emerald-300'}`}>SOURCE: {targetResolutionStatus}</span>}</div>
      {resolvedTarget && <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/20 p-3 text-[11px] space-y-1"><strong className="text-emerald-300">RESOLVED TARGET</strong><span className="block text-slate-200">{resolvedTarget.reference} • {resolvedTarget.displayName || 'Unnamed target'}</span><span className="block font-mono text-slate-300">{resolvedTarget.coordinates.lat.toFixed(5)}, {resolvedTarget.coordinates.lon.toFixed(5)}{resolvedTarget.gridSquare ? ` • ${resolvedTarget.gridSquare}` : ''}{resolvedTarget.elevationM !== undefined ? ` • ${resolvedTarget.elevationM} m` : ''}</span><span className="block text-slate-400">{resolvedTarget.provenance.source?.name || resolvedTarget.provenance.source?.id || 'External source'} • {targetResolutionStatus || 'resolved'}</span></div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div className="rounded-lg border border-cyan-700/60 bg-cyan-950/20 p-3 text-[11px]"><strong className="text-cyan-200">CURRENT DEVICE LOCATION</strong><span className="block text-slate-400">{operatingLocation.gridSquare || 'Unavailable'} ({operatingLocation.provenance})</span>{operatingLocation.coordinates && <span className="block font-mono text-slate-300">{operatingLocation.coordinates.lat.toFixed(5)}, {operatingLocation.coordinates.lon.toFixed(5)}</span>}<span className="block mt-1 text-slate-500">Current GPS is context only unless explicitly selected.</span></div><div className="rounded-lg border border-amber-700/60 bg-amber-950/20 p-3 text-[11px]"><label className="text-[10px] uppercase text-slate-400">Planned operating site<select aria-label="Planned operating site" value={plannedSiteSelection} onChange={event => setPlannedSiteSelection(event.target.value as PlannedOperatingLocationSelection)} className="mt-1 w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-amber-200"><option value="provider_reference">{activationProgram} reference location</option><option value="current_device" disabled={!operatingLocation.coordinates || operatingLocation.provenance === 'unavailable'}>Use current device location</option><option value="manual">Enter planned site</option></select></label><span className="block mt-1 text-slate-400">{plannedSiteSelection === 'current_device' ? 'Current device becomes the transmitter site.' : plannedSiteSelection === 'manual' ? 'Enter the station deployment point below.' : `${activationProgram} reference; approximate planning point.`}</span></div></div>
      {plannedSiteSelection === 'manual' && <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/20 p-3 space-y-2"><p className="text-[10px] uppercase text-emerald-300">PLANNED OPERATING LOCATION</p><p className="text-[10px] text-slate-400">This is the transmitter/source location for propagation, solar, and site evidence. Enter a Maidenhead grid, or enter both latitude and longitude. If both are entered, they must agree.</p><div className="grid grid-cols-1 sm:grid-cols-3 gap-2"><label className="text-[10px] uppercase text-slate-400">Maidenhead grid<input aria-label="Planned site grid" value={manualPlannedSite.gridSquare || ''} onChange={event => setManualPlannedSite(current => ({ ...current, gridSquare: event.target.value }))} placeholder="FM07pk" className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-emerald-200 font-bold" /></label><label className="text-[10px] uppercase text-slate-400">Latitude<input aria-label="Planned site latitude" value={manualPlannedSite.latitude || ''} onChange={event => setManualPlannedSite(current => ({ ...current, latitude: event.target.value }))} placeholder="37.40000" inputMode="decimal" className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-emerald-200 font-bold" /></label><label className="text-[10px] uppercase text-slate-400">Longitude<input aria-label="Planned site longitude" value={manualPlannedSite.longitude || ''} onChange={event => setManualPlannedSite(current => ({ ...current, longitude: event.target.value }))} placeholder="-77.40000" inputMode="decimal" className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-emerald-200 font-bold" /></label></div></div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-[10px] uppercase text-slate-400">Radio<input aria-label="Radio" value={radio} onChange={event => setRadio(event.target.value)} placeholder="Radio model or name" className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-amber-200 font-bold" /></label>
        <label className="text-[10px] uppercase text-slate-400">Mission start (local input)<input aria-label="Mission start" type="datetime-local" value={start} onChange={event => setStart(event.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-cyan-200 font-bold" /></label>
        <label className="text-[10px] uppercase text-slate-400">Mission end (local input)<input aria-label="Mission end" type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-cyan-200 font-bold" /></label>
        <label className="text-[10px] uppercase text-slate-400">Antenna<select aria-label="Antenna" value={antenna} onChange={event => { const value = event.target.value as typeof antenna; setAntenna(value); setDeploymentGeometry(getDeploymentOptionsForAntenna(value)[0]?.id || 'other'); }} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-emerald-200 font-bold">{ANTENNA_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label className="text-[10px] uppercase text-slate-400">TX power (W)<input aria-label="Transmit power" type="number" min="1" value={power} onChange={event => setPower(event.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-emerald-200 font-bold" /></label>
        <label className="text-[10px] uppercase text-slate-400">RF target region<select aria-label="RF target region" value={propagationRegion} onChange={event => setPropagationRegion(event.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-cyan-200 font-bold"><option value="">Select region</option>{getPropagationRegionOptions().map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      </div>
      {(start || end) && <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-3 text-[10px] text-cyan-200">UTC WINDOW PREVIEW: {toUtc(start) || 'Start incomplete'} to {toUtc(end) || 'End incomplete'}</div>}
      <fieldset><legend className="text-[10px] uppercase text-slate-400 mb-1">Selected modes</legend><div className="flex flex-wrap gap-2">{MODE_OPTIONS.map(option => <label key={option.id} className="flex items-center gap-1 px-2 py-2 rounded border border-slate-700 bg-slate-900 text-[11px] text-slate-200"><input type="checkbox" checked={modes.includes(option.id)} onChange={() => toggleMode(option.id)} />{option.label}</label>)}</div></fieldset>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label className="text-[10px] uppercase text-slate-400">Deployment geometry<select aria-label="Deployment geometry" value={deploymentGeometry} onChange={event => setDeploymentGeometry(event.target.value as typeof deploymentGeometry)} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-200">{deploymentOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label className="text-[10px] uppercase text-slate-400">Height category<select aria-label="Height category" value={heightCategory} onChange={event => setHeightCategory(event.target.value as typeof heightCategory)} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-200">{getHeightOptionsForDeployment(deploymentGeometry).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label></div>
      <label className="text-[10px] uppercase text-slate-400 block">Objective (optional)<textarea aria-label="Objective" value={objective} onChange={event => setObjective(event.target.value)} rows={2} className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-200" /></label>
      <button type="button" onClick={generate} disabled={busy} className="w-full py-3 rounded bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-black text-xs">{busy ? 'GENERATING SMARTDEPLOY PLAN...' : 'GENERATE SMARTDEPLOY PLAN'}</button>
      {error && <div role="alert" className="rounded-lg border border-red-700/70 bg-red-950/30 p-3 text-red-200 text-[11px]">{error}</div>}{warning && <div role="status" className="rounded-lg border border-amber-700/70 bg-amber-950/30 p-3 text-amber-200 text-[11px]">{warning}</div>}
    </div>
    {recent.length > 0 && <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-3 space-y-2"><h3 className="font-black text-[11px] uppercase text-cyan-300">RECENT PLANS</h3>{recent.map(item => <div key={item.briefId} className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900/70 p-2"><button type="button" onClick={() => void loadBrief(item.briefId)} className="text-left flex-1 text-[11px] text-slate-200"><strong className="text-amber-200">{item.activation.reference}</strong> {item.activation.displayName || ''}<span className="block text-[10px] text-slate-500">{item.status} • generated {item.generatedAtUtc}</span></button><button type="button" aria-label={`Delete ${item.activation.reference}`} onClick={() => void deleteBrief(item.briefId)} className="px-3 py-2 rounded border border-red-800 text-red-300 text-[10px]">DELETE</button></div>)}</div>}
    {brief && <SmartDeployBriefView brief={brief} />}
  </div>;
};

function toUtc(value: string): string | null { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null; }
function formatApiError(payload: any): string { if (Array.isArray(payload?.issues) && payload.issues.length) return payload.issues.map((issue: any) => `${issue.path || 'request'}: ${issue.message}`).join(' '); return payload?.message || 'SmartDeploy request was rejected.'; }
function toBriefListItem(brief: any): BriefListItem { const activation = brief.schemaVersion === 2 ? brief.activation : brief.mission?.activationTarget; return { briefId: brief.briefId, generatedAtUtc: brief.generatedAtUtc, status: brief.status, activation: activation || { reference: 'Unknown activation' } }; }