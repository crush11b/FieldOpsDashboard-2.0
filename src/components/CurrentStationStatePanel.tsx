import React from 'react';
import type { Activation } from '../../server/activation';
import type { CurrentStationState } from '../currentStationState';

interface CurrentStationStatePanelProps {
  readonly activation: Activation;
  readonly state: CurrentStationState | null;
}

export const CurrentStationStatePanel: React.FC<CurrentStationStatePanelProps> = ({ activation, state }) => {
  const active = activation.status === 'active';
  return <section aria-label="Current station state" className="rounded-xl border border-emerald-700/70 bg-emerald-950/20 p-3 space-y-2">
    <h3 className="font-black text-sm uppercase text-emerald-300">CURRENT STATION</h3>
    {!active || !state ? <p role="status" className="text-[11px] text-slate-300">Current station state unavailable.</p> : <>
      <p className="text-[14px] font-black text-slate-100">{state.band} · {state.mode}</p>
      <p className="text-[11px] text-slate-200">{state.frequencyMHz === null ? 'Frequency not set' : `${state.frequencyMHz} MHz`}</p>
      <p className="text-[10px] text-slate-400">Source: Manual operating context · Status: {state.status === 'available' ? 'Current' : state.status}</p>
      <p className="text-[10px] text-slate-500">Operator updated: {formatUtc(state.operatorUpdatedAtUtc)} · Freshness: operator-set</p>
      <p className="text-[10px] text-amber-200">Limitation: {state.limitation}</p>
    </>}
  </section>;
};

function formatUtc(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toISOString().replace('T', ' ').replace('.000Z', ' UTC'); }