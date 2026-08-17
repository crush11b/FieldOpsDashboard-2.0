import React, { useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import type { DashboardConfig, UIThemeMode } from '../types';
import type { OperatingLocation } from '../location/operatingLocation';
import { fetchPropagationGuidance } from '../propagation/guidanceClient';
import type { PropagationGuidanceResponse } from '../../server/propagationGuidance';
import { PROPAGATION_GUIDANCE_BANDS } from '../propagation/domain';
import { PROPAGATION_REGION_CATALOG, type PropagationRegionId } from '../propagation/regionalDestinations';
import { ANTENNA_OPTIONS, getDeploymentOptionsForAntenna, getHeightOptionsForDeployment, MODE_OPTIONS, POWER_PRESET_OPTIONS } from '../propagation/stationProfileCatalog';

interface Props { config: DashboardConfig; operatingLocation: OperatingLocation; theme: UIThemeMode; audioEnabled: boolean; onUpdateConfig: (updated: DashboardConfig) => void; }
const modes: Record<string, string> = { online_live_enhanced: 'LIVE ENHANCED', online_partial: 'ONLINE / PARTIAL', offline_cached_modeled: 'CACHED + MODEL', offline_modeled: 'OFFLINE / MODEL', observed_only: 'OBSERVED ONLY', unavailable: 'UNAVAILABLE' };
const ratings: Record<string, string> = { EXCELLENT: 'Excellent', GOOD: 'Good', FAIR: 'Fair', POOR: 'Poor', UNAVAILABLE: 'Unavailable' };

export const VOACAPPropagationWidget: React.FC<Props> = ({ config, operatingLocation, theme, onUpdateConfig }) => {
  const profile = config.propagation.stationProfile;
  const region = config.propagation.destinationRegion;
  const [result, setResult] = useState<PropagationGuidanceResponse | null>(null);
  const [selectedBand, setSelectedBand] = useState('20m');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refresh = async () => {
    const id = ++requestId.current;
    controller.current?.abort();
    if (!operatingLocation.coordinates || operatingLocation.provenance === 'unavailable') { setError('OPERATING LOCATION UNAVAILABLE'); return; }
    const next = new AbortController(); controller.current = next; setLoading(true); setError(null);
    try {
      const response = await fetchPropagationGuidance(region, operatingLocation, next.signal);
      if (!next.signal.aborted && id === requestId.current) { setResult(response); setSelectedBand(old => response.assessments.some(item => item.band === old) ? old : response.assessments[0].band); }
    } catch (reason) { if (!next.signal.aborted && id === requestId.current) setError(reason instanceof Error ? reason.message : 'UPDATE UNAVAILABLE'); }
    finally { if (id === requestId.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); return () => controller.current?.abort(); }, [region, profile.mode, profile.transmitPowerWatts, profile.antenna.type, profile.deployment.geometry, profile.deployment.heightCategory, operatingLocation.coordinates?.lat, operatingLocation.coordinates?.lon, operatingLocation.provenance]);
  useEffect(() => { const timer = window.setInterval(() => void refresh(), 120000); return () => window.clearInterval(timer); }, [region, profile.mode, profile.transmitPowerWatts, profile.antenna.type, profile.deployment.geometry, profile.deployment.heightCategory, operatingLocation.coordinates?.lat, operatingLocation.coordinates?.lon, operatingLocation.provenance]);
  const updateProfile = (patch: Partial<typeof profile>) => onUpdateConfig({ ...config, propagation: { ...config.propagation, stationProfile: { ...profile, ...patch } } });
  const active = result?.assessments.find(item => item.band === selectedBand) ?? result?.assessments[0];
  const basis = active?.decisionBasis as Record<string, any> | undefined;
  const regionLabel = PROPAGATION_REGION_CATALOG.find(item => item.id === region)?.label ?? region;
  const card = theme === 'night_vision' ? 'bg-black border-red-900 text-red-500' : theme === 'sunlight' ? 'bg-white border-amber-400 text-slate-900' : 'bg-zinc-900/50 border-zinc-800 text-zinc-100';
  const bands = result?.assessments ?? PROPAGATION_GUIDANCE_BANDS.map(band => ({ band, rating: 'UNAVAILABLE' as const, confidence: 'unavailable' as const }));
  return <div className={`border ${card} rounded-2xl p-4 sm:p-5 shadow-lg font-mono space-y-3`}>
    <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-3"><div className="flex items-center gap-2"><Activity className="w-4 h-4 text-amber-400" /><h3 className="text-xs font-bold uppercase tracking-widest">REGIONAL HF BAND GUIDANCE</h3></div><div className="flex items-center gap-2 text-[10px]"><span className="rounded border px-2 py-1">{active ? modes[active.operatingMode] : loading ? 'CALCULATING' : 'UNAVAILABLE'}</span><button aria-label="Refresh propagation guidance" onClick={() => void refresh()} className="rounded border border-slate-700 bg-slate-800 p-1"><RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /></button></div></div>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
      <label>Destination<select aria-label="Propagation destination" value={region} onChange={event => onUpdateConfig({ ...config, propagation: { ...config.propagation, destinationRegion: event.target.value as PropagationRegionId } })} className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2">{PROPAGATION_REGION_CATALOG.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Mode<select aria-label="Propagation mode" value={profile.mode} onChange={event => updateProfile({ mode: event.target.value as typeof profile.mode })} className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2">{MODE_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Power<select aria-label="Transmit power" value={POWER_PRESET_OPTIONS.find(item => item.watts === profile.transmitPowerWatts)?.id ?? 'custom'} onChange={event => { const watts = POWER_PRESET_OPTIONS.find(item => item.id === event.target.value)?.watts; if (watts) updateProfile({ transmitPowerWatts: watts }); }} className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2">{POWER_PRESET_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Antenna<select aria-label="Antenna type" value={profile.antenna.type} onChange={event => updateProfile({ antenna: { type: event.target.value as typeof profile.antenna.type } })} className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2">{ANTENNA_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Deployment<select aria-label="Deployment geometry" value={profile.deployment.geometry} onChange={event => updateProfile({ deployment: { ...profile.deployment, geometry: event.target.value as typeof profile.deployment.geometry } })} className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2">{getDeploymentOptionsForAntenna(profile.antenna.type).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Height<select aria-label="Antenna height" value={profile.deployment.heightCategory} onChange={event => updateProfile({ deployment: { ...profile.deployment, heightCategory: event.target.value as typeof profile.deployment.heightCategory } })} className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2">{getHeightOptionsForDeployment(profile.deployment.geometry).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    </div>
    <div className="flex flex-wrap gap-2 text-[10px]"><span className="rounded border px-2 py-1">MODEL: {result?.model.status ?? 'pending'}</span><span className="rounded border px-2 py-1">NOAA: {result?.spaceWeather.status ?? 'pending'}</span><span className="rounded border px-2 py-1">PSK: {active?.provenance.observedSourceState ?? 'pending'}</span><span className="rounded border px-2 py-1">DESTINATION: {regionLabel}</span></div>
    {!result && loading && <p className="rounded border border-amber-500/30 p-3 text-xs">CALCULATING GUIDANCE...</p>}{error && <p className="rounded border border-red-500/40 p-3 text-xs">{result ? `UPDATE UNAVAILABLE - LAST RESULT RETAINED: ${error}` : error}</p>}
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">{bands.map(item => <button key={item.band} aria-pressed={selectedBand === item.band} onClick={() => setSelectedBand(item.band)} className={`min-h-[96px] rounded-xl border p-3 text-left ${selectedBand === item.band ? 'ring-2 ring-cyan-400' : 'border-zinc-800'}`}><strong className="block text-sm">{item.band}</strong><span className="mt-2 block text-[10px] uppercase">{ratings[item.rating]}</span><span className="mt-2 block text-[10px]">Confidence: {item.confidence.replace('_', ' ')}</span></button>)}</div>
    {active && result && <div className="rounded-xl border border-cyan-800/80 bg-cyan-950/30 p-3 text-xs space-y-2"><strong className="text-base text-cyan-300">{active.band} BAND</strong><span className="ml-2 rounded bg-cyan-900 px-2 py-1">{ratings[active.rating]} / {active.confidence.replace('_', ' ')}</span><span className="ml-2 text-zinc-400">{modes[active.operatingMode]}</span><p>{active.reasons.slice(0, 3).map(reason => reason.text).join(' ') || 'No supporting reason was returned.'}</p>{active.cautions.length > 0 && <p className="text-amber-200">Caution: {active.cautions.map(item => item.text).join(' ')}</p>}<p className="text-zinc-400">Model: {basis?.model?.medianBcrPercent ?? 'Unavailable'}% median BCR, {basis?.model?.successfulSampleCount ?? 0}/{basis?.model?.sampleCount ?? 0} samples. {active.band === '6m' ? 'Not supported by P.533.' : ''}</p><p className="text-zinc-400">PSK: {basis?.observedRf?.reportCount ? `${basis.observedRf.reportCount} reports observed.` : 'Live - no matching digital reports in the last 15 min.'} NOAA: {basis?.environment?.state ?? result.spaceWeather.status}. P.533 model SSN: {result.model.ssn.value ?? 'Unavailable'}.</p><p className="text-[10px] text-zinc-500">Updated {new Date(result.evaluatedAtUtc).toLocaleTimeString()}</p></div>}
  </div>;
};
