import dgram from 'node:dgram';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WSJTX_FRESHNESS_WINDOW_MS, WsjtxListener, deriveAmateurBand, parseWsjtxStatusPacket } from '../wsjtx';

const text = new TextEncoder();
const stringField = (value: string) => { const bytes = text.encode(value); const buffer = Buffer.alloc(4 + bytes.length); buffer.writeUInt32BE(bytes.length); Buffer.from(bytes).copy(buffer, 4); return buffer; };
const statusPacket = (frequencyHz = 14_074_000, mode = 'FT8', messageType = 1) => { const header = Buffer.alloc(9); header.writeUInt32BE(0xadbccbda); header.writeUInt32BE(2, 4); header.writeUInt8(messageType, 8); const id = stringField('WSJT-X'); const frequency = Buffer.alloc(8); frequency.writeBigInt64BE(BigInt(frequencyHz)); return Buffer.concat([header, id, frequency, stringField(mode)]); };
const clock = (value: string) => () => new Date(value);
const sockets: WsjtxListener[] = [];
afterEach(() => { sockets.splice(0).forEach(listener => listener.stop()); vi.restoreAllMocks(); });

describe('WSJT-X protocol and listener', () => {
  it('parses Status frequency and normalizes supported station context', () => {
    const result = parseWsjtxStatusPacket(statusPacket(), clock('2026-08-27T12:00:00.000Z'));
    expect(result?.state).toMatchObject({ band: '20m', frequencyMHz: 14.074, mode: 'FT8', source: 'wsjtx', freshness: 'fresh', status: 'available', observedAtUtc: '2026-08-27T12:00:00.000Z' });
  });

  it('supports FT4, preserves unknown modes, and leaves out-of-band bands unknown', () => {
    expect(parseWsjtxStatusPacket(statusPacket(14_080_000, 'FT4'))?.state.mode).toBe('FT4');
    expect(parseWsjtxStatusPacket(statusPacket(14_074_000, 'FUTUREMODE'))?.state.mode).toBe('FUTUREMODE');
    expect(parseWsjtxStatusPacket(statusPacket(60_000_000_000))?.state.band).toBeNull();
    expect(deriveAmateurBand(7.074)).toBe('40m');
  });

  it('ignores malformed and unknown message packets safely', () => {
    expect(parseWsjtxStatusPacket(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(parseWsjtxStatusPacket(statusPacket(14_074_000_000, 'FT8', 99))).toBeNull();
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