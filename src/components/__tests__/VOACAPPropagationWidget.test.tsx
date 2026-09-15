import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONFIDENCE_DISPLAY_LABELS, getBandRatingClasses, normalizedProfileUpdate, RATING_LABELS, VOACAPPropagationWidget } from '../VOACAPPropagationWidget';
import { PROPAGATION_GUIDANCE_BANDS, type PropagationRating } from '../../propagation/domain';
import { INITIAL_CONFIG } from '../../data/defaultConfig';
import { observedRfSummaryLabel } from '../../propagation/guidanceClient';
import { DEFAULT_STATION_PROFILE } from '../../propagation/stationProfileCatalog';

describe('Regional HF Band Guidance production UI', () => {
  const ratings: PropagationRating[] = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'UNAVAILABLE'];

  it.each(ratings)('%s receives centralized rating presentation', rating => {
    const classes = getBandRatingClasses(rating, 'dark_tactical', false);
    expect(classes).toContain(`fo-rating-${rating.toLowerCase()}`);
  });

  it('keeps unavailable neutral and distinct from poor', () => {
    expect(getBandRatingClasses('UNAVAILABLE', 'dark_tactical', false)).toContain('fo-rating-unavailable');
    expect(getBandRatingClasses('UNAVAILABLE', 'dark_tactical', false)).not.toContain('fo-rating-poor');
    expect(getBandRatingClasses('POOR', 'dark_tactical', false)).toContain('fo-rating-poor');
  });

  it('keeps selected excellent and poor cards independently visible', () => {
    expect(getBandRatingClasses('EXCELLENT', 'dark_tactical', true)).toContain('fo-rating-selected');
    expect(getBandRatingClasses('EXCELLENT', 'dark_tactical', true)).toContain('fo-rating-excellent');
    expect(getBandRatingClasses('POOR', 'dark_tactical', true)).toContain('fo-rating-selected');
    expect(getBandRatingClasses('POOR', 'dark_tactical', true)).toContain('fo-rating-poor');
  });

  it('uses semantic rating roles so each theme controls its own palette', () => {
    for (const rating of ratings) {
      expect(getBandRatingClasses(rating, 'night_vision', false)).toBe(getBandRatingClasses(rating, 'sunlight', false));
    }
    expect(getBandRatingClasses('POOR', 'night_vision', true)).toContain('fo-rating-selected');
  });

  it('does not embed palette-specific colors in rating components', () => {
    const classes = ratings.map(rating => getBandRatingClasses(rating, 'sunlight', false)).join(' ');
    expect(classes).not.toMatch(/emerald|amber|red|cyan|zinc|slate/);
  });

  it('keeps rating colors while a retained result is refreshing', () => {
    const retained = getBandRatingClasses('POOR', 'sunlight', false);
    const refreshing = getBandRatingClasses('POOR', 'sunlight', true);
    expect(refreshing).toContain(retained);
    expect(refreshing).toContain('fo-rating-selected');
  });

  it('keeps rating and confidence text labels available to every card', () => {
    expect(Object.values(RATING_LABELS)).toEqual(['Excellent', 'Good', 'Fair', 'Poor', 'Unavailable']);
    expect(Object.values(CONFIDENCE_DISPLAY_LABELS)).toEqual(['HIGH', 'MEDIUM', 'LOW', 'MODELED', 'UNAVAILABLE']);
  });

  it('keeps the canonical band order', () => {
    expect(PROPAGATION_GUIDANCE_BANDS).toEqual(['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m']);
  });

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
    expect(markup).not.toContain('Excellent');
    expect(markup).not.toContain('Confidence:');
  });

  it.each(['dark_tactical', 'sunlight', 'night_vision'] as const)('uses semantic propagation surfaces in %s', theme => {
    const markup = renderToStaticMarkup(
      <VOACAPPropagationWidget
        config={INITIAL_CONFIG}
        operatingLocation={{ coordinates: null, gridSquare: null, provenance: 'unavailable', status: 'unavailable', source: { id: 'test', type: 'gps_acquisition' } }}
        theme={theme}
        audioEnabled={false}
        onPersistConfig={async value => value}
      />,
    );
    expect(markup).toContain(`data-theme="${theme}"`);
    expect(markup).toContain('fo-surface');
    expect(markup).toContain('fo-input min-h-11');
  });

  it('presents Local/NVIS as an accessible deferred destination without changing supported choices', () => {
    const config = { ...INITIAL_CONFIG, propagation: { ...INITIAL_CONFIG.propagation, destinationRegion: 'local_nvis' as const } };
    const markup = renderToStaticMarkup(
      <VOACAPPropagationWidget
        config={config}
        operatingLocation={{ coordinates: null, gridSquare: null, provenance: 'unavailable', status: 'unavailable', source: { id: 'test-location', type: 'manual_location' } }}
        theme="dark_tactical"
        audioEnabled={false}
        onPersistConfig={async value => value}
      />,
    );

    expect(markup).toContain('Local / NVIS (evaluator deferred)');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-describedby="local-nvis-deferred"');
    expect(markup).toContain('Local / NVIS guidance is recognized but its evaluator is deferred');
    expect(markup).toContain('<option value="western_europe">Western Europe</option>');
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

  it('does not render fake rating cards while calculating', () => {
    const markup = renderToStaticMarkup(
      <VOACAPPropagationWidget config={INITIAL_CONFIG} operatingLocation={{ coordinates: { lat: 37.5, lon: -77.4 }, gridSquare: 'FM17', provenance: 'manual', status: 'degraded', source: { id: 'test-location', type: 'manual_location' } }} theme="dark_tactical" audioEnabled={false} onPersistConfig={async value => value} />,
    );
    expect(markup).not.toContain('bg-emerald');
    expect(markup).not.toContain('bg-red-950');
  });
});
