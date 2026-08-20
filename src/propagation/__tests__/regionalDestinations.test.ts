import { describe, expect, it } from 'vitest';
import { isValidCoordinates } from '../domain';
import { resolveOperatingLocation } from '../../location/operatingLocation';
import {
  getPropagationRegion,
  getPropagationRegionOptions,
  isPropagationRegionId,
  PROPAGATION_REGION_CATALOG,
  PROPAGATION_REGION_IDS,
  resolveRegionalDestination,
  resolveRegionalPathSamples,
  summarizeRegionalPathGeometry,
  type SampledRegionDefinition,
} from '../regionalDestinations';

const currentLocation = resolveOperatingLocation(
  { lat: 0, lon: 0, gridSquare: '' },
  { status: 'ok', source: { id: 'gps:test', type: 'serial_nmea', name: 'Test GNSS' } },
);

describe('Slice 5C regional destination catalog and path sampling', () => {
  it('exposes the exact initial region IDs and operator labels', () => {
    expect(PROPAGATION_REGION_IDS).toEqual([
      'local_nvis', 'eastern_us', 'central_us', 'western_us', 'caribbean', 'central_america',
      'south_america', 'western_europe', 'eastern_europe', 'north_africa', 'southern_africa',
      'middle_east', 'east_asia', 'oceania',
    ]);
    expect(getPropagationRegionOptions()).toEqual([
      { id: 'local_nvis', label: 'Local / NVIS' }, { id: 'eastern_us', label: 'Eastern U.S.' },
      { id: 'central_us', label: 'Central U.S.' }, { id: 'western_us', label: 'Western U.S.' },
      { id: 'caribbean', label: 'Caribbean' }, { id: 'central_america', label: 'Central America' },
      { id: 'south_america', label: 'South America' }, { id: 'western_europe', label: 'Western Europe' },
      { id: 'eastern_europe', label: 'Eastern Europe' }, { id: 'north_africa', label: 'North Africa' },
      { id: 'southern_africa', label: 'Southern Africa' }, { id: 'middle_east', label: 'Middle East' },
      { id: 'east_asia', label: 'East Asia' }, { id: 'oceania', label: 'Oceania' },
    ]);
  });

  it('keeps Local / NVIS structurally distinct from sampled regions', () => {
    const local = getPropagationRegion('local_nvis');
    expect(local).toMatchObject({ id: 'local_nvis', kind: 'local_nvis', distanceEnvelopeKm: { min: 0, max: 500 } });
    expect(local).not.toHaveProperty('representativeSamplePoints');
    expect(getPropagationRegion('western_europe')).toMatchObject({ id: 'western_europe', kind: 'sampled_region' });
  });

  it('has unique valid sample IDs and multiple distributed points for every ordinary region', () => {
    const sampleIds = new Set<string>();
    for (const region of PROPAGATION_REGION_CATALOG) {
      if (region.kind === 'local_nvis') continue;
      expect(region.representativeSamplePoints.length).toBeGreaterThan(1);
      const regionalIds = new Set(region.representativeSamplePoints.map(sample => sample.id));
      expect(regionalIds.size).toBe(region.representativeSamplePoints.length);
      for (const sample of region.representativeSamplePoints) {
        expect(sample.id).toMatch(new RegExp(`^${region.id}_`));
        expect(sample.label.length).toBeGreaterThan(0);
        expect(isValidCoordinates(sample.coordinates)).toBe(true);
        expect(sampleIds.has(sample.id)).toBe(false);
        sampleIds.add(sample.id);
      }
    }
    expect(sampleIds.size).toBeGreaterThan(40);
  });

  it('represents meaningful geographic breadth in Western Europe, Western U.S., South America, and Oceania', () => {
    const sampleSpread = (id: string) => {
      const region = getPropagationRegion(id as any) as SampledRegionDefinition;
      const lats = region.representativeSamplePoints.map(sample => sample.coordinates.lat);
      const lons = region.representativeSamplePoints.map(sample => sample.coordinates.lon);
      return { lat: Math.max(...lats) - Math.min(...lats), lon: Math.max(...lons) - Math.min(...lons) };
    };
    expect(sampleSpread('western_europe').lon).toBeGreaterThan(8);
    expect(sampleSpread('western_us').lon).toBeGreaterThan(15);
    expect(sampleSpread('south_america').lat).toBeGreaterThan(25);
    expect(sampleSpread('oceania').lon).toBeGreaterThan(20);
  });

  it('fails unknown region lookup honestly and exposes a valid ID guard', () => {
    expect(isPropagationRegionId('western_europe')).toBe(true);
    expect(isPropagationRegionId('not-a-region')).toBe(false);
    expect(resolveRegionalDestination('not-a-region')).toBeNull();
    expect(resolveRegionalDestination('western_europe')?.label).toBe('Western Europe');
  });

  it('resolves current and zero-coordinate origins using shared path geometry', () => {
    const region = getPropagationRegion('western_europe') as SampledRegionDefinition;
    const resolution = resolveRegionalPathSamples(currentLocation, region);
    expect(resolution.status).toBe('resolved');
    expect(resolution.samples).toHaveLength(5);
    expect(resolution.samples.every(sample => sample.originCoordinates.lat === 0 && sample.originCoordinates.lon === 0)).toBe(true);
    expect(resolution.samples.every(sample => Number.isFinite(sample.distanceKm) && sample.distanceKm > 0)).toBe(true);
    expect(resolution.samples.every(sample => sample.initialBearingDegrees !== null
      && sample.initialBearingDegrees >= 0 && sample.initialBearingDegrees < 360)).toBe(true);
    expect(resolution.samples.every(sample => sample.compassDirection !== 'N/A')).toBe(true);
  });

  it('does not fabricate paths for unavailable origins or Local / NVIS', () => {
    const unavailable = resolveOperatingLocation(
      { lat: 37, lon: -77, gridSquare: '' },
      { status: 'unavailable', source: { id: 'gps:none', type: 'serial_nmea', name: 'Unavailable GNSS' } },
    );
    const region = getPropagationRegion('western_europe') as SampledRegionDefinition;
    expect(resolveRegionalPathSamples(unavailable, region)).toMatchObject({ status: 'unavailable', samples: [] });
    expect(resolveRegionalPathSamples(currentLocation, getPropagationRegion('local_nvis')!)).toMatchObject({ status: 'not_sampled', samples: [] });
  });

  it('summarizes geometry with sample count, min, max, and median only', () => {
    const summary = summarizeRegionalPathGeometry([
      { distanceKm: 100 } as any, { distanceKm: 300 } as any, { distanceKm: 200 } as any, { distanceKm: 500 } as any,
    ]);
    expect(summary).toEqual({ sampleCount: 4, minimumDistanceKm: 100, maximumDistanceKm: 500, medianDistanceKm: 250 });
    expect(summary).not.toHaveProperty('rating');
    expect(summary).not.toHaveProperty('reliability');
    expect(summarizeRegionalPathGeometry([])).toEqual({ sampleCount: 0, minimumDistanceKm: null, maximumDistanceKm: null, medianDistanceKm: null });
  });
});