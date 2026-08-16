import { describe, expect, it } from 'vitest';
import { calculateSolarEvents, parseSolarDate } from '../solarEvents';

const eventMinutes = (date: Date | null) => date ? date.getUTCHours() * 60 + date.getUTCMinutes() : null;

describe('solar events', () => {
  it('calculates ordered mid-latitude events with reference timing', () => {
    const result = calculateSolarEvents({ lat: 40.7128, lon: -74.006 }, '2024-06-21');
    expect(result).not.toBeNull();
    const events = result!.events;
    expect(eventMinutes(events.astronomicalDawn)).toBeCloseTo(438, -1);
    expect(eventMinutes(events.sunrise)).toBeCloseTo(565, -1);
    expect(eventMinutes(events.sunset)).toBeCloseTo(30, -1);
    expect(events.astronomicalDawn!.getTime()).toBeLessThan(events.nauticalDawn!.getTime());
    expect(events.nauticalDawn!.getTime()).toBeLessThan(events.civilDawn!.getTime());
    expect(events.civilDawn!.getTime()).toBeLessThan(events.sunrise!.getTime());
    expect(events.sunset!.getTime()).toBeLessThan(events.civilDusk!.getTime());
    expect(events.civilDusk!.getTime()).toBeLessThan(events.nauticalDusk!.getTime());
    expect(events.nauticalDusk!.getTime()).toBeLessThan(events.astronomicalDusk!.getTime());
  });

  it('supports both hemispheres, zero coordinates, and date changes', () => {
    const northern = calculateSolarEvents({ lat: 40, lon: 0 }, '2024-06-21')!;
    const southern = calculateSolarEvents({ lat: -40, lon: 0 }, '2024-06-21')!;
    const equator = calculateSolarEvents({ lat: 0, lon: 0 }, '2024-03-20')!;
    const laterDate = calculateSolarEvents({ lat: 40, lon: 0 }, '2024-12-21')!;

    expect(northern.events.sunrise).not.toBeNull();
    expect(southern.events.sunrise).not.toBeNull();
    expect(equator.events.sunrise).not.toBeNull();
    expect(eventMinutes(equator.events.sunrise)).toBeCloseTo(360, -1);
    expect(northern.events.sunrise!.getTime()).not.toBe(laterDate.events.sunrise!.getTime());
  });

  it('returns honest no-event values during polar day and night', () => {
    const polarDay = calculateSolarEvents({ lat: 89, lon: 0 }, '2024-06-21')!;
    const polarNight = calculateSolarEvents({ lat: 89, lon: 0 }, '2024-12-21')!;

    expect(polarDay.events.sunrise).toBeNull();
    expect(polarDay.events.sunset).toBeNull();
    expect(polarNight.events.astronomicalDawn).toBeNull();
    expect(polarNight.events.astronomicalDusk).toBeNull();
  });

  it('rejects invalid calendar dates', () => {
    expect(parseSolarDate('2024-02-30')).toBeNull();
    expect(parseSolarDate('not-a-date')).toBeNull();
    expect(calculateSolarEvents({ lat: 0, lon: 0 }, '2024-02-30')).toBeNull();
  });
});