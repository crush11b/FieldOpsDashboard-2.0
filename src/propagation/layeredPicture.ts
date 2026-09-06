import type { StationSignalObservation, TxContext } from '../../server/operationalIntelligence';
import type { QsoEvidence } from '../../server/qsoEvidence';

export type PropagationLayerState = 'live' | 'retained' | 'stale' | 'stale_evidence' | 'partial' | 'not_applicable' | 'unavailable' | 'missing_context' | 'awaiting_provider_latency' | 'query_pending' | 'no_matching_reports' | 'evidence_available' | 'provider_unavailable';
export type PropagationLayerId = 'modeled' | 'environmental' | 'general_observed_rf' | 'station_signal';

export interface PropagationLayer {
  readonly id: PropagationLayerId;
  readonly label: string;
  readonly state: PropagationLayerState;
  readonly source: string;
  readonly timing: string;
  readonly applicability: string;
  readonly summary: string;
  readonly limitations: readonly string[];
}

export interface LayeredPropagationPicture {
  readonly kind: 'layered_propagation_picture';
  readonly layers: readonly PropagationLayer[];
  readonly relationships: readonly string[];
  readonly limitation: string;
  readonly whatThisMeansNow: readonly string[];
}

export interface LayeredPropagationInputs {
  readonly modeled?: any;
  readonly modeledStatus?: string;
  readonly modeledAtUtc?: string;
  readonly missionWindow?: { readonly start: string; readonly end: string } | null;
  readonly destinationLabel?: string;
  readonly forecast?: any;
  readonly spaceWeather?: any;
  readonly generalObserved?: any;
  readonly liveBandActivity?: any;
  readonly txContexts?: readonly TxContext[];
  readonly stationObservations?: readonly StationSignalObservation[];
  readonly objective?: { readonly goal?: string; readonly requiredQsoCount?: number; readonly deadlineUtc?: string };
  readonly completedQsos?: number;
  readonly qsoEvidence?: QsoEvidence;
}

export function assembleLayeredPropagationPicture(input: LayeredPropagationInputs): LayeredPropagationPicture {
  const openContext = input.txContexts?.find(context => context.endedAtUtc === undefined) ?? null;
  const station = newestObservation(input.stationObservations ?? []);
  const stationContext = station ? input.txContexts?.find(context => context.segmentId === station.txContextSegmentId) ?? null : null;
  const liveBand = openContext && Array.isArray(input.liveBandActivity?.bands)
    ? input.liveBandActivity.bands.find((item: any) => item?.band === openContext.band)
    : null;
  const modeledBands = unique(input.modeled?.summary?.strongestBandBySample?.map((item: any) => item?.band).filter(Boolean) ?? []);
  const modelAvailable = Boolean(input.modeled) && input.modeledStatus !== 'unavailable';
  const forecastAvailable = Boolean(input.forecast);
  const spaceAvailable = Boolean(input.spaceWeather);
  const liveGeneral = input.liveBandActivity;
  const retainedGeneral = input.generalObserved;
  const generalStatus = liveGeneral?.status ?? retainedGeneral?.status ?? 'unavailable';
  const generalCount = liveGeneral
    ? liveGeneral.bands?.reduce((sum: number, item: any) => sum + (Number(item?.reportCount) || 0), 0) ?? 0
    : retainedGeneral?.reports?.length ?? 0;

  const layers: PropagationLayer[] = [
    {
      id: 'modeled', label: 'MODELED PROPAGATION', state: modelAvailable ? 'retained' : 'unavailable',
      source: modelAvailable ? 'Retained SmartDeploy / ITU-R P.533 representative paths' : 'No retained propagation model',
      timing: input.modeledAtUtc ?? 'Unavailable',
      applicability: input.missionWindow ? `${input.missionWindow.start} to ${input.missionWindow.end}${input.destinationLabel ? ` / ${input.destinationLabel}` : ''}` : 'Mission applicability unavailable',
      summary: modelAvailable ? `Representative strongest bands: ${modeledBands.join(' / ') || 'Unavailable'}.` : 'Modeled propagation evidence is unavailable.',
      limitations: ['Representative start/midpoint/end path samples are not continuous coverage or a guarantee.'],
    },
    {
      id: 'environmental', label: 'ENVIRONMENT', state: forecastAvailable && spaceAvailable ? 'retained' : forecastAvailable || spaceAvailable ? 'partial' : 'unavailable',
      source: [forecastAvailable ? input.forecast.provider?.name || 'Open-Meteo' : null, spaceAvailable ? input.spaceWeather.source?.name || 'NOAA SWPC' : null].filter(Boolean).join(' / ') || 'No retained environmental source',
      timing: newest([input.forecast?.retrievedAtUtc, input.spaceWeather?.retrievedAtUtc]) ?? 'Unavailable',
      applicability: input.missionWindow ? `Retained evidence associated with mission ${input.missionWindow.start} to ${input.missionWindow.end}` : 'Mission applicability unavailable',
      summary: forecastAvailable || spaceAvailable ? `${forecastAvailable ? 'Mission forecast retained' : 'Mission forecast unavailable'}; ${spaceAvailable ? input.spaceWeather.interpretation?.plainLanguageEffect || 'space weather retained' : 'space weather unavailable'}.` : 'Environmental evidence is unavailable.',
      limitations: [...(!forecastAvailable ? ['Mission forecast is unavailable.'] : []), ...(!spaceAvailable ? ['Space-weather evidence is unavailable.'] : []), 'Environmental conditions inform interpretation but do not prove path usability.'],
    },
    {
      id: 'general_observed_rf', label: 'GENERAL OBSERVED RF', state: generalState(generalStatus),
      source: liveGeneral?.source?.name ?? retainedGeneral?.provenance?.sourceName ?? 'PSKReporter reception reports',
      timing: liveGeneral ? `${liveGeneral.observationWindow?.startsAt ?? 'Unknown'} to ${liveGeneral.observationWindow?.endsAt ?? 'Unknown'}` : retainedGeneral ? `${retainedGeneral.observationWindow?.startsAt ?? 'Unknown'} to ${retainedGeneral.observationWindow?.endsAt ?? 'Unknown'}` : 'Unavailable',
      applicability: liveGeneral ? 'Current regional activity near the operating context' : retainedGeneral ? 'Retained planning-time regional activity' : 'Unavailable',
      summary: generalStatus === 'unavailable' ? 'General observed-RF evidence is unavailable.' : `${generalCount} recent digital reception report${generalCount === 1 ? '' : 's'} across supported bands.`,
      limitations: [liveGeneral?.limitation ?? retainedGeneral?.limitation ?? 'General observed RF is not evidence that this station was received.'],
    },
    {
      id: 'station_signal', label: 'MY SIGNAL', state: stationSignalState(openContext, station),
      source: station ? `Retained station-specific ${station.source === 'wspr' ? 'WSPR' : 'PSKReporter'} observation` : openContext ? 'PSKReporter provider latency window' : 'No applicable TX Context',
      timing: station ? `${station.startsAtUtc} to ${station.endsAtUtc}` : 'Unavailable',
      applicability: station && stationContext ? `${stationContext.band} / ${stationContext.mode} / TX Context ${station.txContextSegmentId}` : station ? `TX Context ${station.txContextSegmentId}; segment details unavailable` : 'No applicable TX Context observation',
      summary: station ? station.matchingReportCount === 0 ? 'No matching reports observed.' : `${station.matchingReportCount} matching reports from ${station.uniqueReceiverCount} unique receivers.` : openContext ? 'PSKReporter reports may take several minutes to arrive; the next bounded capture is scheduled by the decision window.' : 'No TX Context is open; station-specific capture is not possible.',
      limitations: station?.limitations ?? ['Outbound reception evidence does not prove a usable return path or contact success.'],
    },
  ];

  const relationships: string[] = [];
  if (openContext && modeledBands.length && !modeledBands.includes(openContext.band)) relationships.push(`Current TX band ${openContext.band} differs from the representative strongest modeled band${modeledBands.length === 1 ? '' : 's'} (${modeledBands.join(' / ')}); this is context, not proof of a poor path.`);
  if (station?.matchingReportCount === 0 && liveBand?.reportCount > 0) relationships.push(`General ${openContext?.band ?? ''} activity is present, but no matching reports from this station were observed; general activity is not station success.`);
  if (station && station.status !== generalState(generalStatus) && generalStatus !== 'unavailable') relationships.push('General and station-specific observations have different freshness states and must be interpreted independently.');
  if (input.qsoEvidence?.currentBand && input.qsoEvidence.currentBandQsoCount > 0) relationships.push(`Retained two-way Activation results provide direct evidence on ${input.qsoEvidence.currentBand}; this carries more operational weight than a modeled alternative for the current decision.`);
  if (input.qsoEvidence?.currentBand && input.qsoEvidence.currentBandMode && input.qsoEvidence.currentBandModeQsoCount > 0) relationships.push(`The current ${input.qsoEvidence.currentBand} / ${input.qsoEvidence.currentBandMode} context has ${input.qsoEvidence.currentBandModeQsoCount} retained two-way result${input.qsoEvidence.currentBandModeQsoCount === 1 ? '' : 's'}.`);
  return { kind: 'layered_propagation_picture', layers, relationships, limitation: 'These layers remain separate evidence. No universal best-band score, confidence score, contact probability, or guarantee is produced.', whatThisMeansNow: synthesizeWhatThisMeansNow({ layers, openContext, modeledBands, liveBand, objective: input.objective, completedQsos: input.qsoEvidence?.total ?? input.completedQsos ?? 0 }) };
}

export interface WhatThisMeansNowInput { readonly layers: readonly PropagationLayer[]; readonly openContext: TxContext | null; readonly modeledBands: readonly string[]; readonly liveBand: any; readonly objective?: LayeredPropagationInputs['objective']; readonly completedQsos: number; }

export function synthesizeWhatThisMeansNow(input: WhatThisMeansNowInput): readonly string[] {
  const station = input.layers.find(layer => layer.id === 'station_signal');
  const general = input.layers.find(layer => layer.id === 'general_observed_rf');
  const means: string[] = [];
  if (station && station.state !== 'unavailable' && station.summary !== 'No matching reports observed.') means.push(`MY SIGNAL has ${station.summary.toLowerCase()} for ${station.applicability}; this is bounded station-specific outbound evidence.`);
  if (station?.summary === 'No matching reports observed.') means.push('MY SIGNAL currently has zero matching reports in its bounded capture; this does not establish poor propagation or station failure.');
  if (!input.objective) means.push('No explicit operating objective is retained for this Activation.');
  if (input.modeledBands.length && input.openContext && !input.modeledBands.includes(input.openContext.band)) means.push(`The modeled alternative is ${input.modeledBands.join(' / ')}; the current TX Context is ${input.openContext.band}.`);
  if (general?.state === 'not_applicable' || general?.applicability === 'Unavailable') means.push('General observed RF is not applicable to this current station-specific question.');
  if (input.objective?.requiredQsoCount !== undefined) means.push(`Qualification progress is ${input.completedQsos}/${input.objective.requiredQsoCount} QSOs${input.objective.deadlineUtc ? `; the operator-entered deadline is ${input.objective.deadlineUtc}` : '; no explicit operating deadline is retained'}.`);
  if (input.objective?.goal === 'explore_bands') means.push('Objective is band exploration; each band comparison belongs to a recorded TX Context.');
  if (input.objective?.goal === 'chase_dx' && input.modeledBands.length) means.push(`For DX reach, the modeled alternatives are ${input.modeledBands.join(' / ')}; this does not prove a usable path.`);
  if (input.objective?.goal === 'maximize_contacts' && input.liveBand?.reportCount > 0) means.push(`General observed RF reports ${input.liveBand.reportCount} report${input.liveBand.reportCount === 1 ? '' : 's'} on ${input.openContext?.band ?? 'the current band'}; this is not station-specific success.`);
  if (input.layers.some(layer => layer.state === 'not_applicable' || layer.state === 'partial' || layer.state === 'stale')) means.push('Some evidence layers differ in freshness or applicability; modeled, general, and station-specific evidence remain separate.');
  return means;
}

function generalState(status: string): PropagationLayerState { return status === 'live' ? 'live' : status === 'stale' ? 'stale' : status === 'cached' || status === 'observed' || status === 'retained' ? 'retained' : status === 'notTemporallyApplicable' ? 'not_applicable' : 'unavailable'; }
function stationSignalState(context: TxContext | null, observation: StationSignalObservation | null): PropagationLayerState { if (!context) return 'unavailable'; if (!observation) return 'awaiting_provider_latency'; if (observation.status === 'stale') return 'stale_evidence'; return observation.matchingReportCount > 0 ? 'evidence_available' : 'no_matching_reports'; }
function newestObservation(values: readonly StationSignalObservation[]): StationSignalObservation | null { return [...values].sort((left, right) => right.endsAtUtc.localeCompare(left.endsAtUtc) || right.observationId.localeCompare(left.observationId))[0] ?? null; }
function newest(values: readonly (string | undefined)[]): string | null { return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null; }
function unique(values: readonly string[]): string[] { return [...new Set(values)]; }
