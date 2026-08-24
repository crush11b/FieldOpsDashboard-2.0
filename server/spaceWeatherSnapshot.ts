import type { SmartDeployBriefV2 } from './smartDeployBrief';
import type { SpaceWeatherEvidenceItem, SpaceWeatherService, SpaceWeatherSnapshot } from './spaceWeather';

export const RETAINED_SPACE_WEATHER_SCHEMA_VERSION = 1 as const;

export interface RetainedSpaceWeatherInterpretation {
  readonly solarSupport: 'supportive' | 'moderate' | 'limited' | 'unknown';
  readonly geomagneticActivity: 'quiet' | 'unsettled' | 'active' | 'unknown';
  readonly flareConcern: 'low' | 'moderate' | 'elevated' | 'unknown';
  readonly plainLanguageEffect: string;
}

export interface RetainedSpaceWeatherSnapshot {
  readonly schemaVersion: typeof RETAINED_SPACE_WEATHER_SCHEMA_VERSION;
  readonly briefId: string;
  readonly activation: { readonly program: string; readonly reference: string };
  readonly missionWindow: { readonly start: string; readonly midpoint: string; readonly end: string };
  readonly retrievedAtUtc: string;
  readonly observedAtUtc: string | null;
  readonly forecastAtUtc: string | null;
  readonly coverage: 'current_conditions_only' | 'mission_window_forecast' | 'unavailable';
  readonly source: { readonly id: 'noaa-swpc'; readonly type: 'noaa-swpc'; readonly name: 'NOAA SWPC' };
  readonly products: Readonly<Record<string, SpaceWeatherEvidenceItem>>;
  readonly interpretation: RetainedSpaceWeatherInterpretation;
  readonly limitations: readonly string[];
  readonly diagnostics: readonly string[];
  readonly updatedAtUtc: string;
}

export function retainSpaceWeatherSnapshot(brief: SmartDeployBriefV2, snapshot: SpaceWeatherSnapshot, now = new Date()): RetainedSpaceWeatherSnapshot {
  const products = snapshot.products;
  const observedAtUtc = newestObservation(products);
  return {
    schemaVersion: RETAINED_SPACE_WEATHER_SCHEMA_VERSION,
    briefId: brief.briefId,
    activation: { program: brief.activation.program, reference: brief.activation.reference },
    missionWindow: { ...brief.missionWindow },
    retrievedAtUtc: snapshot.fetchedAt,
    observedAtUtc,
    forecastAtUtc: null,
    coverage: snapshot.status === 'unavailable' ? 'unavailable' : 'current_conditions_only',
    source: { id: 'noaa-swpc', type: 'noaa-swpc', name: 'NOAA SWPC' },
    products,
    interpretation: interpretSpaceWeather(products),
    limitations: [
      'Current conditions are not historical activation conditions and do not guarantee a band, path, or contact.',
      'NOAA mission-window space-weather forecasting was not available in the retained evidence.',
      ...(snapshot.status === 'partial' ? ['Some NOAA products were unavailable or stale at retrieval.'] : []),
    ],
    diagnostics: [],
    updatedAtUtc: now.toISOString(),
  };
}

function newestObservation(products: Readonly<Record<string, SpaceWeatherEvidenceItem>>): string | null {
  return Object.values(products).map(item => item.observedAt).filter((value): value is string => typeof value === 'string').sort().at(-1) ?? null;
}

function numeric(products: Readonly<Record<string, SpaceWeatherEvidenceItem>>, product: string): number | null {
  const value = products[product]?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(products: Readonly<Record<string, SpaceWeatherEvidenceItem>>, product: string): string | null {
  const value = products[product]?.value;
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}

export function interpretSpaceWeather(products: Readonly<Record<string, SpaceWeatherEvidenceItem>>): RetainedSpaceWeatherInterpretation {
  const f107 = numeric(products, 'f107');
  const ssn = numeric(products, 'ssn');
  const kp = numeric(products, 'kp');
  const xray = text(products, 'xray');
  const solarSupport = f107 === null && ssn === null ? 'unknown' : f107 !== null && f107 >= 120 || ssn !== null && ssn >= 80 ? 'supportive' : f107 !== null && f107 >= 80 || ssn !== null && ssn >= 30 ? 'moderate' : 'limited';
  const geomagneticActivity = kp === null ? 'unknown' : kp < 3 ? 'quiet' : kp < 5 ? 'unsettled' : 'active';
  const flareConcern = xray === null ? 'unknown' : /^[MX]/.test(xray) ? 'elevated' : /^C/.test(xray) ? 'moderate' : 'low';
  const plainLanguageEffect = solarSupport === 'supportive' && geomagneticActivity === 'quiet'
    ? 'Solar support is favorable and geomagnetic disruption is currently limited; modeled paths may be more usable, but operating success is not assured.'
    : geomagneticActivity === 'active'
      ? 'Geomagnetic activity may disturb or reduce HF reliability; expect changing conditions and use the modeled outlook only as guidance.'
      : 'Space-weather evidence is mixed or incomplete; use the retained band outlook as guidance and be prepared to adjust.';
  return { solarSupport, geomagneticActivity, flareConcern, plainLanguageEffect };
}

export interface RetainedSpaceWeatherRefreshOptions { readonly service: SpaceWeatherService; readonly now?: () => Date; }
export async function refreshRetainedSpaceWeather(brief: SmartDeployBriefV2, options: RetainedSpaceWeatherRefreshOptions): Promise<RetainedSpaceWeatherSnapshot> {
  return retainSpaceWeatherSnapshot(brief, await options.service.getSnapshot(true), options.now?.() ?? new Date());
}