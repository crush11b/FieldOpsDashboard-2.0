import { describe, expect, it } from 'vitest';
import { enqueuePipeAccess, normalizeClockPayload, normalizeGnssPayload, parseLocationTelemetryFrame } from '../../server/locationTelemetryPipe';

const frame = (value: unknown) => { const body = Buffer.from(JSON.stringify(value)); const out = Buffer.alloc(4 + body.length); out.writeInt32LE(body.length); body.copy(out, 4); return out; };
const base = { latitude: 1, longitude: 2, altitude: null, horizontalAccuracy: null, speed: 0, heading: 0, timestampUtc: null, status: 'Available', satellites: 8, hdop: 0.8, fixQuality: 1, source: 'SerialNmea' };
describe('location telemetry pipe validation', () => {
  it('accepts valid framed observations', () => expect(parseLocationTelemetryFrame(frame(base)).status).toBe('Available'));
  it.each([{ status: 'NoFix' }, { status: 'Unavailable' }])('accepts $status without coordinates', value => expect(parseLocationTelemetryFrame(frame({ ...base, ...value, latitude: null, longitude: null })).status).toBe(value.status));
  it.each([{ latitude: 91 }, { longitude: 181 }, { speed: 'NaN' }, { timestampUtc: 'bad' }, { status: 'Bogus' }, { status: 99 }])('rejects malformed response', value => expect(parseLocationTelemetryFrame(frame({ ...base, ...value })).status).toBe('Error'));
  it('rejects invalid framing', () => { for (const n of [-1, 0, 300000]) { const b = Buffer.alloc(4); b.writeInt32LE(n); expect(parseLocationTelemetryFrame(b).status).toBe('Error'); } });
  it('does not expose raw NMEA', () => expect(JSON.stringify(parseLocationTelemetryFrame(frame(base)))).not.toContain('$GPGGA'));
  it('normalizes the native Agent location contract', () => expect(parseLocationTelemetryFrame(frame({ Latitude: 1, Longitude: 2, Altitude: null, HorizontalAccuracy: null, Speed: 0, Heading: 0, TimestampUtc: null, Status: 0, Satellites: 8, Hdop: 0.8, FixQuality: 1, Source: 'SerialNmea' }))).toMatchObject({ status: 'Available', latitude: 1, longitude: 2 }));
  it('normalizes native GNSS and clock enum evidence', () => {
    expect(normalizeGnssPayload({ Status: 0, TimestampUtc: '2026-08-25T22:00:00Z', SentenceType: 'RMC', Error: null })).toMatchObject({ status: 'Available', timestampUtc: '2026-08-25T22:00:00Z' });
    expect(normalizeClockPayload({ Status: 0, Error: 0, GnssTime: { Status: 0, TimestampUtc: '2026-08-25T22:00:00Z', SentenceType: 'RMC', Error: null }, LastSuccessfulSynchronizationUtc: '2026-08-25T22:00:00Z', OffsetBeforeSynchronizationSeconds: 0.45, AttemptMessage: 'synchronized' })).toMatchObject({ status: 'Synchronized', error: 'None', gnssTime: { status: 'Available' }, offsetBeforeSynchronizationSeconds: 0.45 });
  });
  it('serializes access because the Agent exposes one pipe instance', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const first = enqueuePipeAccess(() => new Promise<string>(resolve => { events.push('first-start'); releaseFirst = () => { events.push('first-end'); resolve('first'); }; }));
    const second = enqueuePipeAccess(async () => { events.push('second'); return 'second'; });
    await Promise.resolve();
    expect(events).toEqual(['first-start']);
    releaseFirst();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(events).toEqual(['first-start', 'first-end', 'second']);
  });
});
