import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateActivationStatus } from '../activation';
import { ActivationStore } from '../activationStore';
import { QsoStore } from '../qsoStore';
import { WsjtxQsoRouter } from '../wsjtxQsoRouter';
import { WSJTX_STALE_AFTER_MS, WSJTX_UNAVAILABLE_AFTER_MS, WsjtxListener, deriveAmateurBand, parseWsjtxLoggedQsoPacket, parseWsjtxStatusPacket } from '../wsjtx';

const text = new TextEncoder();
const stringField = (value: string | null) => { if (value === null) return Buffer.from([0xff, 0xff, 0xff, 0xff]); const bytes = text.encode(value); const buffer = Buffer.alloc(4 + bytes.length); buffer.writeUInt32BE(bytes.length); Buffer.from(bytes).copy(buffer, 4); return buffer; };
const statusPacket = (frequencyHz = 14_074_000, mode: string | null = 'FT8', messageType = 1, schema = 2, id: string | null = 'WSJT-X') => { const header = Buffer.alloc(12); header.writeUInt32BE(0xadbccbda); header.writeUInt32BE(schema, 4); header.writeUInt32BE(messageType, 8); const frequency = Buffer.alloc(8); frequency.writeBigUInt64BE(BigInt(frequencyHz)); return Buffer.concat([header, stringField(id), frequency, stringField(mode)]); };
const dateTimeField = (iso = '2026-08-27T17:43:19.000Z') => { const date = new Date(iso); const julianDay = BigInt(Math.floor(date.getTime() / 86_400_000) + 2_440_588); const milliseconds = date.getUTCHours() * 3_600_000 + date.getUTCMinutes() * 60_000 + date.getUTCSeconds() * 1_000 + date.getUTCMilliseconds(); const buffer = Buffer.alloc(13); buffer.writeBigInt64BE(julianDay); buffer.writeUInt32BE(milliseconds, 8); buffer.writeUInt8(1, 12); return buffer; };
const loggedQsoPacket = (frequencyHz = 14_074_000, mode = 'FT8', schema = 2, callsign = 'W1AW', reports: [string, string] = ['-10', '-12']) => { const header = Buffer.alloc(12); header.writeUInt32BE(0xadbccbda); header.writeUInt32BE(schema, 4); header.writeUInt32BE(5, 8); const fields = [stringField('WSJT-X'), dateTimeField(), stringField(callsign), stringField('FN31'), Buffer.alloc(8), stringField(mode), stringField(reports[0]), stringField(reports[1]), stringField('50W'), stringField(''), stringField('Alice'), dateTimeField('2026-08-27T17:42:00.000Z'), stringField('OP1'), stringField('MY1'), stringField('FN20'), stringField(null), stringField(null), stringField('FT8')]; fields[4].writeBigUInt64BE(BigInt(frequencyHz)); return Buffer.concat([header, ...fields]); };
const fixedLoggedQsoFixture = Uint8Array.from(Buffer.from('adbccbda00000002000000050000000657534a542d580000000000258e6003cd7ed801000000045731415700000004464e33310000000000d6c09000000003465438000000032d3130000000032d3132000000033530570000000000000005416c6963650000000000258e6003cc4a4001000000034f5031000000034d593100000004464e3230ffffffffffffffff00000003465438', 'hex'));
const clock = (value: string) => () => new Date(value);
const sockets: WsjtxListener[] = [];
const directories: string[] = [];
afterEach(() => { sockets.splice(0).forEach(listener => listener.stop()); directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })); vi.restoreAllMocks(); });

describe('WSJT-X protocol and listener', () => {
  it('parses Status frequency and normalizes supported station context', () => {
    const result = parseWsjtxStatusPacket(statusPacket(), clock('2026-08-27T12:00:00.000Z'));
    expect(result?.state).toMatchObject({ band: '20m', frequencyMHz: 14.074, mode: 'FT8', source: 'wsjtx', freshness: 'fresh', status: 'available', observedAtUtc: '2026-08-27T12:00:00.000Z' });
  });

  it('parses schema 3 with the real 12-byte header and unsigned dial frequency', () => {
    const result = parseWsjtxStatusPacket(statusPacket(7_074_000, 'FT8', 1, 3), clock('2026-08-27T12:00:00.000Z'));
    expect(result?.state).toMatchObject({ band: '40m', frequencyMHz: 7.074, mode: 'FT8' });
  });

  it('parses schema 2 and 3 Logged QSO candidates with normalized fields', () => {
    expect(parseWsjtxLoggedQsoPacket(loggedQsoPacket()) ).toMatchObject({ qsoDateTimeUtc: '2026-08-27T17:42:00.000Z', callsign: 'W1AW', band: '20m', frequencyMHz: 14.074, mode: 'FT8', rstSent: '-10', rstReceived: '-12', gridSquare: 'FN31', source: 'wsjtx' });
    expect(parseWsjtxLoggedQsoPacket(loggedQsoPacket(7_074_000, 'FT4', 3, 'k1abc', ['+05', '-07']))).toMatchObject({ callsign: 'K1ABC', band: '40m', frequencyMHz: 7.074, mode: 'FT4', rstSent: '+05', rstReceived: '-07' });
  });

  it('parses the independently fixed real-wire Logged QSO fixture', () => {
    expect(parseWsjtxLoggedQsoPacket(fixedLoggedQsoFixture)).toMatchObject({ qsoDateTimeUtc: '2026-08-27T17:42:00.000Z', callsign: 'W1AW', frequencyMHz: 14.074, mode: 'FT8', source: 'wsjtx' });
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
    expect(parseWsjtxLoggedQsoPacket(loggedQsoPacket(60_000_000_000))).toMatchObject({ band: null });
    expect(parseWsjtxLoggedQsoPacket(loggedQsoPacket(14_074_000, 'FUTUREMODE'))?.mode).toBe('FUTUREMODE');
    expect(parseWsjtxLoggedQsoPacket(loggedQsoPacket().subarray(0, -1))).toBeNull();
    expect(parseWsjtxLoggedQsoPacket(loggedQsoPacket(14_074_000, 'FT8', 4))).toBeNull();
    const wrongType = loggedQsoPacket(); wrongType.writeUInt32BE(1, 8); expect(parseWsjtxLoggedQsoPacket(wrongType)).toBeNull();
    const nullCall = loggedQsoPacket(); nullCall.writeUInt32BE(0xffffffff, 12 + 4 + 13); expect(parseWsjtxLoggedQsoPacket(nullCall)).toBeNull();
    const invalidLoggedUtf8 = loggedQsoPacket(); invalidLoggedUtf8[39] = 0xff; expect(parseWsjtxLoggedQsoPacket(invalidLoggedUtf8)).toBeNull();
  });

  it('reports a bounded parse failure for a recognized but malformed Logged QSO packet', () => {
    const listener = new WsjtxListener({ now: clock('2026-08-27T12:00:00.000Z') });
    listener.handlePacket(loggedQsoPacket().subarray(0, -1));
    expect(listener.getDiagnostics()).toMatchObject({ loggedQsoPacketsAccepted: 0, loggedQsoParseFailures: 1, lastLoggedQsoResult: 'parse_failed' });
  });

  it('reports unavailable, fresh, and stale snapshots', () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    const listener = new WsjtxListener({ port: 0, now: () => now });
    sockets.push(listener);
    expect(listener.getSnapshot()).toMatchObject({ status: 'unavailable', state: null });
    (listener as any).latest = parseWsjtxStatusPacket(statusPacket(), () => now);
    expect(listener.getSnapshot()).toMatchObject({ status: 'available', state: { freshness: 'fresh' } });
    expect(listener.getSnapshot(() => new Date(now.getTime() + WSJTX_STALE_AFTER_MS + 1))).toMatchObject({ status: 'stale', state: { freshness: 'stale', status: 'stale' } });
    expect(listener.getSnapshot(() => new Date(now.getTime() + WSJTX_UNAVAILABLE_AFTER_MS + 1))).toMatchObject({ status: 'unavailable', state: null });
  });

  it('does not create duplicate listeners when started repeatedly', async () => {
    const listener = new WsjtxListener({ port: 0 });
    sockets.push(listener);
    const createSpy = vi.spyOn(dgram, 'createSocket');
    listener.start(); listener.start();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps Status observations independent from interleaved Logged QSO events', async () => {
    const logged = vi.fn();
    const listener = new WsjtxListener({ now: clock('2026-08-27T12:00:00.000Z'), onLoggedQso: logged });
    listener.handlePacket(statusPacket(14_074_000, 'FT8'));
    listener.handlePacket(loggedQsoPacket());
    listener.handlePacket(statusPacket(7_074_000, 'FT8'));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(logged).toHaveBeenCalledOnce();
    expect(listener.getSnapshot()).toMatchObject({ status: 'available', state: { band: '40m', frequencyMHz: 7.074, mode: 'FT8' } });
    expect(listener.getDiagnostics()).toMatchObject({ packetsReceived: 3, statusPacketsAccepted: 2, loggedQsoPacketsAccepted: 1, lastLoggedQsoResult: 'received' });
  });

  it('completes the active digital path with one persisted real-wire QSO', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-wsjtx-integration-'));
    directories.push(directory);
    const activationStore = new ActivationStore(path.join(directory, 'activations.json'), { createId: () => 'activation-1' });
    const planned = activationStore.create({ type: 'General' }).activation;
    activationStore.save(updateActivationStatus(planned, 'active'));
    const qsoStore = new QsoStore(path.join(directory, 'qsos.json'), { createId: () => 'qso-1' });
    const router = new WsjtxQsoRouter({ activationStore, qsoStore });
    const listener = new WsjtxListener({ onLoggedQso: candidate => router.route(candidate).status });
    listener.handlePacket(statusPacket(14_074_000, 'FT8'));
    listener.handlePacket(loggedQsoPacket());
    listener.handlePacket(statusPacket(7_074_000, 'FT8'));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(listener.getSnapshot()).toMatchObject({ state: { band: '40m', frequencyMHz: 7.074, mode: 'FT8' } });
    expect(qsoStore.listByActivation('activation-1').qsos).toHaveLength(1);
    expect(qsoStore.listByActivation('activation-1').qsos[0]).toMatchObject({ callsign: 'W1AW', source: 'wsjtx', band: '20m', mode: 'FT8' });
    expect(listener.getDiagnostics()).toMatchObject({ lastLoggedQsoResult: 'persisted', lastLoggedQsoCallsign: 'W1AW', lastLoggedQsoBand: '20m', lastLoggedQsoMode: 'FT8', lastImportSuccessAtUtc: expect.any(String) });
  });
});