import { describe, expect, it } from 'vitest';
import { hasMeaningfulWeatherMovement, NOAA_ALERT_REFRESH_INTERVAL_MS, WEATHER_REFRESH_INTERVAL_MS } from '../weatherRefreshPolicy';

describe('weather refresh policy', () => {
  it('refreshes immediately without a previous usable location', () => {
    expect(hasMeaningfulWeatherMovement(null, { lat: 40, lon: -75 })).toBe(true);
  });

  it('ignores sub-kilometer GPS jitter and refreshes after meaningful movement', () => {
    const previous = { lat: 40, lon: -75 };
    expect(hasMeaningfulWeatherMovement(previous, { lat: 40.001, lon: -75 })).toBe(false);
    expect(hasMeaningfulWeatherMovement(previous, { lat: 40.01, lon: -75 })).toBe(true);
  });

  it('keeps the operational refresh cadences explicit', () => {
    expect(WEATHER_REFRESH_INTERVAL_MS).toBe(10 * 60 * 1000);
    expect(NOAA_ALERT_REFRESH_INTERVAL_MS).toBe(2 * 60 * 1000);
  });
});