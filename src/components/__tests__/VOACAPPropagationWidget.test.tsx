import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VOACAPPropagationWidget } from '../VOACAPPropagationWidget';
import { DEFAULT_BAND_PROPAGATION } from '../../data/defaultConfig';

describe('Regional HF Band Guidance truth labels', () => {
  it('labels initial band results as modeled and does not claim live measurements', () => {
    const markup = renderToStaticMarkup(
      <VOACAPPropagationWidget
        solar={{
          solarFlux: 150,
          sunspotNumber: 100,
          aIndex: 8,
          kIndex: 2,
          kDescription: 'Quiet',
          xray: 'B1.0',
          geomagStatus: 'Quiet',
          lastUpdated: 'Unknown',
          source: 'Reference input',
        }}
        bands={DEFAULT_BAND_PROPAGATION}
        theme="dark_tactical"
        audioEnabled={false}
        location={{ lat: 37.5, lon: -77.4 }}
        onRefreshSolar={() => undefined}
      />,
    );

    expect(markup).toContain('REGIONAL HF BAND GUIDANCE');
    expect(markup).toContain('IONOSONDE UNAVAILABLE');
    expect(markup).toContain('MODELED GUIDANCE MUF');
    expect(markup).toContain('modeled guidance, not measured circuit predictions');
    expect(markup).not.toContain('VOACAP');
    expect(markup).not.toContain('REAL-TIME MUF');
  });
});
