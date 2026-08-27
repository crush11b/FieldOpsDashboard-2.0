import dgram from 'node:dgram';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WSJTX_FRESHNESS_WINDOW_MS, WsjtxListener, deriveAmateurBand, parseWsjtxStatusPacket } from '../wsjtx';

const text = new TextEncoder();
const stringField = (value: string | null) => { if (value === null) return Buffer.from([0xff, 0xff, 0xff, 0xff]); const bytes = text.encode(value); const buffer = Buffer.alloc(4 + bytes.length); buffer.writeUInt32BE(bytes.length); Buffer.from(bytes).copy(buffer, 4); return buffer; };
const statusPacket = (frequencyHz = 14_074_000, mode: string | null = 'FT8', messageType = 1, schema = 2, id: string | null = 'WSJT-X') => { const header = Buffer.alloc(12); header.writeUInt32BE(0xadbccbda); header.writeUInt32BE(schema, 4); header.writeUInt32BE(messageType, 8); const frequency = Buffer.alloc(8); frequency.writeBigUInt64BE(BigInt(frequencyHz)); return Buffer.concat([header, stringField(id), frequency, stringField(mode)]); };
const clock = (value: string) => () => new Date(value);
const sockets: WsjtxListener[] = [];
afterEach(() => { sockets.splice(0).forEach(listener => listener.stop()); vi.restoreAllMocks(); });

describe('WSJT-X protocol and listener', () => {
  it('parses Status frequency and normalizes supported station context', () => {
    const result = parseWsjtxStatusPacket(statusPacket(), clock('2026-08-27T12:00:00.000Z'));
    expect(result?.state).toMatchObject({ band: '20m', frequencyMHz: 14.074, mode: 'FT8', source: 'wsjtx', freshness: 'fresh', status: 'available', observedAtUtc: '2026-08-27T12:00:00.000Z' });
  });

  it('parses schema 3 with the real 12-byte header and unsigned dial frequency', () => {
    const result = parseWsjtxStatusPacket(statusPacket(7_074_000, 'FT8', 1, 3), clock('2026-08-27T12:00:00.000Z'));
    expect(result?.state).toMatchObject({ band: '40m', frequencyMHz: 7.074, mode: 'FT8' });
  });

  it('supports FT4, preserves unknown modes, and leaves out-of-band bands unknown', () => {
    expect(parseWsjtxStatusPacket(statusPacket(14_080_000, 'FT4'))?.state.mode).toBe('FT4');
    expect(parseWsjtxStatusPacket(statusPacket(14_074_000, 'FUTUREMODE'))?.state.mode).toBe('FUTUREMODE');
    expect(parseWsjtxStatusPacket(statusPacket(60_000_000_000))?.state.band).toBeNull();
    expect(deriveAmateurBand(7.074)).toBe('40m');
  });

  it('ignores malformed and unknown message packets safely', () => {
    expect(parseWsjtxStatusPacket(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(parseWsjtxStatusPacket(statusPacket(14_074_000, 'FT8', 99))).toBeNull();
    expect(parseWsjtxStatusPacket(statusPacket(14_074_000, 'FT8', 1, 4))).toBeNull();
    expect(parseWsjtxStatusPacket(statusPacket(14_074_000, 'FT8', 1, 1))).toBeNull();
    expect(parseWsjtxStatusPacket(statusPacket(14_074_000, 'FT8', 1, 2, null))).toBeNull();
    expect(parseWsjtxStatusPacket(statusPacket(14_074_000, null))).toBeNull();
    expect(parseWsjtxStatusPacket(statusPacket().subarray(0, -1))).toBeNull();
    expect(parseWsjtxStatusPacket(statusPacket(Number.MAX_SAFE_INTEGER + 1))).toBeNull();
    const invalidUtf8 = statusPacket();
    invalidUtf8[invalidUtf8.length - 1] = 0xff;
    expect(parseWsjtxStatusPacket(invalidUtf8)).toBeNull();
  });

  it('reports unavailable, fresh, and stale snapshots', () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    const listener = new WsjtxListener({ port: 0, now: () => now });
    sockets.push(listener);
    expect(listener.getSnapshot()).toMatchObject({ status: 'unavailable', state: null });
    (listener as any).latest = parseWsjtxStatusPacket(statusPacket(), () => now);
    expect(listener.getSnapshot()).toMatchObject({ status: 'available', state: { freshness: 'fresh' } });
    expect(listener.getSnapshot(() => new Date(now.getTime() + WSJTX_FRESHNESS_WINDOW_MS + 1))).toMatchObject({ status: 'stale', state: { freshness: 'stale', status: 'stale' } });
  });

  it('does not create duplicate listeners when started repeatedly', async () => {
    const listener = new WsjtxListener({ port: 0 });
    sockets.push(listener);
    const createSpy = vi.spyOn(dgram, 'createSocket');
    listener.start(); listener.start();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});