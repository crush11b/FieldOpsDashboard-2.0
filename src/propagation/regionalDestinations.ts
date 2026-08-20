import { calculateDistanceKm, calculateInitialBearing, compassDirection } from '../location/geography';
import type { Coordinates } from '../location/coordinates';
import type { OperatingLocation } from '../location/operatingLocation';

export const PROPAGATION_REGION_IDS = [
  'local_nvis', 'eastern_us', 'central_us', 'western_us', 'caribbean', 'central_america',
  'south_america', 'western_europe', 'eastern_europe', 'north_africa', 'southern_africa',
  'middle_east', 'east_asia', 'oceania',
] as const;
export type PropagationRegionId = (typeof PROPAGATION_REGION_IDS)[number];

export interface RegionalSamplePoint {
  readonly id: string;
  readonly label: string;
  readonly coordinates: Coordinates;
}

export interface LocalNvisRegionDefinition {
  readonly id: 'local_nvis';
  readonly label: 'Local / NVIS';
  readonly kind: 'local_nvis';
  readonly description: string;
  readonly distanceEnvelopeKm: { readonly min: 0; readonly max: 500 };
}

export interface SampledRegionDefinition {
  readonly id: Exclude<PropagationRegionId, 'local_nvis'>;
  readonly label: string;
  readonly kind: 'sampled_region';
  readonly description: string;
  readonly representativeSamplePoints: readonly RegionalSamplePoint[];
}

export type PropagationRegionDefinition = LocalNvisRegionDefinition | SampledRegionDefinition;

export interface PropagationRegionOption {
  readonly id: PropagationRegionId;
  readonly label: string;
}

export interface RegionalPathSample {
  readonly sampleId: string;
  readonly sampleLabel: string;
  readonly originCoordinates: Coordinates;
  readonly destinationCoordinates: Coordinates;
  readonly distanceKm: number;
  readonly initialBearingDegrees: number | null;
  readonly compassDirection: string;
}

export interface RegionalPathResolution {
  readonly status: 'resolved' | 'unavailable' | 'not_sampled';
  readonly samples: readonly RegionalPathSample[];
  readonly reason?: string;
}

export interface RegionalGeometrySummary {
  readonly sampleCount: number;
  readonly minimumDistanceKm: number | null;
  readonly maximumDistanceKm: number | null;
  readonly medianDistanceKm: number | null;
}

export interface RegionalModelSample<T> {
  readonly sampleId: string;
  readonly path: RegionalPathSample;
  readonly result: T;
}

export interface RegionalModelSummary {
  readonly sampleCount: number;
  readonly viableSampleCount: number | null;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly median: number | null;
}

const point = (id: string, label: string, lat: number, lon: number): RegionalSamplePoint => ({
  id,
  label,
  coordinates: { lat, lon },
});

// Anchors are deliberately broad and recognizable so future models see path envelopes, not city claims.
export const PROPAGATION_REGION_CATALOG: readonly PropagationRegionDefinition[] = [
  {
    id: 'local_nvis', label: 'Local / NVIS', kind: 'local_nvis',
    description: 'Local and regional high-angle coverage guidance; evaluated separately from long paths.',
    distanceEnvelopeKm: { min: 0, max: 500 },
  },
  {
    id: 'eastern_us', label: 'Eastern U.S.', kind: 'sampled_region', description: 'Atlantic, southern, and interior eastern U.S. path anchors.',
    representativeSamplePoints: [
      point('eastern_us_boston', 'Boston', 42.3601, -71.0589), point('eastern_us_atlanta', 'Atlanta', 33.749, -84.388),
      point('eastern_us_chicago', 'Chicago', 41.8781, -87.6298), point('eastern_us_miami', 'Miami', 25.7617, -80.1918),
    ],
  },
  {
    id: 'central_us', label: 'Central U.S.', kind: 'sampled_region', description: 'Central plains, gulf, and mountain-edge path anchors.',
    representativeSamplePoints: [
      point('central_us_minneapolis', 'Minneapolis', 44.9778, -93.265), point('central_us_dallas', 'Dallas', 32.7767, -96.797),
      point('central_us_denver', 'Denver', 39.7392, -104.9903), point('central_us_new_orleans', 'New Orleans', 29.9511, -90.0715),
    ],
  },
  {
    id: 'western_us', label: 'Western U.S.', kind: 'sampled_region', description: 'Pacific, mountain, and southwest path anchors; Alaska is not included.',
    representativeSamplePoints: [
      point('western_us_seattle', 'Seattle', 47.6062, -122.3321), point('western_us_san_francisco', 'San Francisco', 37.7749, -122.4194),
      point('western_us_denver', 'Denver', 39.7392, -104.9903), point('western_us_phoenix', 'Phoenix', 33.4484, -112.074),
    ],
  },
  {
    id: 'caribbean', label: 'Caribbean', kind: 'sampled_region', description: 'Island and near-island path anchors across the Caribbean basin.',
    representativeSamplePoints: [
      point('caribbean_havana', 'Havana', 23.1136, -82.3666), point('caribbean_kingston', 'Kingston', 18.0179, -76.8099),
      point('caribbean_san_juan', 'San Juan', 18.4655, -66.1057), point('caribbean_port_of_spain', 'Port of Spain', 10.6596, -61.5086),
    ],
  },
  {
    id: 'central_america', label: 'Central America', kind: 'sampled_region', description: 'Isthmus path anchors from Guatemala through Panama.',
    representativeSamplePoints: [
      point('central_america_guatemala_city', 'Guatemala City', 14.6349, -90.5069), point('central_america_managua', 'Managua', 12.114, -86.2362),
      point('central_america_san_jose', 'San Jose', 9.9281, -84.0907), point('central_america_panama_city', 'Panama City', 8.9824, -79.5199),
    ],
  },
  {
    id: 'south_america', label: 'South America', kind: 'sampled_region', description: 'Northern, western, southern, and southeastern South American path anchors.',
    representativeSamplePoints: [
      point('south_america_bogota', 'Bogota', 4.711, -74.0721), point('south_america_lima', 'Lima', -12.0464, -77.0428),
      point('south_america_santiago', 'Santiago', -33.4489, -70.6693), point('south_america_buenos_aires', 'Buenos Aires', -34.6037, -58.3816),
      point('south_america_sao_paulo', 'Sao Paulo', -23.5505, -46.6333),
    ],
  },
  {
    id: 'western_europe', label: 'Western Europe', kind: 'sampled_region', description: 'British Isles, Iberia, France/Benelux, western Germany, and northern Italy anchors.',
    representativeSamplePoints: [
      point('western_europe_london', 'London', 51.5074, -0.1278), point('western_europe_madrid', 'Madrid', 40.4168, -3.7038),
      point('western_europe_paris', 'Paris', 48.8566, 2.3522), point('western_europe_frankfurt', 'Frankfurt', 50.1109, 8.6821),
      point('western_europe_milan', 'Milan', 45.4642, 9.19),
    ],
  },
  {
    id: 'eastern_europe', label: 'Eastern Europe', kind: 'sampled_region', description: 'Central, eastern, southeastern, and Black Sea path anchors.',
    representativeSamplePoints: [
      point('eastern_europe_prague', 'Prague', 50.0755, 14.4378), point('eastern_europe_warsaw', 'Warsaw', 52.2297, 21.0122),
      point('eastern_europe_bucharest', 'Bucharest', 44.4268, 26.1025), point('eastern_europe_kyiv', 'Kyiv', 50.4501, 30.5234),
      point('eastern_europe_athens', 'Athens', 37.9838, 23.7275),
    ],
  },
  {
    id: 'north_africa', label: 'North Africa', kind: 'sampled_region', description: 'Maghreb and Nile corridor path anchors.',
    representativeSamplePoints: [
      point('north_africa_casablanca', 'Casablanca', 33.5731, -7.5898), point('north_africa_algiers', 'Algiers', 36.7538, 3.0588),
      point('north_africa_tunis', 'Tunis', 36.8065, 10.1815), point('north_africa_cairo', 'Cairo', 30.0444, 31.2357),
    ],
  },
  {
    id: 'southern_africa', label: 'Southern Africa', kind: 'sampled_region', description: 'Southern Atlantic, interior, and southeast African path anchors.',
    representativeSamplePoints: [
      point('southern_africa_cape_town', 'Cape Town', -33.9249, 18.4241), point('southern_africa_windhoek', 'Windhoek', -22.5609, 17.0658),
      point('southern_africa_johannesburg', 'Johannesburg', -26.2041, 28.0473), point('southern_africa_maputo', 'Maputo', -25.9692, 32.5732),
    ],
  },
  {
    id: 'middle_east', label: 'Middle East', kind: 'sampled_region', description: 'Anatolian, Levantine, Gulf, and Iranian plateau path anchors.',
    representativeSamplePoints: [
      point('middle_east_istanbul', 'Istanbul', 41.0082, 28.9784), point('middle_east_tel_aviv', 'Tel Aviv', 32.0853, 34.7818),
      point('middle_east_riyadh', 'Riyadh', 24.7136, 46.6753), point('middle_east_dubai', 'Dubai', 25.2048, 55.2708),
      point('middle_east_tehran', 'Tehran', 35.6892, 51.389),
    ],
  },
  {
    id: 'east_asia', label: 'East Asia', kind: 'sampled_region', description: 'Northeast Asian, island, and southeast-edge path anchors.',
    representativeSamplePoints: [
      point('east_asia_tokyo', 'Tokyo', 35.6762, 139.6503), point('east_asia_seoul', 'Seoul', 37.5665, 126.978),
      point('east_asia_beijing', 'Beijing', 39.9042, 116.4074), point('east_asia_taipei', 'Taipei', 25.033, 121.5654),
      point('east_asia_hong_kong', 'Hong Kong', 22.3193, 114.1694),
    ],
  },
  {
    id: 'oceania', label: 'Oceania', kind: 'sampled_region', description: 'Australian, New Zealand, Melanesian, and Pacific island path anchors.',
    representativeSamplePoints: [
      point('oceania_perth', 'Perth', -31.9505, 115.8605), point('oceania_sydney', 'Sydney', -33.8688, 151.2093),
      point('oceania_port_moresby', 'Port Moresby', -9.4438, 147.1803), point('oceania_auckland', 'Auckland', -36.8509, 174.7645),
      point('oceania_suva', 'Suva', -18.1248, 178.4501),
    ],
  },
];

const REGION_BY_ID = new Map(PROPAGATION_REGION_CATALOG.map(region => [region.id, region]));

export function isPropagationRegionId(value: unknown): value is PropagationRegionId {
  return typeof value === 'string' && (PROPAGATION_REGION_IDS as readonly string[]).includes(value);
}

export function getPropagationRegionOptions(): readonly PropagationRegionOption[] {
  return PROPAGATION_REGION_CATALOG.map(region => ({ id: region.id, label: region.label }));
}

export function getPropagationRegion(id: PropagationRegionId): PropagationRegionDefinition | null {
  return REGION_BY_ID.get(id) ?? null;
}

export function resolveRegionalDestination(id: string): PropagationRegionDefinition | null {
  return isPropagationRegionId(id) ? getPropagationRegion(id) : null;
}

export function resolveRegionalPathSamples(
  operatingLocation: OperatingLocation,
  destination: SampledRegionDefinition | LocalNvisRegionDefinition,
): RegionalPathResolution {
  if (destination.kind === 'local_nvis') {
    return { status: 'not_sampled', samples: [], reason: 'Local / NVIS uses a distance envelope and is evaluated separately from regional path samples.' };
  }
  if (!operatingLocation.coordinates || operatingLocation.provenance === 'unavailable') {
    return { status: 'unavailable', samples: [], reason: 'Operating location coordinates are unavailable.' };
  }

  return {
    status: 'resolved',
    samples: destination.representativeSamplePoints.map(sample => {
      const distanceKm = calculateDistanceKm(operatingLocation.coordinates!, sample.coordinates);
      const initialBearingDegrees = calculateInitialBearing(operatingLocation.coordinates!, sample.coordinates);
      return {
        sampleId: sample.id,
        sampleLabel: sample.label,
        originCoordinates: operatingLocation.coordinates!,
        destinationCoordinates: sample.coordinates,
        distanceKm,
        initialBearingDegrees,
        compassDirection: compassDirection(initialBearingDegrees),
      };
    }),
  };
}

export function summarizeRegionalPathGeometry(samples: readonly RegionalPathSample[]): RegionalGeometrySummary {
  if (samples.length === 0) return { sampleCount: 0, minimumDistanceKm: null, maximumDistanceKm: null, medianDistanceKm: null };
  const distances = samples.map(sample => sample.distanceKm).sort((a, b) => a - b);
  const middle = Math.floor(distances.length / 2);
  const medianDistanceKm = distances.length % 2 === 0
    ? (distances[middle - 1] + distances[middle]) / 2
    : distances[middle];
  return {
    sampleCount: distances.length,
    minimumDistanceKm: distances[0],
    maximumDistanceKm: distances[distances.length - 1],
    medianDistanceKm,
  };
}