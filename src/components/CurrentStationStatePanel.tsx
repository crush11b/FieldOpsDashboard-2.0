import React from 'react';
import type { Activation } from '../../server/activation';
import type { CurrentStationState } from '../currentStationState';

interface CurrentStationStatePanelProps {
  readonly activation: Activation;
  readonly state: CurrentStationState | null;
  readonly wsjtxState?: CurrentStationState | null;
}

export const CurrentStationStatePanel: React.FC<CurrentStationStatePanelProps> = ({ activation, state, wsjtxState = null }) => {
  const active = activation.status === 'active';
  const current = wsjtxState?.source === 'wsjtx' ? wsjtxState : state;
  return <section aria-label="Current station state" className="rounded-xl border border-emerald-700/70 bg-emerald-950/20 p-3 space-y-2">
    <h3 className="font-black text-sm uppercase text-emerald-300">CURRENT STATION</h3>
    {!active || !current ? <p role="status" className="text-[11px] text-slate-300">Current station state unavailable.</p> : <>
      <p className="text-[14px] font-black text-slate-100">{current.band || 'Band unknown'} · {current.mode}</p>
      <p className="text-[11px] text-slate-200">{current.frequencyMHz === null ? 'Frequency not set' : `${current.frequencyMHz} MHz`}</p>
      <p className="text-[10px] text-slate-400">Source: {current.source === 'wsjtx' ? 'WSJT-X' : 'Manual operating context'} · {current.source === 'wsjtx' ? `${current.freshness === 'fresh' ? 'Live / fresh' : 'Stale'}` : 'Status: Current'}</p>
      {current.source === 'wsjtx' ? <p className="text-[10px] text-slate-500">Observed: {formatUtc(current.observedAtUtc || '')}</p> : <p className="text-[10px] text-slate-500">Operator updated: {formatUtc(current.operatorUpdatedAtUtc || '')} · Freshness: operator-set</p>}
      <p className="text-[10px] text-amber-200">Limitation: {current.limitation}</p>
    </>}
  </section>;
};

function formatUtc(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toISOString().replace('T', ' ').replace('.000Z', ' UTC'); }