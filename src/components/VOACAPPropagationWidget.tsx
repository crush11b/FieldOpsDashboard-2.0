import React, { useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import type { DashboardConfig, UIThemeMode } from '../types';
import type { OperatingLocation } from '../location/operatingLocation';
import { fetchPropagationGuidance, confidenceLabel, observedRfSummaryLabel } from '../propagation/guidanceClient';
import type { PropagationGuidanceResponse } from '../../server/propagationGuidance';
import { PROPAGATION_GUIDANCE_BANDS, type PropagationConfidence, type PropagationRating, type StationProfile } from '../propagation/domain';
import { PROPAGATION_REGION_CATALOG, type PropagationRegionId } from '../propagation/regionalDestinations';
import { ANTENNA_OPTIONS, getDeploymentOptionsForAntenna, getHeightOptionsForDeployment, MODE_OPTIONS, normalizeStationProfile, POWER_PRESET_OPTIONS } from '../propagation/stationProfileCatalog';

interface Props {
  config: DashboardConfig;
  operatingLocation: OperatingLocation;
  theme: UIThemeMode;
  audioEnabled: boolean;
  onPersistConfig: (updated: DashboardConfig) => Promise<DashboardConfig | null>;
}

export const OPERATING_MODE_LABELS = {
  online_live_enhanced: 'LIVE ENHANCED', online_partial: 'ONLINE / PARTIAL',
  offline_cached_modeled: 'CACHED + MODEL', offline_modeled: 'OFFLINE / MODEL',
  observed_only: 'OBSERVED ONLY', unavailable: 'UNAVAILABLE',
} as const;
export const RATING_LABELS = { EXCELLENT: 'Excellent', GOOD: 'Good', FAIR: 'Fair', POOR: 'Poor', UNAVAILABLE: 'Unavailable' } as const;
export const CONFIDENCE_DISPLAY_LABELS: Record<PropagationConfidence, string> = {
  high: 'HIGH', medium: 'MEDIUM', low: 'LOW', modeled_only: 'MODELED', unavailable: 'UNAVAILABLE',
};
const LOCAL_NVIS_DEFERRED_MESSAGE = 'Local / NVIS guidance is recognized but its evaluator is deferred; choose a supported destination for operational recommendations.';

export function getBandRatingClasses(rating: PropagationRating, theme: UIThemeMode, selected: boolean): string {
  void theme;
  const ratingClasses: Record<PropagationRating, string> = {
    EXCELLENT: 'fo-rating-excellent font-bold',
    GOOD: 'fo-rating-good font-semibold',
    FAIR: 'fo-rating-fair font-semibold',
    POOR: 'fo-rating-poor',
    UNAVAILABLE: 'fo-rating-unavailable',
  };
  return `${ratingClasses[rating]} ${selected ? 'fo-rating-selected' : ''}`.trim();
}

export function normalizedProfileUpdate(profile: StationProfile, patch: Partial<StationProfile>): StationProfile {
  return normalizeStationProfile({ ...profile, ...patch, antenna: patch.antenna ?? profile.antenna, deployment: patch.deployment ?? profile.deployment });
}

function ageLabel(value: string | null | undefined): string {
  if (!value) return 'time unavailable';
  const ageMinutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60000));
  return ageMinutes < 1 ? 'just now' : `${ageMinutes} min ago`;
}

function labelModeCounts(modeCounts: Readonly<Record<string, number>>): string {
  return Object.entries(modeCounts).filter(([, count]) => count > 0).map(([mode, count]) => `${mode} (${count})`).join(', ') || 'none reported';
}

export const VOACAPPropagationWidget: React.FC<Props> = ({ config, operatingLocation, theme, onPersistConfig }) => {
  const profile = config.propagation.stationProfile;
  const region = config.propagation.destinationRegion;
  const [result, setResult] = useState<PropagationGuidanceResponse | null>(null);
  const [selectedBand, setSelectedBand] = useState('20m');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const persistenceId = useRef(0);

  const refresh = async () => {
    const id = ++requestId.current;
    controller.current?.abort();
    if (!operatingLocation.coordinates || operatingLocation.provenance === 'unavailable') {
      setError('LOCATION REQUIRED');
      setLoading(false);
      return;
    }
    const next = new AbortController();
    controller.current = next;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchPropagationGuidance(region, operatingLocation, next.signal);
      if (!next.signal.aborted && id === requestId.current) {
        setResult(response);
        setSelectedBand(old => response.assessments.some(item => item.band === old) ? old : response.assessments[0].band);
      }
    } catch (reason) {
      if (!next.signal.aborted && id === requestId.current) setError(reason instanceof Error ? reason.message : 'UPDATE UNAVAILABLE');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, [region, profile.mode, profile.transmitPowerWatts, profile.antenna.type, profile.deployment.geometry, profile.deployment.heightCategory, operatingLocation.coordinates?.lat, operatingLocation.coordinates?.lon, operatingLocation.provenance]);
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 120000);
    return () => window.clearInterval(timer);
  }, [region, profile.mode, profile.transmitPowerWatts, profile.antenna.type, profile.deployment.geometry, profile.deployment.heightCategory, operatingLocation.coordinates?.lat, operatingLocation.coordinates?.lon, operatingLocation.provenance]);

  const persist = async (updated: DashboardConfig) => {
    const id = ++persistenceId.current;
    const saved = await onPersistConfig(updated);
    if (id !== persistenceId.current) return;
    if (saved) setError(null);
  };
  const persistProfile = (patch: Partial<StationProfile>) => void persist({ ...config, propagation: { ...config.propagation, stationProfile: normalizedProfileUpdate(profile, patch) } });
  const persistDestination = (destinationRegion: PropagationRegionId) => void persist({ ...config, propagation: { ...config.propagation, destinationRegion } });
  const regionLabel = PROPAGATION_REGION_CATALOG.find(item => item.id === region)?.label ?? region;
  const active = result?.assessments.find(item => item.band === selectedBand) ?? result?.assessments[0];
  const modelSummary = result && active ? result.modelBandSummaries.find(item => item.band === active.band) : undefined;
  const observedSummary = result && active
    ? result.observedBandSummaries.find(item => item.band === active.band) ?? {
      band: active.band,
      sourceState: active.provenance.observedSourceState,
      reportCount: 0,
      uniquePathCount: 0,
      uniqueRemoteCallsignCount: 0,
      modeCounts: {},
      newestReportAt: null,
    }
    : undefined;
  const weather = result?.spaceWeather;
  const customPower = !POWER_PRESET_OPTIONS.some(item => item.watts === profile.transmitPowerWatts) ? { id: 'saved-custom', label: `${profile.transmitPowerWatts} W (saved)`, watts: profile.transmitPowerWatts } : null;
  const powerOptions = customPower ? [customPower, ...POWER_PRESET_OPTIONS] : POWER_PRESET_OPTIONS;

  return <div data-theme={theme} className="fo-surface border rounded-2xl p-4 sm:p-5 shadow-lg font-mono space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--fo-border-subtle)] pb-3"><div className="flex items-center gap-2"><Activity className="fo-icon-neutral w-4 h-4" /><h3 className="fo-text-secondary text-xs font-bold uppercase tracking-widest">REGIONAL HF BAND GUIDANCE</h3></div><div className="flex items-center gap-2 text-[10px]"><span className="fo-badge rounded border px-2 py-1">{active ? OPERATING_MODE_LABELS[active.operatingMode] : loading ? 'CALCULATING' : 'UNAVAILABLE'}</span><button aria-label="Refresh propagation guidance" onClick={() => void refresh()} className="fo-control min-h-11 min-w-11 rounded border p-2 touch-manipulation"><RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} /></button></div></div>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
      <label>Destination<select aria-label="Propagation destination" aria-describedby={region === 'local_nvis' ? 'local-nvis-deferred' : undefined} value={region} onChange={event => persistDestination(event.target.value as PropagationRegionId)} className="fo-input min-h-11 w-full rounded border px-2 py-2">{PROPAGATION_REGION_CATALOG.map(item => <option key={item.id} value={item.id} disabled={item.id === 'local_nvis'}>{item.id === 'local_nvis' ? `${item.label} (evaluator deferred)` : item.label}</option>)}</select></label>
      <label>Mode<select aria-label="Propagation mode" value={profile.mode} onChange={event => persistProfile({ mode: event.target.value as StationProfile['mode'] })} className="fo-input min-h-11 w-full rounded border px-2 py-2">{MODE_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Power<select aria-label="Transmit power" value={customPower?.id ?? POWER_PRESET_OPTIONS.find(item => item.watts === profile.transmitPowerWatts)?.id ?? 'custom'} onChange={event => { const watts = powerOptions.find(item => item.id === event.target.value)?.watts; if (watts) persistProfile({ transmitPowerWatts: watts }); }} className="fo-input min-h-11 w-full rounded border px-2 py-2">{powerOptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Antenna<select aria-label="Antenna type" value={profile.antenna.type} onChange={event => persistProfile({ antenna: { type: event.target.value as StationProfile['antenna']['type'] } })} className="fo-input min-h-11 w-full rounded border px-2 py-2">{ANTENNA_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Deployment<select aria-label="Deployment geometry" value={profile.deployment.geometry} onChange={event => persistProfile({ deployment: { ...profile.deployment, geometry: event.target.value as StationProfile['deployment']['geometry'] } })} className="fo-input min-h-11 w-full rounded border px-2 py-2">{getDeploymentOptionsForAntenna(profile.antenna.type).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Height<select aria-label="Antenna height" value={profile.deployment.heightCategory} onChange={event => persistProfile({ deployment: { ...profile.deployment, heightCategory: event.target.value as NonNullable<StationProfile['deployment']['heightCategory']> } })} className="fo-input min-h-11 w-full rounded border px-2 py-2">{getHeightOptionsForDeployment(profile.deployment.geometry).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    </div>
    {region === 'local_nvis' && <p id="local-nvis-deferred" role="status" className="fo-status-caution rounded border p-3 text-xs">{LOCAL_NVIS_DEFERRED_MESSAGE}</p>}
    <div className="flex flex-wrap gap-2 text-[10px]"><span className="fo-evidence-modeled rounded border px-2 py-1">MODEL: {result?.model.status ?? 'pending'}</span><span className="fo-evidence-live rounded border px-2 py-1">SPACE WX: {weather?.status ?? 'pending'}</span><span className="fo-evidence-observed rounded border px-2 py-1">PSK: {observedSummary ? observedRfSummaryLabel(observedSummary.sourceState, observedSummary.reportCount) : 'pending'}</span><span className="fo-badge rounded border px-2 py-1">DESTINATION: {regionLabel}</span></div>
    {!result && loading && <p className="fo-status-info rounded border p-3 text-xs">CALCULATING GUIDANCE...</p>}{result && loading && <p className="fo-status-info rounded border p-3 text-xs">LAST RESULT - REFRESHING...</p>}{error && <p className="fo-status-danger rounded border p-3 text-xs">{result && !loading ? 'UPDATE UNAVAILABLE - LAST RESULT RETAINED' : error}</p>}
    {result && <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">{result.assessments.map(item => <button key={item.band} aria-pressed={selectedBand === item.band} onClick={() => setSelectedBand(item.band)} className={`min-h-[96px] rounded-xl border p-3 text-left touch-manipulation ${getBandRatingClasses(item.rating, theme, selectedBand === item.band)}`}><strong className="block text-sm">{item.band}</strong><span className="mt-2 block text-[10px] uppercase">{RATING_LABELS[item.rating]}</span><span className="mt-2 block text-[10px] font-normal">Confidence: {confidenceLabel(item.confidence)}</span></button>)}</div>}
    {!result && !loading && !error && <p className="fo-status-neutral rounded border p-3 text-xs">LOCATION REQUIRED</p>}
    {active && result && <div className="fo-surface-subtle rounded-xl border p-3 text-xs space-y-3"><div><strong className="fo-text-primary text-base">{active.band} BAND</strong><span className="fo-badge ml-2 rounded border px-2 py-1">{RATING_LABELS[active.rating]} / {confidenceLabel(active.confidence)}</span><span className="fo-text-muted ml-2">{OPERATING_MODE_LABELS[active.operatingMode]}</span></div><section><h4 className="fo-text-secondary font-bold">WHY</h4><ul className="list-disc pl-5">{active.reasons.slice(0, 3).map(reason => <li key={reason.code}>{reason.text}</li>)}</ul></section>{active.cautions.length > 0 && <section><h4 className="fo-text-caution font-bold">CAUTIONS</h4><ul className="fo-text-caution list-disc pl-5">{active.cautions.map(item => <li key={item.code}>{item.text}</li>)}</ul></section>}<section><h4 className="fo-evidence-modeled font-bold">MODEL</h4><p>{active.band === '6m' ? 'Not supported by P.533.' : modelSummary ? `Median BCR ${modelSummary.medianBcrPercent ?? 'not available'}%; range ${modelSummary.minimumBcrPercent ?? 'not available'}-${modelSummary.maximumBcrPercent ?? 'not available'}%; ${modelSummary.successfulSampleCount}/${modelSummary.sampleCount} successful samples.` : 'P.533 model evidence unavailable.'}</p></section><section><h4 className="fo-evidence-observed font-bold">OBSERVED RF</h4><p>{observedSummary ? `${observedRfSummaryLabel(observedSummary.sourceState, observedSummary.reportCount)}. Reports: ${observedSummary.reportCount}; paths: ${observedSummary.uniquePathCount}; modes: ${labelModeCounts(observedSummary.modeCounts)}; newest: ${ageLabel(observedSummary.newestReportAt)}.` : 'OBSERVED RF UNAVAILABLE'}</p></section><section><h4 className="fo-evidence-live font-bold">SPACE WEATHER</h4><p>Kp {weather?.products.kp.value ?? 'unavailable'} ({weather?.products.kp.state ?? 'unavailable'}); R-scale {weather?.products.rScale.value ?? 'unavailable'}; F10.7 {weather?.products.f107.value ?? 'unavailable'} SFU; DAILY SSN: {weather?.products.ssn.value ?? 'unavailable'} ({weather?.products.ssn.state ?? 'unavailable'}{weather?.products.ssn.observedAt ? ` · ${weather.products.ssn.observedAt.slice(0, 10)}` : ''}).</p><p>P.533 MODEL SSN: {result.model.ssn.value ?? 'unavailable'} ({result.model.ssn.modelInput?.basis === 'predicted_smoothed' ? 'PREDICTED' : result.model.ssn.modelInput?.basis === 'observed_smoothed' ? 'OBSERVED' : 'UNAVAILABLE'}{result.model.ssn.modelInput?.effectiveMonth ? ` · ${result.model.ssn.modelInput.effectiveMonth}` : ''}; {result.model.ssn.state}). Source: {result.model.ssn.source.name}.</p></section><section><h4 className="fo-text-secondary font-bold">PROFILE</h4><p>{profile.mode} / {profile.transmitPowerWatts} W / {profile.antenna.type} / {profile.deployment.geometry} / {profile.deployment.heightCategory}. Reference antenna limitation: P.533 uses its modeled reference antenna; this profile does not prove station-specific circuit success.</p></section><p className="fo-text-muted text-[10px]">Updated {new Date(result.evaluatedAtUtc).toLocaleTimeString()}</p></div>}
  </div>;
};
