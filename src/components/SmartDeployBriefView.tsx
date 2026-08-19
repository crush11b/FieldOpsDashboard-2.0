import React from 'react';
import type { SmartDeployBrief, SmartDeployBriefV1, SmartDeployBriefV2 } from '../../server/smartDeployBrief';

interface SmartDeployBriefViewProps {
  brief: SmartDeployBrief;
}

export const SmartDeployBriefView: React.FC<SmartDeployBriefViewProps> = ({ brief }) => brief.schemaVersion === 2
  ? <V2BriefView brief={brief} />
  : <V1BriefView brief={brief} />;

const V2BriefView: React.FC<{ brief: SmartDeployBriefV2 }> = ({ brief }) => {
  const propagation = brief.sections.propagation.evidence;
  const solar = brief.sections.solar.evidence;
  const observedRf = brief.sections.observedRf;
  const geometry = propagationGeometry(propagation);
  return <section id="smartdeploy-brief" className="space-y-3" aria-live="polite">
    <div className="rounded-xl border border-emerald-700/70 bg-emerald-950/20 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="font-black text-sm uppercase text-emerald-300">SMARTDEPLOY PLAN</h3><p className="text-[11px] text-slate-300">{brief.activation.reference}{brief.activation.displayName ? ` - ${brief.activation.displayName}` : ''}</p><p className="text-[10px] text-slate-400">{formatUtc(brief.missionWindow.start)} to {formatUtc(brief.missionWindow.end)}</p></div>
        <span className="px-2 py-1 rounded border border-emerald-500/50 text-[10px] font-black uppercase text-emerald-300">{brief.status}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <PrimaryField label="PLANNED SITE" value={brief.plannedOperatingSite.location.gridSquare || formatCoordinates(brief.plannedOperatingSite.location.coordinates)} detail={brief.plannedOperatingSite.description} />
        <PrimaryField label="RF TARGET" value={brief.propagationObjective.regionLabel} detail={brief.propagationObjective.regionId} />
        <PrimaryField label="STATION" value={`${brief.station.radio.name} - ${brief.station.antenna.name || brief.station.antenna.type} - ${brief.station.transmitPowerWatts} W`} detail={`${brief.station.selectedModes.join(' / ')}${brief.station.modeledMode ? ` | Modeled: ${brief.station.modeledMode}` : ''}`} />
        <PrimaryField label="RF PATH RANGE" value={geometry} detail="Across representative regional paths" />
      </div>
    </div>

    {brief.currentDeviceLocation && brief.plannedOperatingSite.source !== 'operator_selected_current_device' && <BriefSection title="CURRENT DEVICE">
      <Detail label="CURRENT DEVICE" value={brief.currentDeviceLocation.gridSquare || formatCoordinates(brief.currentDeviceLocation.coordinates)} />
      <p className="text-[10px] text-slate-400">Context only; this location was not used as the modeled transmitter site.</p>
    </BriefSection>}

    <BriefSection title="BAND OUTLOOK">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">{propagation.samples.map(sample => <div key={sample.position} className="rounded-lg border border-slate-700 bg-slate-950/70 p-3"><strong className="block uppercase text-cyan-300">{sample.position}</strong><span className="block text-[10px] text-slate-400">{formatUtc(sample.modelDateTimeUtc)}</span><span className="block mt-1 text-[11px] text-amber-200">Strongest modeled band: {propagation.summary.strongestBandBySample.find(item => item.position === sample.position)?.band || 'Unavailable'}</span><span className="block text-[10px] text-slate-400">Modeled with {sample.stationProfile.mode}</span></div>)}</div>
      <p className="text-[10px] text-slate-400">Band outlook checked at mission start, midpoint, and end. No transition between samples is inferred.</p>
    </BriefSection>

    <BriefSection title="SITE CONDITIONS"><p className="text-[11px] text-slate-200">{solarCondition(solar)}</p></BriefSection>
    <BriefSection title="LIVE BAND ACTIVITY"><p className="text-[11px] text-slate-200">{observedRfPrimary(observedRf.status)}</p></BriefSection>

    {brief.limitations.length > 0 && <BriefSection title="IMPORTANT NOTES"><ul className="list-disc pl-5 space-y-1 text-[11px] text-amber-200">{brief.limitations.filter(isPrimaryLimitation).map(limitation => <li key={limitation.code}>{limitation.message}</li>)}</ul></BriefSection>}

    <details className="rounded-xl border border-slate-700 bg-slate-950/50 p-3"><summary className="cursor-pointer text-[11px] font-black uppercase text-cyan-300">Technical Details</summary><div className="mt-3 space-y-2"><Detail label="SCHEMA / BRIEF" value={`${brief.schemaVersion} / ${brief.briefId}`} /><Detail label="GENERATED" value={formatUtc(brief.generatedAtUtc)} /><Detail label="MISSION UTC" value={`${brief.missionWindow.start} / ${brief.missionWindow.midpoint} / ${brief.missionWindow.end}`} /><Detail label="ACTIVATION COORDINATES" value={`${formatCoordinates(brief.activation.coordinates)} / ${brief.activation.gridSquare || 'Grid unavailable'}`} /><Detail label="PLANNED COORDINATES / PROVENANCE" value={`${formatCoordinates(brief.plannedOperatingSite.location.coordinates)} / ${brief.plannedOperatingSite.location.provenance} / ${brief.plannedOperatingSite.source}`} /><Detail label="RF REGION" value={`${brief.propagationObjective.regionId} / ${brief.propagationObjective.regionLabel}`} /><Detail label="OBSERVED RF WINDOW / STATUS" value={`${observedRf.evidence.observationWindow.startsAt ? `${formatUtc(observedRf.evidence.observationWindow.startsAt)} to ${formatUtc(observedRf.evidence.observationWindow.endsAt)}` : 'Unavailable'} / ${observedRf.status}`} /><Detail label="MODEL" value="ITU-R P.533 representative regional paths; long-lived solar-cycle model input; no mission-time forecast." /><h4 className="pt-2 text-[10px] font-black uppercase text-amber-300">Structured limitations</h4><ul className="list-disc pl-5 space-y-1 text-[10px] text-slate-300">{brief.limitations.map(limitation => <li key={limitation.code}><strong>{limitation.code}:</strong> {limitation.message}</li>)}</ul></div></details>
  </section>;
};

const V1BriefView: React.FC<{ brief: SmartDeployBriefV1 }> = ({ brief }) => {
  const mission = brief.mission;
  const propagation = brief.sections.propagation.evidence;
  return <section id="smartdeploy-brief" className="space-y-3" aria-live="polite"><div className="rounded-xl border border-amber-700/70 bg-amber-950/20 p-4 space-y-2"><h3 className="font-black text-sm uppercase text-amber-300">LEGACY SMARTDEPLOY BRIEF</h3><p className="text-[11px] text-amber-200">Legacy SmartDeploy brief (schema v1). This plan used the earlier point-to-point location semantics.</p><p className="text-[11px] text-slate-200">{brief.summary}</p></div><BriefSection title="HISTORICAL EVIDENCE"><Detail label="POTA" value={`${mission.activationTarget.reference}${mission.activationTarget.displayName ? ` - ${mission.activationTarget.displayName}` : ''}`} /><Detail label="OPERATING LOCATION" value={mission.operatingLocation.gridSquare || formatCoordinates(mission.operatingLocation.coordinates)} /><Detail label="WINDOW (UTC)" value={`${mission.missionWindow.start} to ${mission.missionWindow.end}`} /><Detail label="STATUS" value={brief.status} /></BriefSection><BriefSection title="PROPAGATION"><p className="text-[11px] text-slate-300">{propagationSummary(propagation)}</p><p className="text-[10px] text-slate-400">Observed RF status: {brief.sections.observedRf.status === 'notTemporallyApplicable' ? 'Not temporally applicable' : brief.sections.observedRf.status}.</p>{brief.limitations.length > 0 && <ul className="list-disc pl-5 text-[10px] text-amber-200">{brief.limitations.map(limitation => <li key={limitation.code}>{limitation.message}</li>)}</ul>}</BriefSection><details className="rounded-xl border border-slate-700 bg-slate-950/50 p-3"><summary className="cursor-pointer text-[11px] font-black uppercase text-cyan-300">Historical Technical Details</summary><pre className="mt-2 whitespace-pre-wrap break-words text-[10px] text-slate-300">{JSON.stringify(brief, null, 2)}</pre></details></section>;
};

const BriefSection: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-3 space-y-2"><h4 className="font-black text-[11px] uppercase text-amber-300">{title}</h4>{children}</div>;
const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded border border-slate-800 bg-slate-900/70 p-2"><span className="block text-[9px] uppercase text-slate-500">{label}</span><span className="block mt-0.5 text-[11px] text-slate-200 break-words">{value}</span></div>;
const PrimaryField: React.FC<{ label: string; value: string; detail: string }> = ({ label, value, detail }) => <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-3"><span className="block text-[9px] uppercase text-slate-500">{label}</span><strong className="block mt-1 text-[12px] text-slate-100 break-words">{value}</strong><span className="block mt-1 text-[10px] text-slate-400 break-words">{detail}</span></div>;
const formatUtc = (value: string) => new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const formatCoordinates = (value: { lat: number; lon: number } | null | undefined) => value ? `${value.lat.toFixed(5)}, ${value.lon.toFixed(5)}` : 'Unavailable';
const propagationGeometry = (propagation: SmartDeployBriefV2['sections']['propagation']['evidence']) => { const geometry = propagation.samples.flatMap(sample => sample.bands.flatMap(band => band.regional.samples)).map(sample => sample.distanceKm); if (!geometry.length) return 'Unavailable'; return `Approx. ${Math.min(...geometry).toFixed(0)}-${Math.max(...geometry).toFixed(0)} km`; };
const solarCondition = (solar: SmartDeployBriefV2['sections']['solar']['evidence']) => { if (solar.status === 'unavailable') return 'Solar and twilight evidence unavailable.'; if (solar.overlap.entirelyDuringDarkness) return 'Entire activation after dark.'; if (solar.overlap.entirelyDuringDaylight) return 'Entire activation during daylight.'; if (solar.overlap.includesDaylight) return 'Activation includes daylight.'; return 'No derived daylight interval overlaps the mission.'; };
const observedRfPrimary = (status: string) => status === 'observed' ? 'Recent live activity available for this site.' : status === 'notTemporallyApplicable' ? 'Live band activity is too early to apply to this mission.' : status === 'stale' ? 'Live activity available but stale.' : 'Live activity unavailable.';
const isPrimaryLimitation = (limitation: { code: string }) => ['planned_site_reference_coordinate', 'propagation_partial', 'propagation_unavailable', 'solar_unavailable', 'observed_rf_not_temporally_applicable', 'observed_rf_stale', 'observed_rf_unavailable', 'mode_selected_vs_modeled', 'model_no_forecast'].includes(limitation.code);
const propagationSummary = (propagation: SmartDeployBriefV1['sections']['propagation']['evidence']) => propagation.summary.consistentStrongestBand ? `${propagation.summary.consistentStrongestBand} is strongest at all sampled times.` : `Successful samples: ${propagation.summary.successfulSampleCount}/${propagation.samples.length}. Strongest band varies or is unavailable.`;
