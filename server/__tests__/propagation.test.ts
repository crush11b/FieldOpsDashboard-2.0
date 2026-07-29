import { describe, expect, it } from 'vitest';
import { getIonosondeApiResponse } from '../propagation';

const NOW = new Date('2026-07-28T20:00:00.000Z');

describe('ionosonde propagation semantics', () => {
  it('returns unavailable without synthetic station measurements when the source fails', async () => {
    const result = await getIonosondeApiResponse(37.5, -77.4, async () => new Response(null, { status: 503 }), NOW);

    expect(result).toEqual({
      status: 'unavailable',
      regionalMuf3000: null,
      regionalFoF2: null,
      nearestStation: null,
      stations: [],
      sourceName: 'KC2G Ionosonde Network',
      lastUpdated: NOW.toISOString(),
    });
  });

  it('returns unavailable when the source response has no validated stations', async () => {
    const result = await getIonosondeApiResponse(37.5, -77.4, async () => new Response('<html>no station data</html>'), NOW);

    expect(result.status).toBe('unavailable');
    expect(result.stations).toEqual([]);
    expect(result.regionalMuf3000).toBeNull();
  });

  it('returns measured stations and derived regional values from a valid source response', async () => {
    const body = [
      station('A', 'Alpha', 38, -77, 5, 15),
      station('B', 'Bravo', 40, -75, 6, 18),
    ].join('');
    const result = await getIonosondeApiResponse(38, -77, async () => new Response(body), NOW);

    expect(result.status).toBe('live');
    expect(result.stations.map(({ code }) => code)).toEqual(['A', 'B']);
    expect(result.nearestStation?.name).toBe('Alpha');
    expect(result.regionalMuf3000).toBeGreaterThan(0);
    expect(result.regionalFoF2).toBeGreaterThan(0);
  });

  it('does not derive a measured foF2 value when stations omit it', async () => {
    const result = await getIonosondeApiResponse(
      38,
      -77,
      async () => new Response(station('A', 'Alpha', 38, -77, 'N/A', 15)),
      NOW,
    );

    expect(result.status).toBe('live');
    expect(result.regionalFoF2).toBeNull();
  });
});

function station(code: string, name: string, lat: number, lon: number, foF2: number | string, muf: number) {
  return `<div data-station="${code}" data-name="${name}" data-lat="${lat}" data-lon="${lon}" data-fof2="${foF2}" data-mufd="${muf}"></div>`;
}
