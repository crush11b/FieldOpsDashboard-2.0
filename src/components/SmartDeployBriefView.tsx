import React from 'react';
import type { SmartDeployBrief } from '../../server/smartDeployBrief';

interface SmartDeployBriefViewProps {
  brief: SmartDeployBrief;
}

export const SmartDeployBriefView: React.FC<SmartDeployBriefViewProps> = ({ brief }) => {
  const mission = brief.mission;
  const geometry = brief.sections.geometry.evidence;
  const solar = brief.sections.solar.evidence;
  const propagation = brief.sections.propagation.evidence;
  const observedRf = brief.sections.observedRf;
  return (
    <section id="smartdeploy-brief" className="space-y-3" aria-live="polite">
      <div className="rounded-xl border border-emerald-700/70 bg-emerald-950/20 p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-black text-sm uppercase text-emerald-300">OPERATIONS BRIEF</h3>
            <p className="text-[11px] text-slate-400">Plan generated: {formatUtc(brief.generatedAtUtc)}</p>
          </div>
          <span className="px-2 py-1 rounded border border-emerald-500/50 text-[10px] font-black uppercase text-emerald-300">{brief.status}</span>
        </div>
        <p className="text-[11px] text-slate-200">{brief.summary}</p>
      </div>

      <BriefSection title="MISSION">
        <Detail label="POTA" value={`${mission.activationTarget.reference}${mission.activationTarget.displayName ? ` - ${mission.activationTarget.displayName}` : ''}`} />
        <Detail label="TARGET GRID / COORDINATES" value={`${mission.activationTarget.gridSquare || 'Grid unavailable'} / ${formatCoordinates(mission.activationTarget.coordinates)}`} />
        <Detail label="TARGET PROVENANCE" value={`${mission.activationTarget.provenance.kind}${mission.activationTarget.provenance.resolvedAtUtc ? ` at ${formatUtc(mission.activationTarget.provenance.resolvedAtUtc)}` : ''}`} />
        <Detail label="WINDOW (UTC)" value={`${mission.missionWindow.start} to ${mission.missionWindow.end}`} />
        <Detail label="OPERATING LOCATION" value={mission.operatingLocation.gridSquare || formatCoordinates(mission.operatingLocation.coordinates)} />
        {mission.objective && <Detail label="OBJECTIVE" value={mission.objective} />}
      </BriefSection>

      <BriefSection title="STATION">
        <Detail label="RADIO" value={`${mission.equipment.radio.name}${mission.equipment.radio.model ? ` (${mission.equipment.radio.model})` : ''}`} />
        <Detail label="ANTENNA" value={mission.equipment.antenna.name || mission.equipment.antenna.type} />
        <Detail label="MODES SELECTED" value={mission.equipment.modes.join(' / ')} />
        <Detail label="INTENDED TX POWER" value={`${mission.equipment.transmitPowerWatts} W`} />
        {mission.equipment.deployment && <Detail label="DEPLOYMENT" value={`${mission.equipment.deployment.geometry}, ${mission.equipment.deployment.heightCategory || 'height not specified'}`} />}
      </BriefSection>

      <BriefSection title="GEOMETRY">
        <Detail label="DISTANCE" value={geometry.distanceKm === null ? 'Unavailable' : `${geometry.distanceKm.toFixed(1)} km`} />
        <Detail label="BEARING" value={geometry.initialBearingDegrees === null ? 'Unavailable' : `${geometry.initialBearingDegrees.toFixed(1)}°`} />
        <Detail label="DIRECTION" value={geometry.compassDirection || 'Unavailable'} />
      </BriefSection>

      <BriefSection title="SOLAR / TWILIGHT">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {solar.days.flatMap(day => Object.entries(day.events).map(([name, value]) => <Detail key={`${day.date}-${name}`} label={`${day.date} ${name}`} value={typeof value === 'string' ? formatUtc(value) : 'Does not occur'} />))}
        </div>
        <p className="text-[11px] text-slate-300">Overlap: {formatOverlap(solar.overlap)}</p>
      </BriefSection>

      <BriefSection title="PROPAGATION">
        <p className="text-[11px] text-slate-300">{formatPropagationSummary(propagation)}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {propagation.samples.map(sample => <div key={sample.position} className="rounded-lg border border-slate-700 bg-slate-950/70 p-3 space-y-1">
            <strong className="block uppercase text-cyan-300">{sample.position}</strong>
            <span className="block text-[10px] text-slate-400">{formatUtc(sample.modelDateTimeUtc)}</span>
            <span className="block uppercase text-[10px] text-slate-300">Status: {sample.status}</span>
            <span className="block text-[11px] text-amber-200">Strongest: {propagation.summary.strongestBandBySample.find(item => item.position === sample.position)?.band || 'Unavailable'}</span>
            <span className="block text-[10px] text-slate-400">Modeled mode: {sample.stationProfile.mode}</span>
          </div>)}
        </div>
      </BriefSection>

      <BriefSection title="OBSERVED RF">
        <p className="text-[11px] text-slate-200 uppercase">Status: {formatObservedRfStatus(observedRf.status)}</p>
        {observedRf.evidence.observationWindow.startsAt && <p className="text-[10px] text-slate-400">Evidence window: {formatUtc(observedRf.evidence.observationWindow.startsAt)} to {formatUtc(observedRf.evidence.observationWindow.endsAt)}</p>}
      </BriefSection>

      {brief.limitations.length > 0 && <BriefSection title="LIMITATIONS"><ul className="list-disc pl-5 space-y-1 text-[11px] text-amber-200">{brief.limitations.map((limitation, index) => <li key={`${limitation.code}-${index}`}><strong>{limitation.code}:</strong> {limitation.message}</li>)}</ul></BriefSection>}
    </section>
  );
};

const BriefSection: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-3 space-y-2"><h4 className="font-black text-[11px] uppercase text-amber-300">{title}</h4>{children}</div>;
const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded border border-slate-800 bg-slate-900/70 p-2"><span className="block text-[9px] uppercase text-slate-500">{label}</span><span className="block mt-0.5 text-[11px] text-slate-200 break-words">{value}</span></div>;
const formatUtc = (value: string) => new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const formatCoordinates = (value: { lat: number; lon: number } | null) => value ? `${value.lat.toFixed(5)}, ${value.lon.toFixed(5)}` : 'Unavailable';
const formatOverlap = (overlap: Record<string, boolean | null>) => Object.entries(overlap).filter(([, value]) => value === true).map(([key]) => key).join(', ') || 'No derived overlap facts';
const formatPropagationSummary = (propagation: any) => propagation.summary.consistentStrongestBand ? `${propagation.summary.consistentStrongestBand} is strongest at all sampled times.` : `Successful samples: ${propagation.summary.successfulSampleCount}/${propagation.samples.length}. Strongest band varies or is unavailable.`;
const formatObservedRfStatus = (status: string) => status === 'notTemporallyApplicable' ? 'Not temporally applicable' : status;