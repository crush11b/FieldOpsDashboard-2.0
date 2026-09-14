import { describe, expect, it } from 'vitest';
import { formatWeatherHour, isSupportedTimeZone } from '../weatherTime';

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

  it('does not relabel invalid timestamps or accept invalid zones', () => {
    expect(formatWeatherHour('not-a-time', 'America/New_York')).toBe('not-a-time');
    expect(formatWeatherHour('2026-09-14T18:00:00.000Z', 'not/a-zone')).toBe('2026-09-14T18:00:00.000Z');
    expect(isSupportedTimeZone('not/a-zone')).toBe(false);
  });
});
