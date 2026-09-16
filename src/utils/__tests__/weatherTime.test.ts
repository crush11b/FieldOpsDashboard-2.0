import { describe, expect, it } from 'vitest';
import { formatWeatherDateTime, formatWeatherHour, isSupportedTimeZone, weatherConditionLabel } from '../weatherTime';

describe('weather presentation time', () => {
  it('converts UTC into America/New_York standard time', () => {
    expect(formatWeatherHour('2026-01-15T18:00:00.000Z', 'America/New_York')).toBe('1:00 PM');
  });

  it('converts UTC into America/New_York daylight time', () => {
    expect(formatWeatherHour('2026-07-15T18:00:00.000Z', 'America/New_York')).toBe('2:00 PM');
  });

  it('honors the daylight-saving boundary deterministically', () => {
    expect(formatWeatherHour('2026-03-08T06:00:00.000Z', 'America/New_York')).toBe('1:00 AM');
    expect(formatWeatherHour('2026-03-08T07:00:00.000Z', 'America/New_York')).toBe('3:00 AM');
  });

  it('is independent of the test runner host timezone when an IANA zone is supplied', () => {
    expect(formatWeatherHour('2026-09-14T18:00:00.000Z', 'America/New_York')).toBe('2:00 PM');
    expect(formatWeatherHour('2026-09-14T18:00:00.000Z', 'UTC')).toBe('6:00 PM');
  });

  it('formats PLAN forecast timestamps in the selected operator timezone with DST disclosure', () => {
    expect(formatWeatherDateTime('2026-01-15T18:00:00.000Z', 'America/New_York')).toBe('Jan 15, 1:00 PM EST');
    expect(formatWeatherDateTime('2026-07-15T18:00:00.000Z', 'America/New_York')).toBe('Jul 15, 2:00 PM EDT');
  });

  it('does not relabel invalid timestamps or accept invalid zones', () => {
    expect(formatWeatherHour('not-a-time', 'America/New_York')).toBe('not-a-time');
    expect(formatWeatherHour('2026-09-14T18:00:00.000Z', 'not/a-zone')).toBe('2026-09-14T18:00:00.000Z');
    expect(isSupportedTimeZone('not/a-zone')).toBe(false);
  });
  it('maps WMO weather codes without inventing unknown conditions', () => {
    expect(weatherConditionLabel(0)).toBe('Clear');
    expect(weatherConditionLabel(2)).toBe('Partly cloudy');
    expect(weatherConditionLabel(3)).toBe('Overcast');
    expect(weatherConditionLabel(48)).toBe('Fog');
    expect(weatherConditionLabel(65)).toBe('Rain');
    expect(weatherConditionLabel(75)).toBe('Snow');
    expect(weatherConditionLabel(95)).toBe('Thunderstorms');
    expect(weatherConditionLabel(99)).toBe('Thunderstorms / hail');
    expect(weatherConditionLabel(999)).toBe('Unknown');
    expect(weatherConditionLabel(Number.NaN)).toBe('Unknown');
  });
});
