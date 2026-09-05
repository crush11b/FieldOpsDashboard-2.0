import React, { useEffect, useMemo, useState } from 'react';
import type { Activation } from '../../server/activation';
import type { SmartDeployBriefV2 } from '../../server/smartDeployBrief';
import { getOperationalIntelligence } from '../operationalIntelligenceApi';
import { fetchLiveBandActivity } from '../liveBandActivityApi';
import { assembleLayeredPropagationPicture, type LayeredPropagationInputs } from '../propagation/layeredPicture';
import { assembleMissionGuidance } from '../operations/missionGuidance';

interface Props {
  readonly activation: Activation;
  readonly brief?: SmartDeployBriefV2;
  readonly retained?: Pick<LayeredPropagationInputs, 'modeled' | 'modeledStatus' | 'modeledAtUtc' | 'missionWindow' | 'destinationLabel' | 'forecast' | 'spaceWeather' | 'generalObserved'>;
  readonly readOnly?: boolean;
  readonly qsoCount?: number;
  readonly evaluatedAtUtc?: string;
}

export const LayeredPropagationPicture: React.FC<Props> = ({ activation, brief, retained, readOnly = false, qsoCount = 0, evaluatedAtUtc }) => {
  const [remote, setRemote] = useState<LayeredPropagationInputs>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setRemote({});
    const requests: Promise<Partial<LayeredPropagationInputs>>[] = [getOperationalIntelligence(activation.activationId, controller.signal).then(value => ({ txContexts: value.txContexts, stationObservations: value.observations }))];
    if (brief && !retained?.forecast) requests.push(readRecord(`/api/mission-forecast/brief/${encodeURIComponent(brief.briefId)}`, controller.signal).then(forecast => ({ forecast })));
    if (brief && !retained?.spaceWeather) requests.push(readRecord(`/api/space-weather/brief/${encodeURIComponent(brief.briefId)}`, controller.signal).then(spaceWeather => ({ spaceWeather })));
    if (!readOnly) requests.push(fetchLiveBandActivity(controller.signal).then(liveBandActivity => ({ liveBandActivity })));
    void Promise.allSettled(requests).then(results => { if (controller.signal.aborted) return; setRemote(results.reduce<LayeredPropagationInputs>((combined, result) => result.status === 'fulfilled' ? { ...combined, ...result.value } : combined, {})); setLoading(false); });
    return () => controller.abort();
  }, [activation.activationId, brief?.briefId, readOnly]);
  const base = useMemo<LayeredPropagationInputs>(() => retained ?? (brief?.sections ? { modeled: brief.sections.propagation.evidence, modeledStatus: brief.sections.propagation.status, modeledAtUtc: brief.generatedAtUtc, missionWindow: { start: brief.missionWindow.start, end: brief.missionWindow.end }, destinationLabel: brief.propagationObjective.regionLabel, generalObserved: brief.sections.observedRf.evidence } : {}), [brief, retained]);
  const picture = useMemo(() => assembleLayeredPropagationPicture({ ...base, ...remote, forecast: remote.forecast ?? base.forecast, spaceWeather: remote.spaceWeather ?? base.spaceWeather, objective: activation.operatingObjective, completedQsos: qsoCount }), [activation.operatingObjective, base, qsoCount, remote]);
  const guidance = useMemo(() => {
    const current = remote.txContexts?.find(context => context.endedAtUtc === undefined);
    const modeledBands = [...new Set((base.modeled?.summary?.strongestBandBySample ?? []).map((item: any) => item?.band).filter(Boolean))] as string[];
    return assembleMissionGuidance({ activation, qsoCount, picture, evaluatedAtUtc: evaluatedAtUtc ?? activation.updatedAtUtc, modeledBands, currentBand: current?.band, currentMode: current?.mode });
  }, [activation, base.modeled, evaluatedAtUtc, picture, qsoCount, remote.txContexts]);
  return <section aria-label="Layered propagation picture" className="rounded-xl border border-indigo-700/70 bg-indigo-950/20 p-3 space-y-3">
    <div><h3 className="text-sm font-black uppercase text-indigo-300">LAYERED PROPAGATION PICTURE</h3><p className="text-[10px] text-slate-400">Four attributable evidence layers. Differences are shown without blending them into a score.</p></div>
    {loading && <p role="status" className="text-[10px] text-slate-400">Loading retained and local evidence...</p>}
    <section aria-label="What this means now" className="rounded border border-amber-700/70 bg-amber-950/20 p-2 space-y-1"><h4 className="text-[10px] font-black uppercase text-amber-300">WHAT THIS MEANS NOW</h4><ul className="list-disc pl-4 text-[10px] text-amber-100">{picture.whatThisMeansNow.map(item => <li key={item}>{item}</li>)}</ul></section>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{picture.layers.map(layer => <article key={layer.id} className="rounded border border-slate-700 bg-slate-950/60 p-2 space-y-1"><div className="flex justify-between gap-2"><strong className="text-[10px] uppercase text-slate-100">{layer.label}</strong><span className="text-[9px] font-black uppercase text-indigo-300">{layer.state.replace('_', ' ')}</span></div><p className="text-[10px] text-slate-200">{layer.summary}</p><p className="text-[9px] text-slate-400">Source: {layer.source}</p><p className="text-[9px] text-slate-400">Timing: {layer.timing}</p><p className="text-[9px] text-slate-400">Applies to: {layer.applicability}</p><ul className="list-disc pl-4 text-[9px] text-slate-500">{layer.limitations.map(item => <li key={item}>{item}</li>)}</ul></article>)}</div>
    {picture.relationships.length > 0 && <div><h4 className="text-[10px] font-black uppercase text-amber-300">LAYER DIFFERENCES</h4><ul className="list-disc pl-4 text-[10px] text-amber-100">{picture.relationships.map(item => <li key={item}>{item}</li>)}</ul></div>}
    <p className="text-[9px] text-slate-500">{picture.limitation}</p>
    <section aria-label="Mission-aware operating guidance" className="rounded border border-emerald-700/70 bg-emerald-950/20 p-2 space-y-2">
      <div className="flex flex-wrap justify-between gap-2"><h4 className="text-[10px] font-black uppercase text-emerald-300">NEXT-STEP GUIDANCE</h4><span className="text-[9px] font-black uppercase text-emerald-200">{guidance.category.replace('_', ' ')} / {guidance.urgency}</span></div>
      <p className="text-[11px] font-bold text-slate-100">{guidance.action}</p>
      {(guidance.suggestedBand || guidance.suggestedMode) && <p className="text-[10px] text-emerald-100">Suggested context: {guidance.suggestedBand ?? 'Band not specified'} / {guidance.suggestedMode ?? 'Mode not specified'}</p>}
      <p className="text-[10px] text-slate-300">Goal: {guidance.inputs.goalLabel} · Progress: {guidance.inputs.completedQsos}{guidance.inputs.requiredQsos === null ? ' QSOs' : `/${guidance.inputs.requiredQsos} QSOs`}{guidance.inputs.deadlineUtc ? ` · ${guidance.inputs.minutesRemaining} minutes to ${guidance.inputs.deadlineUtc} (${guidance.inputs.deadlineBasis} / ${guidance.inputs.deadlineProvenance})` : ' · No explicit deadline'}</p>
      <ul className="list-disc pl-4 text-[10px] text-slate-300">{guidance.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
      <p className="text-[9px] text-slate-500">Evidence references: {guidance.evidenceReferences.join(', ') || 'none'} · Evaluated {guidance.evaluatedAtUtc}</p>
      <ul className="list-disc pl-4 text-[9px] text-slate-500">{guidance.limitations.map(item => <li key={item}>{item}</li>)}</ul>
    </section>
  </section>;
};

async function readRecord(url: string, signal: AbortSignal): Promise<any | null> { const response = await fetch(url, { cache: 'no-store', signal }); if (!response.ok) throw new Error('Retained evidence is unavailable.'); const payload = await response.json(); return payload?.record ?? null; }
