import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VOACAPPropagationWidget } from '../VOACAPPropagationWidget';
import { INITIAL_CONFIG } from '../../data/defaultConfig';

describe('Regional HF Band Guidance production UI', () => {
  it('renders canonical controls and does not render legacy heuristic claims', () => {
    const markup = renderToStaticMarkup(
      <VOACAPPropagationWidget
        config={INITIAL_CONFIG}
        operatingLocation={{
          coordinates: { lat: 37.5, lon: -77.4 },
          gridSquare: 'FM17',
          provenance: 'manual',
          status: 'degraded',
          source: { id: 'test-location', type: 'manual_location' },
        }}
        theme="dark_tactical"
        audioEnabled={false}
        onUpdateConfig={() => undefined}
      />,
    );

    expect(markup).toContain('REGIONAL HF BAND GUIDANCE');
    expect(markup).toContain('Propagation destination');
    expect(markup).toContain('Transmit power');
    expect(markup).toContain('Antenna type');
    expect(markup).toContain('160m');
    expect(markup).toContain('6m');
    expect(markup).not.toContain('VOACAP');
    expect(markup).not.toContain('IONOSONDE');
  });
});
