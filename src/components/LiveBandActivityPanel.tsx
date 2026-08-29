import React, { useEffect, useRef, useState } from 'react';
import { fetchLiveBandActivity, type LiveBandActivityApiError } from '../liveBandActivityApi';
import type { LiveBandActivity } from '../../server/liveBandActivity';

export const LIVE_BAND_ACTIVITY_REFRESH_INTERVAL_MS = 30_000;

interface LiveBandActivityPanelProps {
  readonly active: boolean;
}

type LoadState = 'loading' | 'ready' | 'error';

export const LiveBandActivityPanel: React.FC<LiveBandActivityPanelProps> = ({ active }) => {
  const [activity, setActivity] = useState<LiveBandActivity | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const refresh = async () => {
      if (requestInFlight.current) return;
      requestInFlight.current = true;
      const nextController = new AbortController();
      controller.current = nextController;
      if (!activity) setLoadState('loading');
      try {
        const next = await fetchLiveBandActivity(nextController.signal);
        if (!cancelled) { setActivity(next); setLoadState('ready'); setError(null); }
      } catch (reason) {
        if (!cancelled && reason instanceof DOMException && reason.name === 'AbortError') return;
        if (!cancelled) { setLoadState('error'); setError(reason instanceof Error ? reason.message : 'Live Band Activity is unavailable.'); }
      } finally {
        requestInFlight.current = false;
        controller.current = null;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), LIVE_BAND_ACTIVITY_REFRESH_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(timer); controller.current?.abort(); requestInFlight.current = false; };
  }, [active]);

  return <section aria-label="Live Band Activity" className="rounded border border-cyan-800/80 bg-cyan-950/20 p-2 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-[11px] font-black uppercase text-cyan-300">LIVE BAND ACTIVITY</h3><p className="text-[10px] text-slate-400">PSKReporter digital reception reports</p></div>
      {activity && <StatusLabel activity={activity} />}
    </div>
    {loadState === 'loading' && <p role="status" className="text-[10px] text-slate-400">Loading recent activity...</p>}
    {loadState === 'error' && <p role="alert" className="text-[10px] text-amber-200">{error || 'Live Band Activity is unavailable.'}</p>}
    {loadState === 'ready' && activity && <>
      {activity.status === 'unavailable' ? <p className="text-[10px] text-amber-200">No observed-RF source is available; band counts are not asserted.</p> : <div className="grid grid-cols-2 sm:grid-cols-5 gap-1">{activity.bands.map(band => <div key={band.band} data-testid={`live-band-row-${band.band}`} className="rounded border border-slate-800 bg-slate-900/70 px-2 py-1.5"><strong className="block text-[11px] text-slate-100">{band.band}</strong><span className="block text-[10px] text-slate-300">{band.reportCount} {band.reportCount === 1 ? 'report' : 'reports'}</span><span className="block text-[9px] text-slate-500">{directionText(band)}</span></div>)}</div>}
      <p className="text-[10px] text-slate-400">{activity.windowMinutes}-minute observation window. {activity.limitation}</p>
    </>}
  </section>;
};

const StatusLabel: React.FC<{ activity: LiveBandActivity }> = ({ activity }) => {
  const total = activity.bands.reduce((sum, band) => sum + band.reportCount, 0);
  const text = activity.status === 'live' ? total > 0 ? `LIVE · ${total} REPORTS` : 'LIVE · NO MATCHING REPORTS' : activity.status === 'cached' ? 'CACHED' : activity.status === 'stale' ? 'STALE' : activity.status === 'unavailable' ? 'UNAVAILABLE' : activity.status.toUpperCase();
  return <span className="rounded border border-slate-700 px-2 py-1 text-[9px] font-black uppercase text-slate-300">{text}</span>;
};

function directionText(band: LiveBandActivity['bands'][number]): string {
  const parts = [`${band.outboundCount} out`, `${band.inboundCount} in`];
  if (band.localCount > 0) parts.push(`${band.localCount} local`);
  return parts.join(' / ');
}
