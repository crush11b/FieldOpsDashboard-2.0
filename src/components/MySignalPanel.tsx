import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Activation } from '../../server/activation';
import type { StationSignalObservation, TxContext } from '../../server/operationalIntelligence';
import type { CurrentStationState } from '../currentStationState';
import { captureStationSignalObservation, getOperationalIntelligence, openTxContext, OperationalIntelligenceRequestError } from '../operationalIntelligenceApi';
import { AMATEUR_BAND_OPTIONS, getConventionalFrequencyMHz, OPERATING_MODE_OPTIONS } from '../qsoOperatingVocabulary';
import { PROPAGATION_GUIDANCE_BANDS, PROPAGATION_MODES } from '../propagation/domain';
import { formatUtc } from '../utils/formatUtc';
import { deriveMySignalDecisionWindow, formatDecisionWindowDuration, MY_SIGNAL_TIMING_POLICY, summarizeConsecutiveZeroObservations, type MySignalDecisionWindowState } from '../operationalIntelligenceDecisionWindow';

interface Props {
  readonly activation: Activation;
  readonly stationState?: CurrentStationState | null;
  readonly readOnly?: boolean;
  readonly plannedSetup?: { readonly radioSetupLabel: string; readonly antennaLabel: string; readonly transmitPowerWatts: number };
  readonly onOperationalIntelligenceChange?: (snapshot: { readonly txContexts: readonly TxContext[]; readonly observations: readonly StationSignalObservation[] }) => void;
}

interface FormState {
  readonly radioSetupLabel: string;
  readonly antennaLabel: string;
  readonly transmitPowerWatts: string;
  readonly band: string;
  readonly mode: string;
  readonly frequencyMHz: string;
}

const initialForm = (station?: CurrentStationState | null, planned?: Props['plannedSetup']): FormState => ({
  radioSetupLabel: planned?.radioSetupLabel || '', antennaLabel: planned?.antennaLabel || '', transmitPowerWatts: planned ? String(planned.transmitPowerWatts) : '',
  band: (PROPAGATION_GUIDANCE_BANDS as readonly string[]).includes(station?.band || '') ? station!.band : '20m', mode: (PROPAGATION_MODES as readonly string[]).includes(station?.mode || '') ? station!.mode : 'FT8',
  frequencyMHz: station?.frequencyMHz === null || station?.frequencyMHz === undefined ? String(getConventionalFrequencyMHz((PROPAGATION_GUIDANCE_BANDS as readonly string[]).includes(station?.band || '') ? station!.band : '20m', (PROPAGATION_MODES as readonly string[]).includes(station?.mode || '') ? station!.mode : 'FT8') ?? '') : String(station.frequencyMHz),
});

export const MySignalPanel: React.FC<Props> = ({ activation, stationState = null, readOnly = false, plannedSetup, onOperationalIntelligenceChange }) => {
  const [contexts, setContexts] = useState<readonly TxContext[]>([]);
  const [observations, setObservations] = useState<readonly StationSignalObservation[]>([]);
  const [form, setForm] = useState<FormState>(() => initialForm(stationState, plannedSetup));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [queryPending, setQueryPending] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerErrorCode, setProviderErrorCode] = useState<string | null>(null);
  const [lastAttemptAtMs, setLastAttemptAtMs] = useState<number | null>(null);
  const [lastCompletedAtMs, setLastCompletedAtMs] = useState<number | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const [replacingContext, setReplacingContext] = useState(false);
  const formTouched = useRef(false);
  const stationSeeded = useRef(false);
  const previousWsjtxContext = useRef<string | null>(null);
  const captureInFlight = useRef(false);
  const captureRef = useRef<() => void>(() => undefined);
  const openContext = useMemo(() => contexts.find(context => context.endedAtUtc === undefined) ?? null, [contexts]);
  const orderedObservations = useMemo(() => [...observations].sort((left, right) => right.endsAtUtc.localeCompare(left.endsAtUtc) || right.observationId.localeCompare(left.observationId)), [observations]);
  const decision = useMemo(() => deriveMySignalDecisionWindow({ openContext, observations: orderedObservations, nowMs: clockMs, queryPending, providerError, providerErrorCode }), [clockMs, openContext, orderedObservations, providerError, providerErrorCode, queryPending]);
  const scheduleAtMs = openContext ? Math.max(decision.nextEligibleAtMs ?? 0, lastAttemptAtMs === null ? 0 : lastAttemptAtMs + MY_SIGNAL_TIMING_POLICY.minimumRefreshIntervalMs) : null;
  const canCapture = !readOnly && activation.status === 'active' && Boolean(openContext) && !queryPending && scheduleAtMs !== null && clockMs >= scheduleAtMs;

  useEffect(() => {
    const controller = new AbortController();
    formTouched.current = false; stationSeeded.current = false; setForm(initialForm(stationState, plannedSetup)); setReplacingContext(false); setContexts([]); setObservations([]); setLoading(true); setQueryPending(false); setProviderError(null); setProviderErrorCode(null); setLastAttemptAtMs(null); setLastCompletedAtMs(null); setMessage(null);
    previousWsjtxContext.current = null;
    void getOperationalIntelligence(activation.activationId, controller.signal)
      .then(result => { setContexts(result.txContexts); setObservations(result.observations); onOperationalIntelligenceChange?.(result); })
      .catch(error => { if (error?.name !== 'AbortError') setMessage(error instanceof Error ? error.message : 'MY SIGNAL evidence could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [activation.activationId]);

  useEffect(() => {
    if (readOnly || !openContext || activation.status !== 'active') return;
    const timer = window.setInterval(() => setClockMs(Date.now()), MY_SIGNAL_TIMING_POLICY.countdownTickMs);
    return () => window.clearInterval(timer);
  }, [activation.status, openContext, readOnly]);

  useEffect(() => {
    if (readOnly || loading || !openContext || activation.status !== 'active' || queryPending || scheduleAtMs === null) return;
    const delay = Math.max(0, scheduleAtMs - Date.now());
    const timer = window.setTimeout(() => { if (Date.now() >= scheduleAtMs) captureRef.current(); }, delay);
    return () => window.clearTimeout(timer);
  }, [activation.status, loading, openContext, queryPending, readOnly, scheduleAtMs]);

  useEffect(() => {
    if (readOnly || openContext || !stationState || stationSeeded.current || formTouched.current) return;
    setForm(previous => ({ ...previous, band: (PROPAGATION_GUIDANCE_BANDS as readonly string[]).includes(stationState.band) ? stationState.band : previous.band, mode: (PROPAGATION_MODES as readonly string[]).includes(stationState.mode) ? stationState.mode : previous.mode, frequencyMHz: stationState.frequencyMHz === null ? previous.frequencyMHz : String(stationState.frequencyMHz) }));
    stationSeeded.current = true;
  }, [openContext, readOnly, stationState]);

  useEffect(() => {
    if (readOnly || !openContext || stationState?.source !== 'wsjtx') return;
    const key = `${stationState.band}/${stationState.mode}/${stationState.frequencyMHz ?? ''}`;
    const changed = previousWsjtxContext.current !== null && previousWsjtxContext.current !== key;
    previousWsjtxContext.current = key;
    if (!changed || (stationState.band === openContext.band && stationState.mode === openContext.mode && stationState.frequencyMHz === openContext.frequencyMHz)) return;
    formTouched.current = true;
    setForm(previous => ({ ...previous, band: stationState.band, mode: stationState.mode, frequencyMHz: stationState.frequencyMHz === null ? String(getConventionalFrequencyMHz(stationState.band, stationState.mode) ?? '') : String(stationState.frequencyMHz) }));
    setReplacingContext(true);
    setLastAttemptAtMs(null);
    setMessage('WSJT-X station context changed. Review and save a replacement TX Context.');
  }, [openContext, readOnly, stationState]);

  const editForm = (changes: Partial<FormState>) => { formTouched.current = true; setForm(previous => ({ ...previous, ...changes })); };
  const editOperatingField = (field: 'band' | 'mode', value: string) => {
    const next = { ...form, [field]: value };
    const previousDefault = getConventionalFrequencyMHz(form.band, form.mode);
    const nextDefault = getConventionalFrequencyMHz(next.band, next.mode);
    editForm({ ...next, frequencyMHz: !form.frequencyMHz || Number(form.frequencyMHz) === previousDefault ? String(nextDefault ?? '') : form.frequencyMHz });
  };

  const saveContext = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(null); setProviderError(null); setProviderErrorCode(null);
    try {
      const stationBand = stationState?.source === 'wsjtx' && stationState.band === form.band;
      const stationMode = stationState?.source === 'wsjtx' && stationState.mode === form.mode;
      const stationFrequency = stationState?.source === 'wsjtx' && stationState.frequencyMHz !== null && String(stationState.frequencyMHz) === form.frequencyMHz;
      const context = await openTxContext(activation.activationId, {
        radioSetupLabel: form.radioSetupLabel.trim(), antennaLabel: form.antennaLabel.trim(), transmitPowerWatts: Number(form.transmitPowerWatts),
        band: form.band as TxContext['band'], mode: form.mode as TxContext['mode'], ...(form.frequencyMHz ? { frequencyMHz: Number(form.frequencyMHz) } : {}),
        provenance: { radioSetup: plannedSetup?.radioSetupLabel === form.radioSetupLabel.trim() ? 'operator_confirmed_plan' : 'operator_entered', antenna: plannedSetup?.antennaLabel === form.antennaLabel.trim() ? 'operator_confirmed_plan' : 'operator_entered', transmitPowerWatts: plannedSetup?.transmitPowerWatts === Number(form.transmitPowerWatts) ? 'operator_confirmed_plan' : 'operator_entered', band: stationBand ? 'wsjtx_application' : 'operator_entered', mode: stationMode ? 'wsjtx_application' : 'operator_entered', ...(form.frequencyMHz ? { frequencyMHz: stationFrequency ? 'wsjtx_application' : 'operator_entered' } : {}) },
      });
      setContexts(current => { const next = [context, ...current.map(item => item.endedAtUtc === undefined ? { ...item, endedAtUtc: context.startedAtUtc } : item)]; onOperationalIntelligenceChange?.({ txContexts: next, observations }); return next; });
      setLastAttemptAtMs(null);
      setReplacingContext(false);
      setMessage('TX Context saved. MY SIGNAL capture is ready.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The TX Context could not be saved.'); }
    finally { setBusy(false); }
  };

  const capture = async () => {
    if (!openContext || captureInFlight.current) return;
    captureInFlight.current = true; setBusy(true); setQueryPending(true); setProviderError(null); setProviderErrorCode(null); setMessage(null); setLastAttemptAtMs(Date.now());
    try {
      const observation = await captureStationSignalObservation(activation.activationId, openContext.segmentId);
      setObservations(current => { const next = [observation, ...current]; onOperationalIntelligenceChange?.({ txContexts: contexts, observations: next }); return next; });
      setLastCompletedAtMs(Date.now());
      setMessage(observation.matchingReportCount === 0 ? 'Capture completed with no matching reports in this bounded interval.' : `Captured ${observation.matchingReportCount} matching report${observation.matchingReportCount === 1 ? '' : 's'} from ${observation.source === 'pskreporter' ? 'PSKReporter' : 'WSPR'} for the bounded interval.`);
    } catch (error) { const reason = error instanceof Error ? error.message : 'MY SIGNAL evidence could not be captured.'; const code = error instanceof OperationalIntelligenceRequestError ? error.code : 'transport_failure'; setProviderErrorCode(code); setProviderError(reason); setMessage(reason); }
    finally { captureInFlight.current = false; setQueryPending(false); setBusy(false); }
  };
  captureRef.current = () => { void capture(); };

  const state: MySignalDecisionWindowState = readOnly && !openContext && (contexts.length > 0 || observations.length > 0) ? 'retained_evidence' : decision.state;
  const nextAt = scheduleAtMs === null ? null : new Date(scheduleAtMs).toISOString();
  return <section className="rounded border border-violet-700/70 bg-violet-950/20 p-2 space-y-2" aria-label="MY SIGNAL">
    <div><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-black text-sm uppercase text-violet-300">MY SIGNAL</h3><span className="rounded border border-violet-700 px-2 py-1 text-[9px] font-black uppercase text-violet-200">{state.replaceAll('_', ' ')}</span></div><p className="text-[10px] text-slate-400">PSKReporter matches are outbound reception evidence. Distant reception does not prove that this station can hear or contact stations in that area.</p>{openContext ? <p className="text-[10px] text-slate-500">TX Context age: {formatAge(openContext.startedAtUtc)}. Reports can take several minutes to arrive; the first check is eligible after 3 minutes.</p> : readOnly ? null : <p className="text-[10px] text-amber-200">No TX Context is open; station-specific capture is not possible.</p>}</div>
    {loading && <p role="status" className="text-[10px] text-slate-400">Loading retained MY SIGNAL data...</p>}
    {!loading && <DecisionStatus state={state} nextAt={nextAt} sessionCompletedAtMs={lastCompletedAtMs} retainedIntervalEndAtUtc={decision.latestObservation?.endsAtUtc ?? null} nowMs={clockMs} suppressMissingContext={readOnly} />}
    {!loading && !readOnly && activation.status === 'active' && (!openContext || replacingContext) && <form onSubmit={saveContext} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Field label="RADIO / SETUP"><input required aria-label="MY SIGNAL RADIO / SETUP" value={form.radioSetupLabel} onChange={event => editForm({ radioSetupLabel: event.target.value })} className={inputClass} /></Field>
      <Field label="ANTENNA"><input required aria-label="MY SIGNAL ANTENNA" value={form.antennaLabel} onChange={event => editForm({ antennaLabel: event.target.value })} className={inputClass} /></Field>
      <Field label="POWER W"><input required min="0.1" step="0.1" type="number" aria-label="MY SIGNAL POWER W" value={form.transmitPowerWatts} onChange={event => editForm({ transmitPowerWatts: event.target.value })} className={inputClass} /></Field>
      <Field label="MY SIGNAL BAND"><select aria-label="MY SIGNAL BAND" value={form.band} onChange={event => editOperatingField('band', event.target.value)} className={inputClass}>{AMATEUR_BAND_OPTIONS.filter(option => (PROPAGATION_GUIDANCE_BANDS as readonly string[]).includes(option.value)).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
      <Field label="MODE"><select aria-label="MY SIGNAL MODE" value={form.mode} onChange={event => editOperatingField('mode', event.target.value)} className={inputClass}>{OPERATING_MODE_OPTIONS.filter(option => (PROPAGATION_MODES as readonly string[]).includes(option.value)).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
      <Field label="MY SIGNAL FREQUENCY MHz"><input min="0.1" step="0.0001" type="number" aria-label="MY SIGNAL FREQUENCY MHz" value={form.frequencyMHz} onChange={event => editForm({ frequencyMHz: event.target.value })} className={inputClass} /></Field>
      <div className="col-span-2 sm:col-span-3"><button disabled={busy} className="min-h-11 rounded border border-violet-600 px-3 py-2 text-[10px] font-black text-violet-200 disabled:opacity-50">{busy ? 'SAVING...' : 'SET TX CONTEXT'}</button></div>
    </form>}
    {openContext && <div className="rounded border border-violet-800 bg-slate-950/60 p-2 space-y-2"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Datum label="CURRENT TX CONTEXT" value={`${openContext.band} / ${openContext.mode}`} /><Datum label="RADIO / ANTENNA" value={`${openContext.radioSetupLabel} / ${openContext.antennaLabel}`} /><Datum label="POWER" value={`${openContext.transmitPowerWatts} W`} /><Datum label="STARTED UTC" value={formatUtc(openContext.startedAtUtc)} /></div>{!readOnly && activation.status === 'active' && !replacingContext && <div className="flex flex-wrap gap-2"><button type="button" disabled={!canCapture} onClick={() => void capture()} className="min-h-11 rounded border border-emerald-600 px-3 py-2 text-[10px] font-black text-emerald-200 disabled:opacity-50">{queryPending ? 'QUERY PENDING...' : 'CAPTURE MY SIGNAL'}</button><button type="button" disabled={busy} onClick={() => { formTouched.current = true; setForm({ radioSetupLabel: openContext.radioSetupLabel, antennaLabel: openContext.antennaLabel, transmitPowerWatts: String(openContext.transmitPowerWatts), band: openContext.band, mode: openContext.mode, frequencyMHz: openContext.frequencyMHz === undefined ? '' : String(openContext.frequencyMHz) }); setReplacingContext(true); setLastAttemptAtMs(null); }} className="min-h-11 rounded border border-slate-600 px-3 py-2 text-[10px] font-bold text-slate-300">CHANGE TX CONTEXT</button></div>}</div>}
    {readOnly && contexts.length > 0 && <details><summary className="min-h-8 cursor-pointer py-2 text-[10px] font-black uppercase text-violet-300">TX CONTEXT HISTORY ({contexts.length})</summary><div className="space-y-1">{contexts.map(context => <p key={context.segmentId} className="text-[10px] text-slate-300">{context.band} / {context.mode} · {context.radioSetupLabel} / {context.antennaLabel} · {context.transmitPowerWatts} W · {formatUtc(context.startedAtUtc)} to {context.endedAtUtc ? formatUtc(context.endedAtUtc) : 'Open'}</p>)}</div></details>}
    {!loading && readOnly && contexts.length === 0 && observations.length === 0 && <p className="text-[10px] text-slate-400">No retained TX Context or MY SIGNAL evidence exists for this Activation.</p>}
    {!loading && readOnly && contexts.length > 0 && observations.length === 0 && <p className="text-[10px] text-slate-400">Retained TX Context history is available; no MY SIGNAL observations were captured.</p>}
    {orderedObservations.length > 0 && <RetainedObservations observations={orderedObservations} compact={readOnly} />}
    {message && <p role="status" className="text-[11px] text-amber-200">{message}</p>}
  </section>;
};

const DecisionStatus: React.FC<{ state: MySignalDecisionWindowState; nextAt: string | null; sessionCompletedAtMs: number | null; retainedIntervalEndAtUtc: string | null; nowMs: number; suppressMissingContext?: boolean }> = ({ state, nextAt, sessionCompletedAtMs, retainedIntervalEndAtUtc, nowMs, suppressMissingContext = false }) => <div className="rounded border border-violet-900 bg-slate-950/50 px-2 py-1 text-[10px] text-slate-300">{!(suppressMissingContext && state === 'missing_context') && <p>{state === 'missing_context' ? 'No TX Context is open; station-specific capture is not possible.' : state === 'retained_evidence' ? 'Retained MY SIGNAL evidence is available for this completed review.' : state === 'awaiting_provider_latency' ? `Waiting for PSKReporter provider latency. Next check in ${formatDecisionWindowDuration(Date.parse(nextAt!) - nowMs)}.` : state === 'query_pending' ? 'Checking the retained Observed RF snapshot now.' : state === 'no_matching_reports' ? 'No matching reports were returned by this mature bounded capture.' : state === 'evidence_available' ? 'Matching outbound reception evidence is available.' : state === 'stale_evidence' ? 'Retained matching evidence is stale.' : state === 'provider_unavailable' ? 'The Observed RF provider/source is unavailable; the bounded reason is shown below.' : 'The bounded capture is unavailable; the reason is shown below.'}</p>}{sessionCompletedAtMs !== null && <p className="text-slate-500">Last completed capture: {formatUtc(new Date(sessionCompletedAtMs).toISOString())}.</p>}{sessionCompletedAtMs === null && retainedIntervalEndAtUtc !== null && <p className="text-slate-500">Latest captured interval ended: {formatUtc(retainedIntervalEndAtUtc)}.</p>}{nextAt && state !== 'missing_context' && state !== 'retained_evidence' && state !== 'capture_unavailable' && state !== 'provider_unavailable' && <p className="text-slate-500">Next eligible refresh: {formatUtc(nextAt)}.</p>}</div>;
const RetainedObservations: React.FC<{ observations: readonly StationSignalObservation[]; compact?: boolean }> = ({ observations, compact = false }) => {
  if (compact) {
    const byContext = new Map<string, StationSignalObservation[]>();
    observations.forEach(observation => byContext.set(observation.txContextSegmentId, [...(byContext.get(observation.txContextSegmentId) ?? []), observation]));
    return <div className="space-y-2"><h4 className="text-[10px] font-black uppercase text-violet-300">RETAINED OBSERVATIONS BY TX CONTEXT</h4>{[...byContext.entries()].map(([contextId, values]) => { const positive = values.filter(value => value.matchingReportCount > 0); const latestPositive = positive[0]; return <article key={contextId} className="rounded border border-slate-700 bg-slate-950/60 p-2 text-[10px] text-slate-300"><strong>{contextId}: {values.length} bounded capture{values.length === 1 ? '' : 's'}</strong><p>{positive.length > 0 ? `${countLabel(positive.length, 'positive capture')}; latest capture: ${countLabel(latestPositive!.matchingReportCount, 'report')} from ${countLabel(latestPositive!.uniqueReceiverCount, 'receiver')}` : `${countLabel(values.length, 'capture')}; no matching reports observed`}. {values.filter(value => value.matchingReportCount === 0).length > 1 ? `${values.filter(value => value.matchingReportCount === 0).length} consecutive zero-report captures. ` : ''}{formatUtc(values.at(-1)!.endsAtUtc)} to {formatUtc(values[0].endsAtUtc)}</p><details><summary className="cursor-pointer text-slate-400">OPEN ALL RETAINED CAPTURES</summary><div className="mt-2 space-y-2">{values.map(observation => <Observation key={observation.observationId} observation={observation} />)}</div></details></article>; })}</div>;
  }
  const groups = summarizeConsecutiveZeroObservations(observations);
  return <div className="space-y-2"><h4 className="text-[10px] font-black uppercase text-violet-300">RETAINED OBSERVATIONS</h4>{groups.map((group, index) => group.kind === 'zero' && group.observations.length > 1 ? <details key={`zero-${index}`}><summary className="cursor-pointer text-[10px] text-slate-400">{group.observations.length} consecutive zero-report captures / {formatUtc(group.observations.at(-1)!.endsAtUtc)} to {formatUtc(group.observations[0].endsAtUtc)}</summary><div className="mt-2 space-y-2">{group.observations.map(observation => <Observation key={observation.observationId} observation={observation} compact />)}</div></details> : group.observations.map(observation => <Observation key={observation.observationId} observation={observation} compact={index > 0} />))}</div>;
};
const inputClass = 'mt-1 min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-100';
const Field: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => <label className="text-[9px] font-bold uppercase text-slate-400">{label}{children}</label>;
const Datum: React.FC<{ label: string; value: string }> = ({ label, value }) => <div><span className="block text-[9px] uppercase text-slate-500">{label}</span><span className="text-[11px] text-slate-200">{value}</span></div>;
const Observation: React.FC<{ observation: StationSignalObservation; compact?: boolean }> = ({ observation, compact = false }) => <article className={`rounded border border-slate-700 bg-slate-950/60 p-2 ${compact ? 'text-[9px]' : 'space-y-1'}`}><div className="flex flex-wrap justify-between gap-2"><strong className="text-[11px] uppercase text-slate-100">{observation.matchingReportCount === 0 ? 'No matching reports observed' : `${countLabel(observation.matchingReportCount, 'report')} / ${countLabel(observation.uniqueReceiverCount, 'receiver')}`}</strong><span className="text-[9px] uppercase text-violet-300">{observation.status} / {observation.source === 'pskreporter' ? 'PSKReporter' : 'WSPR'}</span></div><p className="text-[10px] text-slate-400">{formatUtc(observation.startsAtUtc)} to {formatUtc(observation.endsAtUtc)}</p>{!compact && <><p className="text-[10px] text-slate-300">Exposure rate: {formatRate(observation.reportsPerMinute)} reports/min · {formatRate(observation.uniqueReceiversPerMinute)} unique receivers/min.</p>{observation.distance && <p className="text-[10px] text-slate-300">Approx. distance: {Math.round(observation.distance.nearestKm)}–{Math.round(observation.distance.farthestKm)} km; median {Math.round(observation.distance.medianKm)} km ({observation.distance.locatedReportCount} located).</p>}{observation.snr && <p className="text-[10px] text-slate-300">SNR: {observation.snr.minimumDb} to {observation.snr.maximumDb} dB; median {observation.snr.medianDb} dB.</p>}<p className="text-[10px] text-slate-500">PSKReporter matches are outbound reception evidence only; they do not prove a usable return path, transmission success, or contact probability.</p><ul className="list-disc pl-4 text-[9px] text-slate-500">{observation.limitations.map(item => <li key={item}>{item}</li>)}</ul></>}</article>;
function countLabel(value: number, noun: string): string { return `${value} ${noun}${value === 1 ? '' : 's'}`; }
function formatAge(value: string): string { const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000)); return minutes < 1 ? 'less than 1 minute' : `${minutes} minute${minutes === 1 ? '' : 's'}`; }
function formatRate(value: number | undefined): string { return value === undefined ? 'Unavailable' : value.toFixed(2); }
