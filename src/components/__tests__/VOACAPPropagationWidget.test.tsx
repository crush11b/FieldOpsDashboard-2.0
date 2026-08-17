import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONFIDENCE_DISPLAY_LABELS, normalizedProfileUpdate, VOACAPPropagationWidget } from '../VOACAPPropagationWidget';
import { INITIAL_CONFIG } from '../../data/defaultConfig';
import { observedRfSummaryLabel } from '../../propagation/guidanceClient';
import { DEFAULT_STATION_PROFILE } from '../../propagation/stationProfileCatalog';

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
        onPersistConfig={async config => config}
      />,
    );

    expect(markup).toContain('REGIONAL HF BAND GUIDANCE');
    expect(markup).toContain('Propagation destination');
    expect(markup).toContain('Transmit power');
    expect(markup).toContain('Antenna type');
    expect(markup).toContain('LOCATION REQUIRED');
    expect(markup).not.toContain('VOACAP');
    expect(markup).not.toContain('IONOSONDE');
  });

  it('maps confidence and observed zero-report states truthfully', () => {
    expect(CONFIDENCE_DISPLAY_LABELS).toEqual({ high: 'HIGH', medium: 'MEDIUM', low: 'LOW', modeled_only: 'MODELED', unavailable: 'UNAVAILABLE' });
    expect(observedRfSummaryLabel('live', 0)).toContain('LIVE - NO MATCHING');
    expect(observedRfSummaryLabel('cached', 0)).toContain('CACHED - NO MATCHING');
    expect(observedRfSummaryLabel('stale', 0)).toBe('STALE OBSERVED-RF EVIDENCE');
    expect(observedRfSummaryLabel('unavailable', 0)).toBe('OBSERVED RF UNAVAILABLE');
  });

  it('normalizes dependent antenna, deployment, and height changes', () => {
    const dipole = normalizedProfileUpdate(DEFAULT_STATION_PROFILE, { antenna: { type: 'dipole' } });
    expect(dipole.deployment.geometry).toBe('inverted_v');
    const vertical = normalizedProfileUpdate(dipole, { deployment: { geometry: 'vertical' } });
    expect(vertical.antenna.type).toBe('dipole');
    expect(vertical.deployment.geometry).toBe('inverted_v');
    const beam = normalizedProfileUpdate(DEFAULT_STATION_PROFILE, { antenna: { type: 'beam' } });
    expect(beam.deployment.geometry).toBe('directional');
    expect(beam.deployment.heightCategory).toBe('not_applicable');
  });

  it('shows a valid saved custom power option', () => {
    const config = { ...INITIAL_CONFIG, propagation: { ...INITIAL_CONFIG.propagation, stationProfile: { ...DEFAULT_STATION_PROFILE, transmitPowerWatts: 15 } } };
    const markup = renderToStaticMarkup(<VOACAPPropagationWidget config={config} operatingLocation={{ coordinates: null, gridSquare: null, provenance: 'unavailable', status: 'unavailable', source: { id: 'test', type: 'gps_acquisition' } }} theme="dark_tactical" audioEnabled={false} onPersistConfig={async value => value} />);
    expect(markup).toContain('15 W (saved)');
  });
});
