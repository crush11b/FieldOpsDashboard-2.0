import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WeatherNOAAWidget } from '../WeatherNOAAWidget';

describe('WeatherNOAAWidget truth states', () => {
  it('shows unavailable weather without plausible measurements', () => {
    const markup = renderToStaticMarkup(
      <WeatherNOAAWidget
        weather={null}
        weatherStatus="unavailable"
        alerts={[]}
        alertsStatus="live"
        theme="dark_tactical"
        audioEnabled={false}
      />,
    );

    expect(markup).toContain('Weather unavailable');
    expect(markup).not.toContain('78');
    expect(markup).toContain('NOAA ALERTS (0)');
  });

  it('does not describe an unavailable NOAA check as all clear', () => {
    const markup = renderToStaticMarkup(
      <WeatherNOAAWidget
        weather={null}
        weatherStatus="loading"
        alerts={null}
        alertsStatus="unavailable"
        theme="dark_tactical"
        audioEnabled={false}
      />,
    );

    expect(markup).toContain('NOAA UNAVAILABLE');
    expect(markup).not.toContain('ALL CLEAR');
  });

  it('fails closed when a live NOAA status has no alert payload', () => {
    const markup = renderToStaticMarkup(
      <WeatherNOAAWidget
        weather={null}
        weatherStatus="unavailable"
        alerts={null}
        alertsStatus="live"
        theme="dark_tactical"
        audioEnabled={false}
      />,
    );

    expect(markup).toContain('NOAA UNAVAILABLE');
    expect(markup).not.toContain('NOAA ALERTS (0)');
  });
});
