import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Activation } from '../../server/activation';
import type { StationSignalObservation, TxContext } from '../../server/operationalIntelligence';
import type { CurrentStationState } from '../currentStationState';
import { captureStationSignalObservation, getOperationalIntelligence, openTxContext } from '../operationalIntelligenceApi';
import { AMATEUR_BAND_OPTIONS, OPERATING_MODE_OPTIONS } from '../qsoOperatingVocabulary';
import { PROPAGATION_GUIDANCE_BANDS, PROPAGATION_MODES } from '../propagation/domain';

interface Props {
  readonly activation: Activation;
  readonly stationState?: CurrentStationState | null;
  readonly readOnly?: boolean;
  readonly plannedSetup?: { readonly radioSetupLabel: string; readonly antennaLabel: string; readonly transmitPowerWatts: number };
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
  frequencyMHz: station?.frequencyMHz === null || station?.frequencyMHz === undefined ? '' : String(station.frequencyMHz),
});

export const MySignalPanel: React.FC<Props> = ({ activation, stationState = null, readOnly = false, plannedSetup }) => {
  const [contexts, setContexts] = useState<readonly TxContext[]>([]);
  const [observations, setObservations] = useState<readonly StationSignalObservation[]>([]);
  const [form, setForm] = useState<FormState>(() => initialForm(stationState, plannedSetup));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [replacingContext, setReplacingContext] = useState(false);
  const formTouched = useRef(false);
  const stationSeeded = useRef(false);
  const openContext = useMemo(() => contexts.find(context => context.endedAtUtc === undefined) ?? null, [contexts]);

  useEffect(() => {
    const controller = new AbortController();
    formTouched.current = false; stationSeeded.current = false; setForm(initialForm(stationState, plannedSetup)); setReplacingContext(false); setContexts([]); setObservations([]); setLoading(true); setMessage(null);
    void getOperationalIntelligence(activation.activationId, controller.signal)
      .then(result => { setContexts(result.txContexts); setObservations(result.observations); })
      .catch(error => { if (error?.name !== 'AbortError') setMessage(error instanceof Error ? error.message : 'MY SIGNAL evidence could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [activation.activationId]);

  useEffect(() => {
    if (readOnly || openContext || !stationState || stationSeeded.current || formTouched.current) return;
    setForm(previous => ({ ...previous, band: (PROPAGATION_GUIDANCE_BANDS as readonly string[]).includes(stationState.band) ? stationState.band : previous.band, mode: (PROPAGATION_MODES as readonly string[]).includes(stationState.mode) ? stationState.mode : previous.mode, frequencyMHz: stationState.frequencyMHz === null ? previous.frequencyMHz : String(stationState.frequencyMHz) }));
    stationSeeded.current = true;
  }, [openContext, readOnly, stationState]);

  const editForm = (changes: Partial<FormState>) => { formTouched.current = true; setForm(previous => ({ ...previous, ...changes })); };

  const saveContext = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const stationBand = stationState?.source === 'wsjtx' && stationState.band === form.band;
      const stationMode = stationState?.source === 'wsjtx' && stationState.mode === form.mode;
      const stationFrequency = stationState?.source === 'wsjtx' && stationState.frequencyMHz !== null && String(stationState.frequencyMHz) === form.frequencyMHz;
      const context = await openTxContext(activation.activationId, {
        radioSetupLabel: form.radioSetupLabel.trim(), antennaLabel: form.antennaLabel.trim(), transmitPowerWatts: Number(form.transmitPowerWatts),
        band: form.band as TxContext['band'], mode: form.mode as TxContext['mode'], ...(form.frequencyMHz ? { frequencyMHz: Number(form.frequencyMHz) } : {}),
        provenance: { radioSetup: plannedSetup?.radioSetupLabel === form.radioSetupLabel.trim() ? 'operator_confirmed_plan' : 'operator_entered', antenna: plannedSetup?.antennaLabel === form.antennaLabel.trim() ? 'operator_confirmed_plan' : 'operator_entered', transmitPowerWatts: plannedSetup?.transmitPowerWatts === Number(form.transmitPowerWatts) ? 'operator_confirmed_plan' : 'operator_entered', band: stationBand ? 'wsjtx_application' : 'operator_entered', mode: stationMode ? 'wsjtx_application' : 'operator_entered', ...(form.frequencyMHz ? { frequencyMHz: stationFrequency ? 'wsjtx_application' : 'operator_entered' } : {}) },
      });
      setContexts(current => [context, ...current.map(item => item.endedAtUtc === undefined ? { ...item, endedAtUtc: context.startedAtUtc } : item)]);
      setReplacingContext(false);
      setMessage('TX Context saved. MY SIGNAL capture is ready.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The TX Context could not be saved.'); }
    finally { setBusy(false); }
  };

  const capture = async () => {
    if (!openContext) return;
    setBusy(true); setMessage(null);
    try {
      const observation = await captureStationSignalObservation(activation.activationId, openContext.segmentId);
      setObservations(current => [observation, ...current]);
      setMessage(observation.matchingReportCount === 0 ? 'No matching reports observed.' : `Captured ${observation.matchingReportCount} matching report${observation.matchingReportCount === 1 ? '' : 's'}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'MY SIGNAL evidence could not be captured.'); }
    finally { setBusy(false); }
  };

  return <section className="rounded-xl border border-violet-700/70 bg-violet-950/20 p-3 space-y-3" aria-label="MY SIGNAL">
    <div><h3 className="font-black text-sm uppercase text-violet-300">MY SIGNAL</h3><p className="text-[10px] text-slate-400">Station-specific PSKReporter reception evidence—not a forecast or proof of transmission.</p></div>
    {loading && <p role="status" className="text-[11px] text-slate-400">Loading MY SIGNAL evidence...</p>}
    {!loading && !readOnly && activation.status === 'active' && (!openContext || replacingContext) && <form onSubmit={saveContext} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Field label="RADIO / SETUP"><input required aria-label="MY SIGNAL RADIO / SETUP" value={form.radioSetupLabel} onChange={event => editForm({ radioSetupLabel: event.target.value })} className={inputClass} /></Field>
      <Field label="ANTENNA"><input required aria-label="MY SIGNAL ANTENNA" value={form.antennaLabel} onChange={event => editForm({ antennaLabel: event.target.value })} className={inputClass} /></Field>
      <Field label="POWER W"><input required min="0.1" step="0.1" type="number" aria-label="MY SIGNAL POWER W" value={form.transmitPowerWatts} onChange={event => editForm({ transmitPowerWatts: event.target.value })} className={inputClass} /></Field>
      <Field label="MY SIGNAL BAND"><select aria-label="MY SIGNAL BAND" value={form.band} onChange={event => editForm({ band: event.target.value })} className={inputClass}>{AMATEUR_BAND_OPTIONS.filter(option => (PROPAGATION_GUIDANCE_BANDS as readonly string[]).includes(option.value)).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
      <Field label="MODE"><select aria-label="MY SIGNAL MODE" value={form.mode} onChange={event => editForm({ mode: event.target.value })} className={inputClass}>{OPERATING_MODE_OPTIONS.filter(option => (PROPAGATION_MODES as readonly string[]).includes(option.value)).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
      <Field label="MY SIGNAL FREQUENCY MHz"><input min="0.1" step="0.0001" type="number" aria-label="MY SIGNAL FREQUENCY MHz" value={form.frequencyMHz} onChange={event => editForm({ frequencyMHz: event.target.value })} className={inputClass} /></Field>
      <div className="col-span-2 sm:col-span-3"><button disabled={busy} className="min-h-11 rounded border border-violet-600 px-3 py-2 text-[10px] font-black text-violet-200 disabled:opacity-50">{busy ? 'SAVING...' : 'SET TX CONTEXT'}</button></div>
    </form>}
    {openContext && <div className="rounded border border-violet-800 bg-slate-950/60 p-2 space-y-2"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Datum label="CURRENT TX CONTEXT" value={`${openContext.band} / ${openContext.mode}`} /><Datum label="RADIO / ANTENNA" value={`${openContext.radioSetupLabel} / ${openContext.antennaLabel}`} /><Datum label="POWER" value={`${openContext.transmitPowerWatts} W`} /><Datum label="STARTED UTC" value={formatUtc(openContext.startedAtUtc)} /></div>{!readOnly && activation.status === 'active' && !replacingContext && <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void capture()} className="min-h-11 rounded border border-emerald-600 px-3 py-2 text-[10px] font-black text-emerald-200 disabled:opacity-50">{busy ? 'CAPTURING...' : 'CAPTURE MY SIGNAL'}</button><button type="button" disabled={busy} onClick={() => { formTouched.current = true; setForm({ radioSetupLabel: openContext.radioSetupLabel, antennaLabel: openContext.antennaLabel, transmitPowerWatts: String(openContext.transmitPowerWatts), band: openContext.band, mode: openContext.mode, frequencyMHz: openContext.frequencyMHz === undefined ? '' : String(openContext.frequencyMHz) }); setReplacingContext(true); }} className="min-h-11 rounded border border-slate-600 px-3 py-2 text-[10px] font-bold text-slate-300">CHANGE TX CONTEXT</button></div>}</div>}
    {readOnly && contexts.length > 0 && <details><summary className="min-h-8 cursor-pointer py-2 text-[10px] font-black uppercase text-violet-300">TX CONTEXT HISTORY ({contexts.length})</summary><div className="space-y-1">{contexts.map(context => <p key={context.segmentId} className="text-[10px] text-slate-300">{context.band} / {context.mode} · {context.radioSetupLabel} / {context.antennaLabel} · {context.transmitPowerWatts} W · {formatUtc(context.startedAtUtc)} to {context.endedAtUtc ? formatUtc(context.endedAtUtc) : 'Open'}</p>)}</div></details>}
    {!loading && readOnly && contexts.length === 0 && observations.length === 0 && <p className="text-[11px] text-slate-400">No retained MY SIGNAL evidence for this Activation.</p>}
    {observations.length > 0 && <div className="space-y-2"><h4 className="text-[10px] font-black uppercase text-violet-300">RETAINED OBSERVATIONS</h4>{observations.map(observation => <Observation key={observation.observationId} observation={observation} />)}</div>}
    {message && <p role="status" className="text-[11px] text-amber-200">{message}</p>}
  </section>;
};

const inputClass = 'mt-1 min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-100';
const Field: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => <label className="text-[9px] font-bold uppercase text-slate-400">{label}{children}</label>;
const Datum: React.FC<{ label: string; value: string }> = ({ label, value }) => <div><span className="block text-[9px] uppercase text-slate-500">{label}</span><span className="text-[11px] text-slate-200">{value}</span></div>;
const Observation: React.FC<{ observation: StationSignalObservation }> = ({ observation }) => <article className="rounded border border-slate-700 bg-slate-950/60 p-2 space-y-1"><div className="flex flex-wrap justify-between gap-2"><strong className="text-[11px] uppercase text-slate-100">{observation.matchingReportCount === 0 ? 'No matching reports observed' : `${observation.matchingReportCount} reports / ${observation.uniqueReceiverCount} receivers`}</strong><span className="text-[9px] uppercase text-violet-300">{observation.status}</span></div><p className="text-[10px] text-slate-400">{formatUtc(observation.startsAtUtc)} to {formatUtc(observation.endsAtUtc)}</p><p className="text-[10px] text-slate-300">Exposure rate: {formatRate(observation.reportsPerMinute)} reports/min · {formatRate(observation.uniqueReceiversPerMinute)} unique receivers/min.</p>{observation.distance && <p className="text-[10px] text-slate-300">Approx. distance: {Math.round(observation.distance.nearestKm)}–{Math.round(observation.distance.farthestKm)} km; median {Math.round(observation.distance.medianKm)} km ({observation.distance.locatedReportCount} located).</p>}{observation.snr && <p className="text-[10px] text-slate-300">SNR: {observation.snr.minimumDb} to {observation.snr.maximumDb} dB; median {observation.snr.medianDb} dB.</p>}<ul className="list-disc pl-4 text-[9px] text-slate-500">{observation.limitations.map(item => <li key={item}>{item}</li>)}</ul></article>;
function formatUtc(value: string): string { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toISOString().replace('T', ' ').replace('.000Z', ' UTC'); }
function formatRate(value: number | undefined): string { return value === undefined ? 'Unavailable' : value.toFixed(2); }
