import type { Coordinates } from '../location/coordinates';
import { PROPAGATION_REGION_IDS, type PropagationRegionId } from './regionalDestinations';

export interface RegionMembershipZone {
  readonly id: string;
  readonly regionId: Exclude<PropagationRegionId, 'local_nvis'>;
  readonly description: string;
  /** Bounds are [min, max): lower-inclusive and upper-exclusive. */
  readonly bounds: { readonly minLat: number; readonly maxLat: number; readonly minLon: number; readonly maxLon: number };
}

export interface PropagationRegionMembership {
  readonly regionId: PropagationRegionId;
  readonly description: string;
  readonly zones: readonly RegionMembershipZone[];
}

const zone = (
  id: string,
  regionId: Exclude<PropagationRegionId, 'local_nvis'>,
  description: string,
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
): RegionMembershipZone => ({ id, regionId, description, bounds: { minLat, maxLat, minLon, maxLon } });

export const PROPAGATION_REGION_MEMBERSHIP: readonly PropagationRegionMembership[] = [
  { regionId: 'local_nvis', description: 'Reserved for local-area reports; no coordinate zone asserts an NVIS mechanism.', zones: [] },
  {
    regionId: 'eastern_us', description: 'Contiguous U.S. east of or on -90 degrees west; Alaska and Hawaii are excluded.',
    zones: [zone('eastern-us-contiguous', 'eastern_us', 'Contiguous U.S. east of -90 degrees west.', 24, 49, -90, -66)],
  },
  {
    regionId: 'central_us', description: 'Contiguous U.S. from -110 degrees west up to, but excluding, -90 degrees west.',
    zones: [zone('central-us-contiguous', 'central_us', 'Contiguous U.S. central longitude band.', 24, 49, -110, -90)],
  },
  {
    regionId: 'western_us', description: 'Contiguous U.S. from -125 degrees west up to, but excluding, -110 degrees west; Alaska and Hawaii are excluded.',
    zones: [zone('western-us-contiguous', 'western_us', 'Contiguous U.S. western longitude band.', 24, 49, -125, -110)],
  },
  {
    regionId: 'caribbean', description: 'Explicit island and island-chain rectangles; mainland Central America is separate.',
    zones: [
      zone('caribbean-cuba', 'caribbean', 'Cuba and its immediate island envelope.', 19, 24, -86, -74),
      zone('caribbean-jamaica', 'caribbean', 'Jamaica and its immediate island envelope.', 17, 19, -80, -75),
      zone('caribbean-puerto-rico', 'caribbean', 'Puerto Rico and its immediate island envelope.', 17, 20, -68, -65),
      zone('caribbean-lesser-antilles', 'caribbean', 'Lesser Antilles island-chain envelope.', 10, 18, -65, -59),
    ],
  },
  {
    regionId: 'central_america', description: 'Three non-overlapping isthmus zones from Guatemala through Panama.',
    zones: [
      zone('central-america-north', 'central_america', 'Guatemala and northern isthmus envelope.', 13, 18, -94, -88),
      zone('central-america-middle', 'central_america', 'Honduras through Nicaragua envelope.', 10, 13, -90, -82),
      zone('central-america-south', 'central_america', 'Costa Rica and Panama envelope.', 7, 10, -86, -77),
    ],
  },
  {
    regionId: 'south_america', description: 'South American mainland envelope, beginning south of the Central America boundary.',
    zones: [zone('south-america-mainland', 'south_america', 'South American mainland operational envelope.', -56, 7, -82, -34)],
  },
  {
    regionId: 'western_europe', description: 'British Isles, Iberia, France, Benelux, Germany, Italy, and adjacent western continental envelope west of 12 degrees east.',
    zones: [zone('western-europe-west', 'western_europe', 'Western Europe operational longitude envelope north of the Maghreb boundary.', 37, 60, -12, 12)],
  },
  {
    regionId: 'eastern_europe', description: 'Operational eastern and southeastern Europe east of 12 degrees east, with Romania retained in its own zone.',
    zones: [
      zone('eastern-europe-north', 'eastern_europe', 'Poland, Czechia, Slovakia, Ukraine, and northern/eastern Europe envelope.', 45, 60, 12, 45),
      zone('eastern-europe-southeast', 'eastern_europe', 'Balkans and Greece envelope west of the Romania boundary.', 35, 45, 12, 26),
      zone('eastern-europe-romania', 'eastern_europe', 'Romania and immediate eastern Balkan envelope.', 43, 45, 26, 30),
    ],
  },
  {
    regionId: 'north_africa', description: 'Maghreb and Egypt zones; the eastern boundary leaves the Levant to Middle East.',
    zones: [
      zone('north-africa-maghreb', 'north_africa', 'Morocco, Algeria, Tunisia, and Maghreb envelope.', 27, 37, -18, 12),
      zone('north-africa-egypt', 'north_africa', 'Egypt and lower Nile envelope west of the Levant boundary.', 22, 32, 24, 34),
    ],
  },
  {
    regionId: 'southern_africa', description: 'Southern African mainland envelope including South Africa, Namibia, and Mozambique.',
    zones: [zone('southern-africa-mainland', 'southern_africa', 'Southern African mainland operational envelope.', -36, -10, 10, 41)],
  },
  {
    regionId: 'middle_east', description: 'Western Turkey, Levant, Arabian Peninsula, Gulf, and Iranian plateau; North Africa and eastern Europe remain separate.',
    zones: [
      zone('middle-east-western-turkey', 'middle_east', 'Western Turkey envelope east of the eastern Europe boundary.', 35, 43, 26, 34),
      zone('middle-east-core', 'middle_east', 'Levant, Arabian Peninsula, Gulf, and Iranian plateau envelope.', 15, 40, 34, 65),
    ],
  },
  {
    regionId: 'east_asia', description: 'China, Japan, Korea, Taiwan, and nearby East Asian mainland/island envelope north of Oceania.',
    zones: [zone('east-asia-mainland-islands', 'east_asia', 'East Asian operational envelope.', 18, 55, 100, 146)],
  },
  {
    regionId: 'oceania', description: 'Australia, New Zealand, Papua New Guinea, Fiji, and selected southwest Pacific island envelopes.',
    zones: [
      zone('oceania-australia', 'oceania', 'Australia operational envelope.', -45, -10, 110, 155),
      zone('oceania-new-zealand', 'oceania', 'New Zealand operational envelope.', -48, -30, 165, 180),
      zone('oceania-papua-new-guinea', 'oceania', 'Papua New Guinea operational envelope.', -12, 0, 140, 156),
      zone('oceania-fiji', 'oceania', 'Fiji operational envelope.', -22, -15, 175, 180),
    ],
  },
];

const MEMBERSHIP_BY_REGION = new Map(PROPAGATION_REGION_MEMBERSHIP.map(definition => [definition.regionId, definition]));

export function getPropagationRegionMembership(regionId: PropagationRegionId): PropagationRegionMembership {
  return MEMBERSHIP_BY_REGION.get(regionId)!;
}

export function findPropagationRegionMembership(coordinates: Coordinates): PropagationRegionId | null {
  for (const definition of PROPAGATION_REGION_MEMBERSHIP) {
    if (definition.regionId === 'local_nvis') continue;
    if (definition.zones.some(current => contains(current, coordinates))) return definition.regionId;
  }
  return null;
}

export function validatePropagationRegionMembership(): readonly string[] {
  const zones = PROPAGATION_REGION_MEMBERSHIP.flatMap(definition => definition.zones);
  const overlaps: string[] = [];
  for (let index = 0; index < zones.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < zones.length; otherIndex += 1) {
      const left = zones[index];
      const right = zones[otherIndex];
      if (left.regionId !== right.regionId && rectanglesOverlap(left, right)) overlaps.push(`${left.id}|${right.id}`);
    }
  }
  return overlaps;
}

function contains(current: RegionMembershipZone, coordinates: Coordinates): boolean {
  const { minLat, maxLat, minLon, maxLon } = current.bounds;
  return coordinates.lat >= minLat && coordinates.lat < maxLat && coordinates.lon >= minLon && coordinates.lon < maxLon;
}

function rectanglesOverlap(left: RegionMembershipZone, right: RegionMembershipZone): boolean {
  return left.bounds.minLat < right.bounds.maxLat && right.bounds.minLat < left.bounds.maxLat
    && left.bounds.minLon < right.bounds.maxLon && right.bounds.minLon < left.bounds.maxLon;
}

export function isCanonicalRegionMembershipCatalog(): boolean {
  return PROPAGATION_REGION_MEMBERSHIP.length === PROPAGATION_REGION_IDS.length
    && PROPAGATION_REGION_IDS.every(regionId => MEMBERSHIP_BY_REGION.has(regionId))
    && validatePropagationRegionMembership().length === 0;
}
