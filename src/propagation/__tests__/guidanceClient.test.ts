import { describe, expect, it, vi } from 'vitest';
import { fetchPropagationGuidance, PropagationGuidanceClientError } from '../guidanceClient';
import { PROPAGATION_GUIDANCE_BANDS } from '../domain';

const location = { coordinates: { lat: 37.54, lon: -77.43 }, gridSquare: 'FM17', provenance: 'manual' as const, status: 'degraded' as const, source: { id: 'test', type: 'manual_location' as const } };

function responsePayload() {
  return {
    kind: 'propagation_guidance', status: 'partial', destinationRegion: 'western_europe',
    assessments: PROPAGATION_GUIDANCE_BANDS.map(band => ({ band, rating: 'GOOD', confidence: 'medium', operatingMode: 'online_partial', reasons: [], cautions: [] })),
    modelBandSummaries: [], observedBandSummaries: [],
  };
}

describe('propagation guidance client', () => {
  it('posts one canonical request and accepts the ten-band response', async () => {
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body.destinationRegion).toBe('western_europe');
      expect(body.operatingLocation).toEqual(location);
      return new Response(JSON.stringify(responsePayload()), { status: 200 });
    });
    const result = await fetchPropagationGuidance('western_europe', location, undefined, fetcher);
    expect(result.assessments.map(item => item.band)).toEqual(PROPAGATION_GUIDANCE_BANDS);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed responses and never fabricates per-band requests', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ kind: 'propagation_guidance', assessments: [] }), { status: 200 }));
    await expect(fetchPropagationGuidance('western_europe', location, undefined, fetcher)).rejects.toBeInstanceOf(PropagationGuidanceClientError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
