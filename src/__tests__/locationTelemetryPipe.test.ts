import { describe, expect, it } from 'vitest';
import { parseLocationTelemetryFrame } from '../../server/locationTelemetryPipe';

const frame = (value: unknown) => { const body = Buffer.from(JSON.stringify(value)); const out = Buffer.alloc(4 + body.length); out.writeInt32LE(body.length); body.copy(out, 4); return out; };
const base = { latitude: 1, longitude: 2, altitude: null, horizontalAccuracy: null, speed: 0, heading: 0, timestampUtc: null, status: 'Available', satellites: 8, hdop: 0.8, fixQuality: 1, source: 'SerialNmea' };
describe('location telemetry pipe validation', () => {
  it('accepts valid framed observations', () => expect(parseLocationTelemetryFrame(frame(base)).status).toBe('Available'));
  it.each([{ status: 'NoFix' }, { status: 'Unavailable' }])('accepts $status without coordinates', value => expect(parseLocationTelemetryFrame(frame({ ...base, ...value, latitude: null, longitude: null })).status).toBe(value.status));
  it.each([{ latitude: 91 }, { longitude: 181 }, { speed: 'NaN' }, { timestampUtc: 'bad' }, { status: 'Bogus' }])('rejects malformed response', value => expect(parseLocationTelemetryFrame(frame({ ...base, ...value })).status).toBe('Error'));
  it('rejects invalid framing', () => { for (const n of [-1, 0, 300000]) { const b = Buffer.alloc(4); b.writeInt32LE(n); expect(parseLocationTelemetryFrame(b).status).toBe('Error'); } });
  it('does not expose raw NMEA', () => expect(JSON.stringify(parseLocationTelemetryFrame(frame(base)))).not.toContain('$GPGGA'));
});
