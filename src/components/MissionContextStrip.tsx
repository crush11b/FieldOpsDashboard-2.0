import React from 'react';
import type { Activation } from '../../server/activation';
import type { SmartDeployBriefV2 } from '../../server/smartDeployBrief';
import { deriveMissionOperationContext } from '../operations/missionOperationContext';

export const MissionContextStrip: React.FC<{ brief: SmartDeployBriefV2; activation: Activation | null; phase: 'plan' | 'prepare' | 'operate' | 'review'; qsoCount: number | null; onOpenOperate?: () => void }> = ({ brief, activation, phase, qsoCount, onOpenOperate }) => {
  const context = deriveMissionOperationContext(brief, activation);
  return <section aria-label="Mission and operation context" className="space-y-2">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-[9px] font-black uppercase text-cyan-300">{phase} · retained mission context</p><h3 className="text-sm font-black uppercase text-slate-100">{context.identity.reference}{context.identity.displayName ? ` · ${context.identity.displayName}` : ''}</h3><p className="text-[10px] text-slate-400">{context.identity.program} · Activation {readableStatus(context.lifecycle.status)}</p></div>{activation && <button type="button" className="text-[11px] font-black text-amber-200 underline" onClick={onOpenOperate}>{qsoCount === null ? 'QSOs in OPERATE' : `${qsoCount} QSOs`}</button>}</div>
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5"><Item label="PLANNED SITE" value={context.plannedSite.gridSquare || coordinates(context.plannedSite.latitude, context.plannedSite.longitude)} /><Item label="PLANNED WINDOW" value={`${formatUtc(context.missionWindow.start)} to ${formatUtc(context.missionWindow.end)}`} /><Item label="PLANNED STATION" value={`${context.station.radio} · ${context.station.antenna} · ${context.station.transmitPowerWatts} W`} /><Item label="RETAINED LOADOUT" value={context.loadout ? `${context.loadout.name} · ${context.loadout.itemCount} item${context.loadout.itemCount === 1 ? '' : 's'}` : 'None selected'} /><Item label="OBJECTIVE" value={context.objective?.label || 'Set in PREPARE'} /></div>
    {context.inconsistencies.length > 0 && <div role="alert" className="rounded border border-amber-700/70 bg-amber-950/30 p-2 text-[10px] text-amber-200">{context.inconsistencies.join(' ')}</div>}
  </section>;
};

const Item: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded border border-slate-800 bg-slate-900/70 p-2"><span className="block text-[9px] uppercase text-slate-500">{label}</span><span className="block text-[10px] text-slate-200">{value}</span></div>;
const formatUtc = (value: string) => new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const coordinates = (lat: number | null, lon: number | null) => lat === null || lon === null ? 'Unavailable' : `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
const readableStatus = (value: string) => value === 'not_started' ? 'not started' : value;
