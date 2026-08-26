import React, { useEffect, useRef, useState } from 'react';
import type { OperationsReadinessDisplayEvidence } from '../../server/operationsReadinessDisplayEvidence';
import type { OperationsReadinessSummary, ReadinessFinding, ReadinessStatus } from '../../server/operationsReadiness';
import type { SmartDeployBriefV2 } from '../../server/smartDeployBrief';
import { getOperationsReadinessForBrief, OperationsReadinessApiError } from '../operationsReadinessApi';
import { synchronizeClock } from '../clockApi';
import { prepareForOfflineOperation, type OfflinePreparationResult } from '../offlinePreparationApi';

interface OperationsReadinessWorkspaceProps { readonly brief: SmartDeployBriefV2; readonly onStartActivation?: () => Promise<void>; }
type LoadState = 'loading' | 'ready' | 'error' | 'unsupported';

export const OperationsReadinessWorkspace: React.FC<OperationsReadinessWorkspaceProps> = ({ brief, onStartActivation }) => {
  const briefId = brief.briefId;
  const [summary, setSummary] = useState<OperationsReadinessSummary | null>(null);
  const [displayEvidence, setDisplayEvidence] = useState<OperationsReadinessDisplayEvidence | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [liveLoading, setLiveLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const localSequence = useRef(0);
  const liveSequence = useRef(0);
  const localController = useRef<AbortController | null>(null);
  const liveController = useRef<AbortController | null>(null);

  useEffect(() => {
    const sequence = ++localSequence.current;
    ++liveSequence.current;
    localController.current?.abort();
    liveController.current?.abort();
    const controller = new AbortController();
    localController.current = controller;
    setSummary(null);
    setDisplayEvidence(null);
    setMessage(null);
    setLiveLoading(false);
    setLoadState('loading');
    void getOperationsReadinessForBrief(briefId, false, controller.signal).then(result => {
      if (sequence !== localSequence.current) return;
      setSummary(result.summary);
      setDisplayEvidence(result.displayEvidence);
      setLoadState('ready');
    }).catch(error => {
      if (sequence !== localSequence.current || error?.name === 'AbortError') return;
      setLoadState(error instanceof OperationsReadinessApiError && error.code === 'unsupported_brief_schema' ? 'unsupported' : 'error');
      setMessage(formatReadinessError(error, false));
    });
    return () => {
      controller.abort();
      liveController.current?.abort();
      ++localSequence.current;
      ++liveSequence.current;
    };
  }, [briefId]);

  const loadLiveWeather = async () => {
    if (!summary || liveLoading) return;
    const sequence = ++liveSequence.current;
    liveController.current?.abort();
    const controller = new AbortController();
    liveController.current = controller;
    setLiveLoading(true);
    setMessage(null);
    try {
      const result = await getOperationsReadinessForBrief(briefId, true, controller.signal);
      if (sequence !== liveSequence.current) return;
      setSummary(result.summary);
      setDisplayEvidence(result.displayEvidence);
    } catch (error) {
      if (sequence !== liveSequence.current || error?.name === 'AbortError') return;
      setMessage(formatReadinessError(error, true));
    } finally {
      if (sequence === liveSequence.current) setLiveLoading(false);
    }
  };

  const retry = () => {
    localController.current?.abort();
    liveController.current?.abort();
    localSequence.current += 1;
    liveSequence.current += 1;
    setLoadState('loading');
    setMessage(null);
    setLiveLoading(false);
    const sequence = localSequence.current;
    const controller = new AbortController();
    localController.current = controller;
    void getOperationsReadinessForBrief(briefId, false, controller.signal).then(result => {
      if (sequence !== localSequence.current) return;
      setSummary(result.summary);
      setDisplayEvidence(result.displayEvidence);
      setLoadState('ready');
    }).catch(error => {
      if (sequence !== localSequence.current || error?.name === 'AbortError') return;
      setLoadState(error instanceof OperationsReadinessApiError && error.code === 'unsupported_brief_schema' ? 'unsupported' : 'error');
      setMessage(formatReadinessError(error, false));
    });
  };

  return <section id="operations-readiness" aria-label="Operations Readiness" className="rounded-xl border border-amber-700/70 bg-amber-950/20 p-3 space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-black text-sm uppercase text-amber-300">OPERATIONS READINESS</h3><p className="text-[10px] text-slate-400">Brief-anchored decision support for {brief.activation.reference}</p></div>
      <span className="text-[10px] font-black uppercase text-slate-300">BRIEF {briefId}</span>
    </div>
    {loadState === 'loading' && <p role="status" className="text-[11px] text-slate-400">Loading local Operations Readiness...</p>}
    {loadState === 'unsupported' && <p role="status" className="text-[11px] text-amber-200">This retained brief uses an unsupported legacy schema for Operations Readiness.</p>}
    {loadState === 'error' && <div role="alert" className="space-y-2"><p className="text-[11px] text-red-200">{message}</p><button type="button" onClick={retry} className="px-3 py-2 rounded border border-amber-700 text-amber-200 text-[10px] font-bold">RETRY LOCAL READINESS</button></div>}
    {loadState === 'ready' && summary && displayEvidence && <ReadinessContent key={briefId} brief={brief} summary={summary} displayEvidence={displayEvidence} liveLoading={liveLoading} message={message} onLoadLiveWeather={() => void loadLiveWeather()} onSynchronizeClock={async () => { setMessage(null); try { await synchronizeClock(true); retry(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Clock synchronization failed.'); } }} onStartActivation={onStartActivation ? async () => { if (starting) return; setStarting(true); setMessage(null); try { await onStartActivation(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Activation could not be started.'); } finally { setStarting(false); } } : undefined} starting={starting} />}
  </section>;
};

const ReadinessContent: React.FC<{
  brief: SmartDeployBriefV2;
  summary: OperationsReadinessSummary;
  displayEvidence: OperationsReadinessDisplayEvidence;
  liveLoading: boolean;
  message: string | null;
  onLoadLiveWeather: () => void;
  onSynchronizeClock: () => void;
  onStartActivation?: () => Promise<void>;
  starting: boolean;
}> = ({ brief, summary, displayEvidence, liveLoading, message, onLoadLiveWeather, onSynchronizeClock, onStartActivation, starting }) => {
  const checklist = summary.findings.find(finding => finding.id === 'field-readiness-checklist');
  const findingSummary = summarizeFindingStatuses(summary.findings);
  const findingsId = 'operations-readiness-findings';
  const [findingsExpanded, setFindingsExpanded] = useState(false);
  const [clockConfirmed, setClockConfirmed] = useState(false);
  const [offlinePreparation, setOfflinePreparation] = useState<OfflinePreparationResult | null>(null);
  const [offlineLoading, setOfflineLoading] = useState(false);
  const [offlineMessage, setOfflineMessage] = useState<string | null>(null);
  const attention = summary.findings.filter(finding => finding.status !== 'ready' && finding.recommendedAction).slice(0, 4);
  const weatherText = displayEvidence.weather.status === 'not_requested' ? 'Weather not loaded' : findingMessage(summary, 'weather');
  const alertsText = displayEvidence.alerts.status === 'not_requested' ? 'Alerts not loaded' : findingMessage(summary, 'weather-alerts');
  return <>
    <section className="rounded-lg border border-emerald-700/70 bg-emerald-950/20 p-3 space-y-2" aria-label="Summit readiness summary">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-[11px] uppercase text-emerald-300">SUMMIT READINESS</strong><span className="text-[10px] text-slate-400">{formatUtc(summary.evaluatedAtUtc)}</span></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{readinessCard('Location', `${brief.plannedOperatingSite.location.gridSquare || 'Site unavailable'} / ${findingMessage(summary, 'current-location')}`, findFinding(summary, 'current-location')?.status)}{readinessCard('GPS', findingMessage(summary, 'current-location'), findFinding(summary, 'current-location')?.status)}{readinessCard('Clock', findingMessage(summary, 'clock-synchronization'), findFinding(summary, 'clock-synchronization')?.status)}{readinessCard('ToughBook', summary.toughBook.status === 'ready' ? `${summary.toughBook.chargePercent ?? 'Unknown'}% / ${summary.toughBook.powerSource}` : 'Power unknown', summary.toughBook.status)}{readinessCard('Weather', weatherText, displayEvidence.weather.status === 'not_requested' ? 'unknown' : findFinding(summary, 'weather')?.status)}{readinessCard('Alerts', alertsText, displayEvidence.alerts.status === 'not_requested' ? 'unknown' : findFinding(summary, 'weather-alerts')?.status)}{readinessCard('Space Weather', 'Retained plan evidence', 'ready')}{readinessCard('Propagation', findingMessage(summary, 'propagation-evidence'), findFinding(summary, 'propagation-evidence')?.status)}{readinessCard('Checklist', findingMessage(summary, 'field-readiness-checklist'), findFinding(summary, 'field-readiness-checklist')?.status)}</div>
      {onStartActivation && <button type="button" disabled={starting} onClick={() => void onStartActivation()} className="min-h-11 rounded border border-emerald-600 px-4 py-2 text-[11px] font-black text-emerald-200 disabled:opacity-50">{starting ? 'STARTING ACTIVATION...' : 'START ACTIVATION'}</button>}
      <button type="button" disabled={offlineLoading} className="min-h-10 px-3 py-2 rounded border border-amber-700 text-amber-200 text-[10px] font-bold disabled:opacity-50" onClick={async () => { setOfflineLoading(true); setOfflineMessage(null); try { setOfflinePreparation(await prepareForOfflineOperation(brief.briefId)); } catch (error) { setOfflineMessage(error instanceof Error ? error.message : 'Offline Preparation failed.'); } finally { setOfflineLoading(false); } }}>{offlineLoading ? 'CHECKING OFFLINE EVIDENCE...' : 'PREPARE FOR OFFLINE OPERATION'}</button>
      {attention.length > 0 && <div><strong className="text-[10px] uppercase text-amber-300">NEEDS ATTENTION</strong><ul className="list-disc pl-5 text-[10px] text-amber-100">{attention.map(finding => <li key={finding.id}>{finding.recommendedAction || finding.message}</li>)}</ul></div>}
      {offlineMessage && <p role="alert" className="text-[10px] text-amber-200">{offlineMessage}</p>}
    </section>
    <details className="rounded-lg border border-slate-700 bg-slate-950/50 p-3"><summary className="cursor-pointer text-[11px] font-black uppercase text-cyan-300">EVIDENCE DETAILS</summary>
    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-[11px] uppercase text-cyan-300">RETAINED PLAN STATUS</strong><StatusLabel status={summary.plan.status} /></div>
      <p className="text-[11px] text-slate-200">Retained plan status: {summary.plan.status}.</p>
      <p className="text-[10px] text-slate-400">Evaluated UTC: <time dateTime={summary.evaluatedAtUtc}>{formatUtc(summary.evaluatedAtUtc)}</time></p>
      <p className="text-[10px] text-slate-400">Decision support only. This is not a safety, permission, legality, or go/no-go determination.</p>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <EvidenceSection title="OPERATION / PLANNED SITE"><Detail label="ACTIVATION" value={`${brief.activation.reference}${brief.activation.displayName ? ` - ${brief.activation.displayName}` : ''}`} /><Detail label="PLANNED SITE" value={brief.plannedOperatingSite.description} /><Detail label="COORDINATES / GRID" value={`${formatCoordinates(brief.plannedOperatingSite.location.coordinates)} / ${brief.plannedOperatingSite.location.gridSquare || 'Grid unavailable'}`} /><Detail label="PLANNING SOURCE" value={`${brief.plannedOperatingSite.source} / ${brief.plannedOperatingSite.location.planningSemantics || brief.plannedOperatingSite.location.source?.type || 'unknown'}`} /></EvidenceSection>
      <EvidenceSection title="CURRENT LOCATION / CLOCK"><Detail label="CURRENT DEVICE" value={`${formatCoordinates(brief.currentDeviceLocation?.coordinates)} / ${brief.currentDeviceLocation?.gridSquare || 'Grid unavailable'}`} /><Detail label="LOCATION STATUS" value={findingMessage(summary, 'current-location')} /><FindingMetadata finding={findFinding(summary, 'current-location')} /><Detail label="CLOCK" value={findingMessage(summary, 'clock-synchronization')} /><p className="text-[10px] text-slate-400">GNSS UTC is read from the Agent-owned COM6 session. Synchronization is explicit and does not continuously steer Windows time.</p><label className="flex items-start gap-2 text-[10px] text-amber-100"><input aria-label="Confirm Windows clock synchronization" type="checkbox" className="mt-0.5" checked={clockConfirmed} onChange={event => setClockConfirmed(event.currentTarget.checked)} /> I confirm that fresh GNSS UTC may be used to set Windows time.</label><button type="button" disabled={!clockConfirmed} className="min-h-10 px-3 py-2 rounded border border-cyan-700 text-cyan-200 text-[10px] font-bold disabled:opacity-50" onClick={() => { onSynchronizeClock(); setClockConfirmed(false); }}>SYNCHRONIZE WINDOWS TIME</button><FindingMetadata finding={findFinding(summary, 'clock-synchronization')} /></EvidenceSection>
      <EvidenceSection title="TOUGHBOOK POWER"><Detail label="POWER" value={`${summary.toughBook.chargePercent === null ? 'Unknown' : `${summary.toughBook.chargePercent}%`} / ${summary.toughBook.powerSource}${summary.toughBook.charging === null ? '' : summary.toughBook.charging ? ' / charging' : ' / not charging'}`} /><Detail label="WINDOWS RUNTIME" value={runtimeText(summary.toughBook.runtimeEstimateSeconds)} /><FindingMetadata finding={findFinding(summary, 'toughbook-runtime-estimate')} /><p className="text-[10px] text-slate-400">Radio and station endurance unknown.</p></EvidenceSection>
      <EvidenceSection title="STATION / ANTENNA"><Detail label="RADIO" value={brief.station.radio.name} /><Detail label="ANTENNA" value={brief.station.antenna.name || brief.station.antenna.type} /><Detail label="MODES / POWER" value={`${brief.station.selectedModes.join(' / ') || 'Unavailable'} / ${brief.station.transmitPowerWatts} W`} /><Detail label="MODELED MODE" value={brief.station.modeledMode || 'Unavailable'} /></EvidenceSection>
    </div>

    <WeatherEvidence evidence={displayEvidence} evaluatedAtUtc={summary.evaluatedAtUtc} loading={liveLoading} onLoad={onLoadLiveWeather} />
    <EvidenceSection title="OFFLINE PREPARATION">{offlinePreparation && <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">{offlinePreparation.checks.map(check => <Detail key={check.id} label={check.id.replaceAll('-', ' ')} value={`${check.status}: ${check.message}`} />)}</div>}</EvidenceSection>
    <EvidenceSection title="PROPAGATION"><p className="text-[11px] text-slate-200">{findingMessage(summary, 'propagation-evidence')}</p><p className="text-[10px] text-slate-400">Retained mission-window propagation and observed RF evidence remain authoritative in the SmartDeploy brief. Modeling is not a guarantee; observed RF is not a forecast.</p><a href="#smartdeploy-brief" className="text-[10px] text-cyan-300 underline">Review SmartDeploy propagation details</a></EvidenceSection>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><LinkedEvidence title="FIELD READINESS CHECKLIST" finding={checklist} href="#field-readiness-checklist" /></div>
    <EvidenceSection title="NEXT ACTIONS">{summary.nextActions.length > 0 ? <ol className="list-decimal pl-5 space-y-1 text-[11px] text-amber-100">{summary.nextActions.map(action => <li key={action}>{action}</li>)}</ol> : <p className="text-[11px] text-slate-300">No additional action is identified by the available readiness evidence.</p>}</EvidenceSection>
    </details>
    <details className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 space-y-2">
      <summary className="cursor-pointer text-[11px] font-black uppercase text-cyan-300">FINDINGS DETAILS</summary>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-black text-[10px] uppercase text-amber-300">FINDINGS ({summary.findings.length})</h4>
          {findingSummary && <p className="text-[10px] text-slate-400">{findingSummary}</p>}
        </div>
        {summary.findings.length > 0 && <button type="button" className="min-h-11 px-3 py-2 rounded border border-cyan-700 text-cyan-200 text-[10px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" aria-expanded={findingsExpanded} aria-controls={findingsId} onClick={() => setFindingsExpanded(expanded => !expanded)}>{findingsExpanded ? 'Hide findings' : 'Show findings'}</button>}
      </div>
      {findingsExpanded && <div id={findingsId} className="space-y-2">{summary.findings.map(finding => <FindingRow key={finding.id} finding={finding} />)}</div>}
    </details>
    {message && <p role="alert" className="text-[11px] text-amber-200">{message}</p>}
  </>;
};

const WeatherEvidence: React.FC<{ evidence: OperationsReadinessDisplayEvidence; evaluatedAtUtc: string; loading: boolean; onLoad: () => void }> = ({ evidence, evaluatedAtUtc, loading, onLoad }) => {
  const weather = evidence.weather;
  const alerts = evidence.alerts;
  return <EvidenceSection title="DAY-OF LIVE CONDITIONS / PLANNED SITE WEATHER / ALERTS">
    <p className="text-[10px] text-slate-400">Uses the retained planned-site coordinates. Current-device location is not used as a fallback. Network access is required.</p>
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] text-slate-300">Weather: <StatusLabel status={weather.status === 'not_requested' ? 'unknown' : weather.status} text={weather.status} /></span><span className="text-[10px] text-slate-300">Alerts: <StatusLabel status={alerts.status === 'not_requested' ? 'unknown' : alerts.status} text={alerts.status} /></span></div>
    {weather.status === 'live' && weather.data ? <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><Detail label="CURRENT" value={`${weather.data.tempF}°F / ${weather.data.condition}`} /><Detail label="HUMIDITY / WIND" value={`${weather.data.humidity}% / ${weather.data.windMph} mph ${weather.data.windDir}${weather.data.windGustMph === undefined ? '' : ` / gust ${weather.data.windGustMph} mph`}`} /><Detail label="PRESSURE / UV" value={`${weather.data.pressureInHg} inHg / ${weather.data.uvIndex}`} /><Detail label="LOCATION" value={weather.data.locationName} /></div> : <p className="text-[11px] text-slate-300">{weather.status === 'not_requested' ? 'Current weather and alerts are not loaded; readiness is using local retained evidence only.' : 'Live weather for the retained planned site is unavailable. Local readiness evidence is preserved.'}</p>}
    {weather.status === 'live' && <p className="text-[10px] text-slate-400">Hourly forecast: {weather.data?.hourlyForecast && weather.data.hourlyForecast.length > 0 ? weather.data.hourlyForecast.slice(0, 3).map(item => `${item.time} ${item.tempF}°F, ${item.precipProb}% rain`).join(' | ') : 'Unavailable'}</p>}
    {alerts.status === 'live' ? <div className="space-y-2">{alerts.active.length === 0 ? <p className="text-[11px] text-emerald-200">No active weather alerts are present in the available alert set.</p> : alerts.active.map(alert => <div key={alert.id} className="rounded border border-amber-700/60 bg-amber-950/20 p-2 text-[10px] space-y-1"><strong className="block text-amber-200">{alert.severity}: {alert.title}</strong><span className="block text-slate-300">{alert.description}</span><span className="block text-slate-400">{alert.area} / issued {alert.issued} / expires {alert.expires}</span></div>)}</div> : alerts.status === 'unavailable' ? <p className="text-[11px] text-slate-300">Live weather-alert evidence is unavailable. Local readiness evidence is preserved.</p> : null}
    <p className="text-[10px] text-slate-400">Weather alerts are advisory evidence and do not constitute a universal operational block.</p>
    {weather.status === 'live' && <p className="text-[10px] text-slate-400">FieldOps evaluation time: {formatUtc(evaluatedAtUtc)}</p>}
    <EvidenceMetadata label="Weather" source={weather.source} retrievedAtUtc={weather.retrievedAtUtc} limitation={weather.limitation} />
    <EvidenceMetadata label="Alerts" source={alerts.source} retrievedAtUtc={alerts.retrievedAtUtc} limitation={alerts.limitation} />
    <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={onLoad} disabled={loading} className="px-3 py-2 rounded border border-cyan-700 text-cyan-200 text-[10px] font-bold disabled:opacity-50">{loading ? 'LOADING PLANNED-SITE WEATHER...' : 'LOAD LIVE WEATHER FOR PLANNED SITE'}</button><span className="text-[10px] text-slate-500">Explicit request only; current-device location is never used as a fallback.</span></div>
  </EvidenceSection>;
};

const EvidenceSection: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => <section className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 space-y-2"><h4 className="font-black text-[10px] uppercase text-amber-300">{title}</h4>{children}</section>;
const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded border border-slate-800 bg-slate-900/70 p-2"><span className="block text-[9px] uppercase text-slate-500">{label}</span><span className="block mt-0.5 text-[11px] text-slate-200 break-words">{value}</span></div>;
const LinkedEvidence: React.FC<{ title: string; finding?: ReadinessFinding; href: string }> = ({ title, finding, href }) => <EvidenceSection title={title}><p className="text-[11px] text-slate-200">{finding?.message || 'Evidence is unavailable.'}</p><a href={href} className="inline-block min-h-11 px-3 py-3 rounded border border-cyan-700 text-cyan-200 text-[10px] font-bold">{title === 'FIELD READINESS CHECKLIST' ? 'OPEN FIELD READINESS CHECKLIST' : 'OPEN ACTIVATION NOTES'}</a></EvidenceSection>;
const FindingMetadata: React.FC<{ finding?: ReadinessFinding }> = ({ finding }) => finding ? <EvidenceMetadata label="Finding" source={finding.source} timestampLabel="Observed" retrievedAtUtc={finding.observedAtUtc} limitation={finding.limitation} /> : null;
const EvidenceMetadata: React.FC<{ label: string; source: { id: string; type: string; name?: string }; timestampLabel?: string; retrievedAtUtc?: string | null; limitation?: string }> = ({ label, source, timestampLabel = 'Retrieved', retrievedAtUtc, limitation }) => <div className="space-y-0.5 text-[10px] text-slate-400"><span className="block">{label} source: {formatSource(source)}</span><span className="block">{timestampLabel}: {retrievedAtUtc ? <time dateTime={retrievedAtUtc}>{formatUtc(retrievedAtUtc)}</time> : 'Not available'}</span>{limitation && <span className="block">Limitation: {limitation}</span>}</div>;
const FindingRow: React.FC<{ finding: ReadinessFinding }> = ({ finding }) => <div className="border-t border-slate-800 pt-2 text-[10px] text-slate-400"><p><strong className="text-slate-200">{finding.message}</strong></p><p>Status: {finding.status} | Priority: {finding.priority} | Source: {formatSource(finding.source)}</p>{finding.observedAtUtc && <p>Observed: <time dateTime={finding.observedAtUtc}>{formatUtc(finding.observedAtUtc)}</time></p>}{finding.limitation && <p>Limitation: {finding.limitation}</p>}</div>;
function summarizeFindingStatuses(findings: readonly ReadinessFinding[]): string { return (['blocked', 'unavailable', 'stale', 'attention', 'unknown'] as const).flatMap(status => { const count = findings.filter(finding => finding.status === status).length; return count > 0 ? [`${count} ${status}`] : []; }).join(' · '); }
const StatusLabel: React.FC<{ status: ReadinessStatus | string; text?: string }> = ({ status, text }) => <span className={`inline-block rounded border px-1.5 py-0.5 text-[9px] font-black uppercase ${statusClass(status)}`}>{text || status}</span>;
const readinessCard = (label: string, value: string, status?: string) => <div key={label} className="rounded border border-slate-800 bg-slate-900/70 p-2"><span className="block text-[9px] uppercase text-slate-500">{label}</span><strong className="block mt-0.5 text-[10px] text-slate-200">{status ? status.toUpperCase() : 'UNKNOWN'}</strong><span className="block mt-0.5 text-[10px] text-slate-400 break-words">{value}</span></div>;

function findFinding(summary: OperationsReadinessSummary, id: string): ReadinessFinding | undefined { return summary.findings.find(finding => finding.id === id); }
function findingMessage(summary: OperationsReadinessSummary, id: string): string { return findFinding(summary, id)?.message || 'Unknown'; }
function statusClass(status: string): string { return status === 'ready' || status === 'live' ? 'border-emerald-700 text-emerald-200' : status === 'attention' || status === 'stale' ? 'border-amber-700 text-amber-200' : status === 'blocked' || status === 'unavailable' ? 'border-red-700 text-red-200' : 'border-slate-600 text-slate-300'; }
function formatDuration(seconds: number): string { const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`; }
function runtimeText(seconds: number | null): string { return seconds === null ? 'Windows runtime estimate unavailable.' : `Windows estimates approximately ${formatDuration(seconds)} remaining.`; }
function formatUtc(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toISOString().replace('T', ' ').replace('.000Z', ' UTC'); }
function formatCoordinates(value: { lat: number; lon: number } | null | undefined): string { return value ? `${value.lat.toFixed(5)}, ${value.lon.toFixed(5)}` : 'Unavailable'; }
function formatReadinessError(error: unknown, live: boolean): string { if (error instanceof OperationsReadinessApiError && error.code === 'brief_not_found') return 'This SmartDeploy brief is no longer retained.'; if (error instanceof OperationsReadinessApiError && error.code === 'unsupported_brief_schema') return 'This retained brief uses an unsupported legacy schema for Operations Readiness.'; if (!live && error instanceof OperationsReadinessApiError && error.code === 'readiness_unavailable') return 'Local readiness evidence is temporarily unavailable. The retained SmartDeploy brief remains available.'; return live ? 'Live weather and alerts could not be loaded for the planned site. Local readiness evidence is preserved.' : 'Operations Readiness could not be loaded from the local server.'; }
function formatSource(source: { id: string; type: string; name?: string }): string { return source.name ? `${source.name} (${source.type})` : `${source.id} (${source.type})`; }
