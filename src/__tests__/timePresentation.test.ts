import { describe, expect, it } from 'vitest';

import { formatWeatherHour, resolveWeatherTimeZone } from '../timePresentation';

describe('weather time presentation', () => {
  it('keeps UTC explicit when selected', () => {
    const resolved = resolveWeatherTimeZone({ mode: 'utc' }, 'America/New_York');
    expect(resolved).toEqual({ timeZone: 'UTC', contextLabel: 'UTC' });
    expect(formatWeatherHour('2026-09-14T18:00:00.000Z', resolved.timeZone)).toMatchObject({
      clock: '6:00 PM',
      zone: 'UTC',
      dateTime: '2026-09-14T18:00:00.000Z',
    });
  });

  it('uses the device IANA timezone for current-location weather', () => {
    expect(resolveWeatherTimeZone({ mode: 'device' }, 'America/New_York')).toEqual({
      timeZone: 'America/New_York',
      contextLabel: 'DEVICE LOCAL',
    });
  });

  it('uses an explicit target timezone for remote-location presentation', () => {
    const resolved = resolveWeatherTimeZone({ mode: 'named', timeZone: 'America/Denver' }, 'America/New_York');
    expect(resolved).toEqual({ timeZone: 'America/Denver', contextLabel: 'America/Denver' });
    expect(formatWeatherHour('2026-09-14T18:00:00.000Z', resolved.timeZone)).toMatchObject({
      clock: '12:00 PM',
      zone: 'MDT',
    });
  });

  it('falls back visibly to UTC when a target timezone is invalid', () => {
    expect(resolveWeatherTimeZone({ mode: 'named', timeZone: 'Not/A_Zone' }, 'America/New_York')).toEqual({
      timeZone: 'UTC',
      contextLabel: 'UTC',
      fallbackReason: 'invalid_named_timezone',
    });
  });

  it('skips the nonexistent spring-forward hour deterministically', () => {
    const before = formatWeatherHour('2026-03-08T06:00:00.000Z', 'America/New_York');
    const after = formatWeatherHour('2026-03-08T07:00:00.000Z', 'America/New_York');
    expect(before).toMatchObject({ clock: '1:00 AM', zone: 'EST' });
    expect(after).toMatchObject({ clock: '3:00 AM', zone: 'EDT' });
  });

  it('disambiguates the repeated fall-back hour by zone', () => {
    const first = formatWeatherHour('2026-11-01T05:00:00.000Z', 'America/New_York');
    const second = formatWeatherHour('2026-11-01T06:00:00.000Z', 'America/New_York');
    expect(first).toMatchObject({ clock: '1:00 AM', zone: 'EDT' });
    expect(second).toMatchObject({ clock: '1:00 AM', zone: 'EST' });
  });

  it('rejects invalid timestamps at the presentation boundary', () => {
    expect(formatWeatherHour('not-a-time', 'UTC')).toBeNull();
  });
});
