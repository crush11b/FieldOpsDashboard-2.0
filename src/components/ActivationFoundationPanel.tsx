import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SmartDeployBriefV2 } from '../../server/smartDeployBrief';
import type { Activation } from '../../server/activation';
import { startActivationFromBrief, updateActivationStatus } from '../activationApi';
import { QsoLoggerPanel } from './QsoLoggerPanel';
import { ActivationReviewPanel } from './ActivationReviewPanel';
import { CurrentStationStatePanel } from './CurrentStationStatePanel';
import type { CurrentStationState } from '../currentStationState';

interface ActivationFoundationPanelProps {
  readonly brief: SmartDeployBriefV2;
  readonly initialActivation?: Activation | null;
  readonly onActivationChange?: (activation: Activation | null) => void;
  readonly showReview?: boolean;
}

export const ActivationFoundationPanel: React.FC<ActivationFoundationPanelProps> = ({ brief, initialActivation = null, onActivationChange, showReview = true }) => {
  const [activation, setActivation] = useState<Activation | null>(initialActivation);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [stationState, setStationState] = useState<CurrentStationState | null>(null);
  const mounted = useRef(false);
  useEffect(() => { setActivation(initialActivation); if (mounted.current) setStationState(null); mounted.current = true; setMessage(null); setReviewOpen(false); }, [brief.briefId, initialActivation]);
  const publishActivation = (next: Activation | null) => { setActivation(next); setStationState(next?.status === 'active' ? stationState : null); onActivationChange?.(next); };
  const updateStationState = useCallback((next: CurrentStationState) => setStationState(next), []);
    const start = async () => { setBusy(true); setMessage(null); const result = await startActivationFromBrief(brief.briefId); if (result.kind !== 'activation') { setMessage(result.message); setBusy(false); return; } publishActivation(result.activation); setBusy(false); };
  const changeStatus = async (status: Activation['status']) => { if (!activation) return; setBusy(true); setMessage(null); const result = await updateActivationStatus(activation.activationId, status); if (result.kind === 'activation') publishActivation(result.activation); else setMessage(result.message); setBusy(false); };
  const location = activation?.plannedLocation;
  return <section className="rounded-xl border border-cyan-700/70 bg-cyan-950/20 p-3 space-y-3" aria-label="Activation">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-black text-sm uppercase text-cyan-300">{activation?.reference || brief.activation.reference}{(activation?.title || brief.activation.displayName) ? ` - ${activation?.title || brief.activation.displayName}` : ''}</h3><p className="text-[10px] text-slate-400">{activation ? `${activation.status.toUpperCase()}${activation.status === 'active' && activation.startedAtUtc ? ` · Started ${formatUtc(activation.startedAtUtc)}` : ''}` : 'PLANNED'}</p></div>{!activation && <button type="button" onClick={() => void start()} disabled={busy} className="min-h-11 rounded border border-emerald-600 px-3 py-2 text-[10px] font-black text-emerald-200">{busy ? 'STARTING...' : 'START ACTIVATION'}</button>}</div>
    {activation && <><div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><Detail label="PLANNED LOCATION" value={location ? `${location.gridSquare || 'Grid unavailable'}` : 'Unknown'} /><Detail label="MISSION WINDOW" value={activation.missionWindow ? `${formatUtc(activation.missionWindow.start)} to ${formatUtc(activation.missionWindow.end)}` : 'Unknown'} /></div><div className="flex flex-wrap items-center gap-2">{activation.status === 'planned' && <button type="button" disabled={busy} onClick={() => void start()} className="min-h-11 rounded border border-emerald-700 px-3 py-2 text-[10px] font-bold text-emerald-200">START ACTIVATION</button>}{activation.status === 'active' && <button type="button" disabled={busy} onClick={() => void changeStatus('completed')} className="min-h-11 rounded border border-amber-700 px-3 py-2 text-[10px] font-bold text-amber-200">END ACTIVATION</button>}{showReview && <button type="button" onClick={() => setReviewOpen(open => !open)} className="min-h-11 rounded border border-emerald-700 px-3 py-2 text-[10px] font-bold text-emerald-200">{reviewOpen ? 'CLOSE REVIEW' : 'REVIEW ACTIVATION'}</button>}{activation.notesCollectionId && <a href="#activation-notes" className="min-h-11 rounded border border-cyan-700 px-3 py-3 text-[10px] font-bold text-cyan-200">OPEN ASSOCIATED NOTES</a>}</div><details className="rounded border border-slate-700 bg-slate-950/50 p-2"><summary className="cursor-pointer text-[10px] font-black uppercase text-cyan-300">Technical Details</summary><div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2"><Detail label="ACTIVATION RECORD" value={activation.activationId} /><Detail label="BRIEF" value={activation.briefId || 'Not associated'} /></div></details>{showReview && reviewOpen && <ActivationReviewPanel activation={activation} />}<CurrentStationStatePanel activation={activation} state={stationState} /><QsoLoggerPanel activation={activation} onOperatingContextChange={updateStationState} /></>}
    {message && <p role="alert" className="text-[11px] text-amber-200">{message}</p>}
  </section>;
};
const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded border border-slate-800 bg-slate-900/70 p-2"><span className="block text-[9px] uppercase text-slate-500">{label}</span><span className="block mt-0.5 break-words text-[11px] text-slate-200">{value}</span></div>;
function formatUtc(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toISOString().replace('T', ' ').replace('.000Z', ' UTC'); }