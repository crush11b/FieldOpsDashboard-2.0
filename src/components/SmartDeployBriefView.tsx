import React, { useEffect, useState } from 'react';
import type { SmartDeployBrief, SmartDeployBriefV1, SmartDeployBriefV2 } from '../../server/smartDeployBrief';
import type { Activation } from '../../server/activation';
import { ActivationNotesPanel } from './ActivationNotesPanel';
import { FieldReadinessChecklistPanel } from './FieldReadinessChecklistPanel';
import { ActivationFoundationPanel } from './ActivationFoundationPanel';
import { OperationsReadinessWorkspace } from './OperationsReadinessWorkspace';
import { ActivationReviewPanel } from './ActivationReviewPanel';
import { listQsos } from '../qsoApi';

interface SmartDeployBriefViewProps {
  brief: SmartDeployBrief;
}

export const SmartDeployBriefView: React.FC<SmartDeployBriefViewProps> = ({ brief }) => brief.schemaVersion === 2
  ? <V2BriefView brief={brief} />
  : <V1BriefView brief={brief} />;

const V2BriefView: React.FC<{ brief: SmartDeployBriefV2 }> = ({ brief }) => {
  const [phase, setPhase] = useState<'plan' | 'prepare' | 'operate' | 'review'>('plan');
  const [activation, setActivation] = useState<Activation | null>(null);
  const [qsoCount, setQsoCount] = useState<number | null>(null);
  useEffect(() => { let cancelled = false; void fetch('/api/activations').then(response => response.ok ? response.json() : null).then(payload => { if (cancelled) return; const match = payload?.activations?.find((item: Activation) => item.briefId === brief.briefId); if (match) { setActivation(match); setPhase(match.status === 'active' ? 'operate' : match.status === 'completed' ? 'review' : 'plan'); } }).catch(() => undefined); return () => { cancelled = true; }; }, [brief.briefId]);
  useEffect(() => { if (!activation) { setQsoCount(null); return; } void listQsos(activation.activationId).then(result => setQsoCount(result.qsos.length)).catch(() => setQsoCount(null)); }, [activation]);
  const propagation = brief.sections.propagation.evidence;
  const solar = brief.sections.solar.evidence;
  const observedRf = brief.sections.observedRf;
  const geometry = propagationGeometry(propagation);
  return <section id="smartdeploy-brief" className="space-y-3" aria-live="polite">
    <header className="sticky top-0 z-10 rounded-xl border border-cyan-700/70 bg-slate-950/95 p-3 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-black text-sm uppercase text-cyan-200">{brief.activation.reference}{brief.activation.displayName ? ` · ${brief.activation.displayName}` : ''}</h3><p className="text-[10px] text-slate-400">{brief.activation.program} · {brief.activation.gridSquare || 'Grid unavailable'} · {formatUtc(brief.missionWindow.start)} to {formatUtc(brief.missionWindow.end)} · {activation?.status || 'PLANNED'}</p></div>
        {activation && <button type="button" className="text-[11px] font-black text-amber-200 underline" onClick={() => setPhase('operate')}>{qsoCount === null ? 'QSOs in OPERATE' : `${qsoCount} QSOs`}</button>}
      </div>
      <nav aria-label="Activation workspace" className="mt-3 grid grid-cols-4 gap-1">
        {(['plan', 'prepare', 'operate', 'review'] as const).map(item => <button key={item} type="button" aria-current={phase === item ? 'page' : undefined} onClick={() => setPhase(item)} className={`min-h-11 rounded border px-2 text-[10px] font-black uppercase ${phase === item ? 'border-amber-400 bg-amber-400 text-slate-950' : 'border-slate-700 text-slate-300'}`}>{item}</button>)}
      </nav>
    </header>
    {phase === 'plan' && <>
    <div className="rounded-xl border border-emerald-700/70 bg-emerald-950/20 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="font-black text-sm uppercase text-emerald-300">SMARTDEPLOY PLAN</h3><p className="text-[11px] text-slate-300">{brief.activation.reference}{brief.activation.displayName ? ` - ${brief.activation.displayName}` : ''}</p><p className="text-[10px] text-slate-400">{formatUtc(brief.missionWindow.start)} to {formatUtc(brief.missionWindow.end)}</p></div>
        <div className="flex items-center gap-2 no-print"><span className="px-2 py-1 rounded border border-emerald-500/50 text-[10px] font-black uppercase text-emerald-300">{brief.status}</span><button type="button" onClick={() => window.print()} className="min-h-11 px-3 py-2 rounded border border-cyan-600 text-cyan-200 text-[10px] font-bold">PRINT / SAVE PDF</button></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <PrimaryField label="PLANNED SITE" value={brief.plannedOperatingSite.location.gridSquare || formatCoordinates(brief.plannedOperatingSite.location.coordinates)} detail={brief.plannedOperatingSite.description} />
        <PrimaryField label="RF TARGET" value={brief.propagationObjective.regionLabel} detail={brief.propagationObjective.regionId} />
        <PrimaryField label="STATION" value={`${brief.station.radio.name} - ${brief.station.antenna.name || brief.station.antenna.type} - ${brief.station.transmitPowerWatts} W`} detail={`${brief.station.selectedModes.join(' / ')}${brief.station.modeledMode ? ` | Modeled: ${brief.station.modeledMode}` : ''}`} />
        <PrimaryField label="RF PATH RANGE" value={geometry} detail="Across representative regional paths" />
      </div>
    </div>

    <BriefSection title="OPERATION"><Detail label="PLANNED SITE / GRID" value={`${brief.plannedOperatingSite.description} / ${brief.plannedOperatingSite.location.gridSquare || 'Grid unavailable'}`} /><Detail label="LOCATION SOURCE" value={readableLocationSource(brief.plannedOperatingSite.source)} /><Detail label="MISSION WINDOW" value={`${formatUtc(brief.missionWindow.start)} to ${formatUtc(brief.missionWindow.end)}`} /><Detail label="STATION" value={`${brief.station.radio.name} / ${brief.station.antenna.name || brief.station.antenna.type} / ${brief.station.selectedModes.join(' / ') || 'Unavailable'} / ${brief.station.transmitPowerWatts} W`} /></BriefSection>

    <PlanningOutlook brief={brief} propagation={propagation} solar={solar} />
    <BriefSection title="LIVE BAND ACTIVITY"><p className="text-[11px] text-slate-200">{observedRfPrimary(observedRf.status)}</p></BriefSection>

    {brief.currentDeviceLocation && brief.plannedOperatingSite.source !== 'operator_selected_current_device' && <BriefSection title="CURRENT DEVICE">
      <p className="text-[11px] text-slate-200">{brief.currentDeviceLocation.gridSquare || formatCoordinates(brief.currentDeviceLocation.coordinates)}</p>
      <p className="text-[10px] text-slate-400">Context only; this location was not used as the modeled transmitter site.</p>
    </BriefSection>}

    {brief.limitations.filter(isPrimaryLimitation).length > 0 && <BriefSection title="IMPORTANT NOTES"><ul className="list-disc pl-5 space-y-1 text-[11px] text-amber-200">{brief.limitations.filter(isPrimaryLimitation).map(limitation => <li key={limitation.code}>{limitation.message}</li>)}</ul></BriefSection>}

    <details className="rounded-xl border border-slate-700 bg-slate-950/50 p-3"><summary className="cursor-pointer text-[11px] font-black uppercase text-cyan-300">Technical Details</summary><div className="mt-3 space-y-2"><Detail label="SCHEMA / BRIEF" value={`${brief.schemaVersion} / ${brief.briefId}`} /><Detail label="GENERATED" value={formatUtc(brief.generatedAtUtc)} /><Detail label="MISSION UTC" value={`${brief.missionWindow.start} / ${brief.missionWindow.midpoint} / ${brief.missionWindow.end}`} /><Detail label="ACTIVATION COORDINATES" value={`${formatCoordinates(brief.activation.coordinates)} / ${brief.activation.gridSquare || 'Grid unavailable'}`} /><Detail label="PLANNED COORDINATES / PROVENANCE" value={`${formatCoordinates(brief.plannedOperatingSite.location.coordinates)} / ${brief.plannedOperatingSite.description} / raw location provenance: ${brief.plannedOperatingSite.location.provenance} / planning source: ${brief.plannedOperatingSite.source}`} /><Detail label="RF REGION" value={`${brief.propagationObjective.regionId} / ${brief.propagationObjective.regionLabel}`} /><Detail label="OBSERVED RF WINDOW / STATUS" value={`${observedRf.evidence.observationWindow.startsAt ? `${formatUtc(observedRf.evidence.observationWindow.startsAt)} to ${formatUtc(observedRf.evidence.observationWindow.endsAt)}` : 'Unavailable'} / ${observedRf.status}`} /><Detail label="MODEL" value="ITU-R P.533 representative regional paths; long-lived solar-cycle model input; no mission-time forecast." /><h4 className="pt-2 text-[10px] font-black uppercase text-amber-300">Structured limitations</h4><ul className="list-disc pl-5 space-y-1 text-[10px] text-slate-300">{brief.limitations.map(limitation => <li key={limitation.code}><strong>{limitation.code}:</strong> {limitation.message}</li>)}</ul></div></details>
    <BriefSection title="FIELD OPERATION"><p className="text-[11px] text-slate-200">Record activation notes and quick observations against this retained brief.</p></BriefSection>
    </>}
    {phase === 'prepare' && <>
      <OperationsReadinessWorkspace brief={brief} />
      <FieldReadinessChecklistPanel brief={brief} />
      <details className="rounded-xl border border-slate-700 bg-slate-950/50 p-3"><summary className="cursor-pointer text-[11px] font-black uppercase text-cyan-300">Technical Details</summary><div className="mt-3"><Detail label="BRIEF" value={brief.briefId} /><Detail label="PLAN SOURCE" value={readableLocationSource(brief.plannedOperatingSite.source)} /></div></details>
    </>}
    {phase === 'operate' && <>
      <ActivationFoundationPanel brief={brief} showReview={false} onActivationChange={setActivation} />
      {activation ? <ActivationNotesPanel brief={brief} /> : <p className="rounded-lg border border-amber-700/60 bg-amber-950/20 p-3 text-[11px] text-amber-200">Open the Activation above to enable Notes and the QSO Logger.</p>}
    </>}
    {phase === 'review' && (activation ? <ActivationReviewPanel activation={activation} /> : <div className="rounded-xl border border-amber-700/60 bg-amber-950/20 p-3 space-y-2"><h3 className="font-black text-sm uppercase text-amber-300">REVIEW</h3><p className="text-[11px] text-slate-300">Open this plan in OPERATE first to create its durable Activation record, then return here for the retained-evidence review.</p><button type="button" onClick={() => setPhase('operate')} className="min-h-11 rounded border border-cyan-700 px-3 py-2 text-[10px] font-bold text-cyan-200">OPEN OPERATE</button></div>)}
  </section>;
};

const PlanningOutlook: React.FC<{ brief: SmartDeployBriefV2; propagation: SmartDeployBriefV2['sections']['propagation']['evidence']; solar: SmartDeployBriefV2['sections']['solar']['evidence'] }> = ({ brief, propagation, solar }) => {
  const [forecast, setForecast] = useState<any>(null);
  const [spaceWeather, setSpaceWeather] = useState<any>(null);
  const [busy, setBusy] = useState<'forecast' | 'space' | null>(null);
  const [forecastState, setForecastState] = useState<'loading' | 'retained' | 'updated' | 'unavailable' | 'failed'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { setForecast(null); setSpaceWeather(null); setForecastState('loading'); setMessage(null); void Promise.all([fetch(`/api/mission-forecast/brief/${encodeURIComponent(brief.briefId)}`).then(async response => { const payload = await response.json(); if (!response.ok) throw new Error(payload.message || 'Retained mission forecast is unavailable.'); setForecast(payload.record); setForecastState(payload.record ? 'retained' : 'unavailable'); }), fetch(`/api/space-weather/brief/${encodeURIComponent(brief.briefId)}`).then(response => response.json()).then(payload => setSpaceWeather(payload.record))]).catch(() => { setForecastState('unavailable'); setMessage('Retained planning evidence could not be read locally.'); }); }, [brief.briefId]);
  const refresh = async (kind: 'forecast' | 'space') => { setBusy(kind); setMessage(null); if (kind === 'forecast') setForecastState('loading'); try { const path = kind === 'forecast' ? 'mission-forecast' : 'space-weather'; const response = await fetch(`/api/${path}/brief/${encodeURIComponent(brief.briefId)}/refresh`, { method: 'POST' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.message || 'Refresh failed.'); kind === 'forecast' ? (setForecast(payload.record), setForecastState('updated')) : setSpaceWeather(payload.record); } catch (error) { if (kind === 'forecast') setForecastState(forecast ? 'failed' : 'unavailable'); setMessage(error instanceof Error ? error.message : 'Refresh failed; prior retained evidence is preserved.'); } finally { setBusy(null); } };
  return <section className="space-y-3"><BriefSection title="PLANNING OUTLOOK"><div className="grid grid-cols-1 sm:grid-cols-3 gap-2">{propagation.samples.map(sample => <div key={sample.position} className="rounded-lg border border-slate-700 bg-slate-950/70 p-3"><strong className="block uppercase text-cyan-300">{sample.position}</strong><span className="block text-[10px] text-slate-400">{formatUtc(sample.modelDateTimeUtc)}</span><span className="block mt-1 text-[11px] text-amber-200">Strongest modeled band: {propagation.summary.strongestBandBySample.find(item => item.position === sample.position)?.band || 'Unavailable'}</span></div>)}</div><p className="text-[10px] text-slate-400">{solarCondition(solar)} Propagation is modeled guidance, never a guarantee.</p></BriefSection><EvidenceCard title="RETAINED MISSION FORECAST" record={forecast} empty={forecastState === 'loading' ? 'Loading mission forecast...' : forecastState === 'unavailable' ? 'Mission forecast unavailable.' : 'Not requested; refresh explicitly when connected.'} status={forecastState.toUpperCase()} onRefresh={() => void refresh('forecast')} busy={busy === 'forecast'}>{forecast?.periods?.slice(0, 3).map((period: any) => <span key={period.startsAtUtc} className="block text-[11px] text-slate-200">{formatUtc(period.startsAtUtc)}: {period.condition}, {period.temperatureF}°F, {period.precipitationProbability}% precipitation, wind {period.windSpeedMph} mph {period.windDirection}</span>)}</EvidenceCard><EvidenceCard title="RETAINED SPACE WEATHER" record={spaceWeather} empty="Not requested; refresh explicitly when connected." onRefresh={() => void refresh('space')} busy={busy === 'space'}>{spaceWeather && <><p className="text-[11px] text-slate-200">{spaceWeather.interpretation.plainLanguageEffect}</p><p className="text-[10px] text-slate-400">Solar support: {spaceWeather.interpretation.solarSupport} / geomagnetic activity: {spaceWeather.interpretation.geomagneticActivity} / flare concern: {spaceWeather.interpretation.flareConcern}</p></>}</EvidenceCard>{message && <p role="alert" className="text-[11px] text-amber-200">{message}</p>}</section>;
};

const EvidenceCard: React.FC<React.PropsWithChildren<{ title: string; record: any; empty: string; status?: string; onRefresh: () => void; busy: boolean }>> = ({ title, record, empty, status, onRefresh, busy, children }) => <BriefSection title={title}><p className="text-[10px] text-slate-400">{status ? `Status: ${status}. ` : ''}{record ? `Retained ${record.coverage || 'evidence'}; retrieved ${formatUtc(record.retrievedAtUtc)}` : empty}</p>{record ? children : null}{record?.missionWindow && <p className="text-[10px] text-slate-400">Mission coverage: {formatUtc(record.missionWindow.start)} to {formatUtc(record.missionWindow.end)}. Updated {formatUtc(record.updatedAtUtc)}.</p>}{record?.limitations?.map((limitation: string) => <p key={limitation} className="text-[10px] text-amber-200">Limitation: {limitation}</p>)}<div className="no-print"><button type="button" onClick={onRefresh} disabled={busy} className="min-h-11 px-3 py-2 rounded border border-cyan-700 text-cyan-200 text-[10px] font-bold disabled:opacity-50">{busy ? 'LOADING...' : title === 'RETAINED MISSION FORECAST' ? 'REFRESH MISSION FORECAST' : 'REFRESH SPACE WEATHER'}</button></div></BriefSection>;

const V1BriefView: React.FC<{ brief: SmartDeployBriefV1 }> = ({ brief }) => {
  const mission = brief.mission;
  const propagation = brief.sections.propagation.evidence;
  return <section id="smartdeploy-brief" className="space-y-3" aria-live="polite"><div className="rounded-xl border border-amber-700/70 bg-amber-950/20 p-4 space-y-2"><h3 className="font-black text-sm uppercase text-amber-300">LEGACY SMARTDEPLOY BRIEF</h3><p className="text-[11px] text-amber-200">Legacy SmartDeploy brief (schema v1). This plan used the earlier point-to-point location semantics.</p><p className="text-[11px] text-slate-200">{brief.summary}</p></div><BriefSection title="HISTORICAL EVIDENCE"><Detail label="POTA" value={`${mission.activationTarget.reference}${mission.activationTarget.displayName ? ` - ${mission.activationTarget.displayName}` : ''}`} /><Detail label="OPERATING LOCATION" value={mission.operatingLocation.gridSquare || formatCoordinates(mission.operatingLocation.coordinates)} /><Detail label="WINDOW (UTC)" value={`${mission.missionWindow.start} to ${mission.missionWindow.end}`} /><Detail label="STATUS" value={brief.status} /></BriefSection><BriefSection title="PROPAGATION"><p className="text-[11px] text-slate-300">{propagationSummary(propagation)}</p><p className="text-[10px] text-slate-400">Observed RF status: {brief.sections.observedRf.status === 'notTemporallyApplicable' ? 'Not temporally applicable' : brief.sections.observedRf.status}.</p>{brief.limitations.length > 0 && <ul className="list-disc pl-5 text-[10px] text-amber-200">{brief.limitations.map(limitation => <li key={limitation.code}>{limitation.message}</li>)}</ul>}</BriefSection><FieldReadinessChecklistPanel brief={brief} /><details className="rounded-xl border border-slate-700 bg-slate-950/50 p-3"><summary className="cursor-pointer text-[11px] font-black uppercase text-cyan-300">Historical Technical Details</summary><pre className="mt-2 whitespace-pre-wrap break-words text-[10px] text-slate-300">{JSON.stringify(brief, null, 2)}</pre></details><ActivationNotesPanel brief={brief} /></section>;
};

const BriefSection: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-3 space-y-2"><h4 className="font-black text-[11px] uppercase text-amber-300">{title}</h4>{children}</div>;
const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded border border-slate-800 bg-slate-900/70 p-2"><span className="block text-[9px] uppercase text-slate-500">{label}</span><span className="block mt-0.5 text-[11px] text-slate-200 break-words">{value}</span></div>;
const PrimaryField: React.FC<{ label: string; value: string; detail: string }> = ({ label, value, detail }) => <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-3"><span className="block text-[9px] uppercase text-slate-500">{label}</span><strong className="block mt-1 text-[12px] text-slate-100 break-words">{value}</strong><span className="block mt-1 text-[10px] text-slate-400 break-words">{detail}</span></div>;
const formatUtc = (value: string) => new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const formatCoordinates = (value: { lat: number; lon: number } | null | undefined) => value ? `${value.lat.toFixed(5)}, ${value.lon.toFixed(5)}` : 'Unavailable';
const readableLocationSource = (source: SmartDeployBriefV2['plannedOperatingSite']['source']) => source === 'provider_reference_default' ? 'Provider reference location (approximate)' : source === 'operator_selected_current_device' ? 'Operator selected the current GNSS device position' : 'Operator entered the planned location';
const propagationGeometry = (propagation: SmartDeployBriefV2['sections']['propagation']['evidence']) => { const geometry = propagation.samples.flatMap(sample => sample.bands.flatMap(band => band.regional.samples)).map(sample => sample.distanceKm); if (!geometry.length) return 'Unavailable'; return `Approx. ${Math.min(...geometry).toFixed(0)}-${Math.max(...geometry).toFixed(0)} km`; };
const solarCondition = (solar: SmartDeployBriefV2['sections']['solar']['evidence']) => { if (solar.status === 'unavailable') return 'Solar and twilight evidence unavailable.'; if (solar.overlap.entirelyDuringDarkness) return 'Entire activation after dark.'; if (solar.overlap.entirelyDuringDaylight) return 'Entire activation during daylight.'; if (solar.overlap.includesDaylight) return 'Activation includes daylight.'; return 'No derived daylight interval overlaps the mission.'; };
const observedRfPrimary = (status: string) => status === 'observed' ? 'Recent live activity available for this site.' : status === 'notTemporallyApplicable' ? 'Live band activity is too early to apply to this mission.' : status === 'stale' ? 'Live activity available but stale.' : 'Live activity unavailable.';
const isPrimaryLimitation = (limitation: { code: string }) => ['planned_site_reference_coordinate', 'propagation_partial', 'propagation_unavailable', 'solar_unavailable', 'mode_selected_vs_modeled', 'model_no_forecast'].includes(limitation.code);
const propagationSummary = (propagation: SmartDeployBriefV1['sections']['propagation']['evidence']) => propagation.summary.consistentStrongestBand ? `${propagation.summary.consistentStrongestBand} is strongest at all sampled times.` : `Successful samples: ${propagation.summary.successfulSampleCount}/${propagation.samples.length}. Strongest band varies or is unavailable.`;
