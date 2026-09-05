import type { StationSignalObservation, TxContext } from '../../server/operationalIntelligence';

export type PropagationLayerState = 'live' | 'retained' | 'stale' | 'partial' | 'not_applicable' | 'unavailable';
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
      id: 'station_signal', label: 'MY SIGNAL', state: station ? station.status : 'unavailable',
      source: station ? `Retained station-specific ${station.source === 'wspr' ? 'WSPR' : 'PSKReporter'} observation` : 'No retained station-specific observation',
      timing: station ? `${station.startsAtUtc} to ${station.endsAtUtc}` : 'Unavailable',
      applicability: station && stationContext ? `${stationContext.band} / ${stationContext.mode} / TX Context ${station.txContextSegmentId}` : station ? `TX Context ${station.txContextSegmentId}; segment details unavailable` : 'No applicable TX Context observation',
      summary: station ? station.matchingReportCount === 0 ? 'No matching reports observed.' : `${station.matchingReportCount} matching reports from ${station.uniqueReceiverCount} unique receivers.` : 'Station-specific evidence is unavailable.',
      limitations: station?.limitations ?? ['No station-specific conclusion can be drawn.'],
    },
  ];

  const relationships: string[] = [];
  if (openContext && modeledBands.length && !modeledBands.includes(openContext.band)) relationships.push(`Current TX band ${openContext.band} differs from the representative strongest modeled band${modeledBands.length === 1 ? '' : 's'} (${modeledBands.join(' / ')}); this is context, not proof of a poor path.`);
  if (station?.matchingReportCount === 0 && liveBand?.reportCount > 0) relationships.push(`General ${openContext?.band ?? ''} activity is present, but no matching reports from this station were observed; general activity is not station success.`);
  if (station && station.status !== generalState(generalStatus) && generalStatus !== 'unavailable') relationships.push('General and station-specific observations have different freshness states and must be interpreted independently.');
  return { kind: 'layered_propagation_picture', layers, relationships, limitation: 'These layers remain separate evidence. No universal best-band score, confidence score, contact probability, or guarantee is produced.' };
}

function generalState(status: string): PropagationLayerState { return status === 'live' ? 'live' : status === 'stale' ? 'stale' : status === 'cached' || status === 'observed' || status === 'retained' ? 'retained' : status === 'notTemporallyApplicable' ? 'not_applicable' : 'unavailable'; }
function newestObservation(values: readonly StationSignalObservation[]): StationSignalObservation | null { return [...values].sort((left, right) => right.endsAtUtc.localeCompare(left.endsAtUtc) || right.observationId.localeCompare(left.observationId))[0] ?? null; }
function newest(values: readonly (string | undefined)[]): string | null { return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null; }
function unique(values: readonly string[]): string[] { return [...new Set(values)]; }
