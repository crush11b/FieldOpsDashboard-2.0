import { getProductUserAgent } from '../src/productMetadata';

export interface IonosondeStation {
  readonly code: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly foF2: number | null;
  readonly muf3000: number;
  readonly distKm: number;
  readonly distMiles: number;
}

export type IonosondeApiResponse =
  | {
      readonly status: 'live';
      readonly regionalMuf3000: number;
      readonly regionalFoF2: number | null;
      readonly nearestStation: IonosondeStation;
      readonly stations: readonly IonosondeStation[];
      readonly sourceName: 'KC2G Ionosonde Network';
      readonly lastUpdated: string;
    }
  | {
      readonly status: 'unavailable';
      readonly regionalMuf3000: null;
      readonly regionalFoF2: null;
      readonly nearestStation: null;
      readonly stations: readonly [];
      readonly sourceName: 'KC2G Ionosonde Network';
      readonly lastUpdated: string;
    };

interface StationMeasurement {
  readonly code: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly foF2: number | null;
  readonly muf3000: number;
}

const KC2G_URL = 'https://prop.kc2g.com/stations/';

export async function getIonosondeApiResponse(
  userLat: number,
  userLon: number,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<IonosondeApiResponse> {
  const unavailable = (): IonosondeApiResponse => ({
    status: 'unavailable',
    regionalMuf3000: null,
    regionalFoF2: null,
    nearestStation: null,
    stations: [],
    sourceName: 'KC2G Ionosonde Network',
    lastUpdated: now.toISOString(),
  });

  try {
    const response = await fetcher(KC2G_URL, {
      headers: {
        'User-Agent': `${getProductUserAgent('KC2G')} (contact@fieldops.radio)`,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json',
      },
    });
    if (!response.ok) return unavailable();

    const stations = parseStations(await response.text());
    if (stations.length === 0) return unavailable();

    const stationsWithDistance = stations
      .map((station) => {
        const distKm = Math.round(calculateDistanceKm(userLat, userLon, station.lat, station.lon));
        return { ...station, distKm, distMiles: Math.round(distKm * 0.621371) };
      })
      .sort((left, right) => left.distKm - right.distKm);
    const regional = calculateRegionalValues(stationsWithDistance.slice(0, 3));
    if (regional === null) return unavailable();

    return {
      status: 'live',
      regionalMuf3000: regional.muf3000,
      regionalFoF2: regional.foF2,
      nearestStation: stationsWithDistance[0],
      stations: stationsWithDistance,
      sourceName: 'KC2G Ionosonde Network',
      lastUpdated: now.toISOString(),
    };
  } catch {
    return unavailable();
  }
}

function parseStations(text: string): StationMeasurement[] {
  const stations: StationMeasurement[] = [];
  const stationPattern = /data-station="([^"]+)"[^>]*data-name="([^"]+)"[^>]*data-lat="([^"]+)"[^>]*data-lon="([^"]+)"[^>]*data-fof2="([^"]+)"[^>]*data-mufd="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = stationPattern.exec(text)) !== null) {
    const station = stationFromValues(match[1], match[2], match[3], match[4], match[5], match[6]);
    if (station) stations.push(station);
  }
  if (stations.length > 0) return stations;

  const jsonMatch = text.match(/(?:const|var)\s+stations\s*=\s*(\[\{.*?\}\]);/s);
  if (!jsonMatch) return [];
  try {
    const parsed: unknown = JSON.parse(jsonMatch[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!isRecord(value)) return [];
      const station = stationFromValues(
        value.code ?? value.id,
        value.name ?? value.title,
        value.lat ?? value.latitude,
        value.lon ?? value.longitude,
        value.fof2 ?? value.foF2,
        value.mufd ?? value.muf3000 ?? value.muf,
      );
      return station ? [station] : [];
    });
  } catch {
    return [];
  }
}

function stationFromValues(
  codeValue: unknown,
  nameValue: unknown,
  latValue: unknown,
  lonValue: unknown,
  foF2Value: unknown,
  mufValue: unknown,
): StationMeasurement | null {
  const code = nonemptyString(codeValue);
  const name = nonemptyString(nameValue);
  const lat = finiteNumber(latValue);
  const lon = finiteNumber(lonValue);
  const muf3000 = finiteNumber(mufValue);
  const foF2 = finiteNumber(foF2Value);
  if (!code || !name || lat === null || lat < -90 || lat > 90
    || lon === null || lon < -180 || lon > 180 || muf3000 === null || muf3000 <= 0) {
    return null;
  }
  return { code, name, lat, lon, foF2: foF2 !== null && foF2 > 0 ? foF2 : null, muf3000 };
}

function calculateRegionalValues(stations: readonly IonosondeStation[]) {
  let weightSum = 0;
  let mufSum = 0;
  let foF2Sum = 0;
  let foF2WeightSum = 0;
  for (const station of stations) {
    const weight = 1 / Math.max(10, station.distKm);
    weightSum += weight;
    mufSum += station.muf3000 * weight;
    if (station.foF2 !== null) {
      foF2Sum += station.foF2 * weight;
      foF2WeightSum += weight;
    }
  }
  if (weightSum === 0) return null;
  return {
    muf3000: Math.round((mufSum / weightSum) * 10) / 10,
    foF2: foF2WeightSum > 0 ? Math.round((foF2Sum / foF2WeightSum) * 10) / 10 : null,
  };
}

function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusKm = 6371;
  const latitudeDelta = (lat2 - lat1) * Math.PI / 180;
  const longitudeDelta = (lon2 - lon1) * Math.PI / 180;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function finiteNumber(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonemptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
