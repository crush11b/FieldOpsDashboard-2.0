import express from 'express';
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createWsjtxRouter } from '../wsjtxApi';
import { WsjtxListener } from '../wsjtx';

const listeners: WsjtxListener[] = [];
const servers: http.Server[] = [];
const text = new TextEncoder();
const stringField = (value: string) => { const bytes = text.encode(value); const buffer = Buffer.alloc(4 + bytes.length); buffer.writeUInt32BE(bytes.length); Buffer.from(bytes).copy(buffer, 4); return buffer; };
const statusPacket = () => { const header = Buffer.alloc(12); header.writeUInt32BE(0xadbccbda); header.writeUInt32BE(3, 4); header.writeUInt32BE(1, 8); const frequency = Buffer.alloc(8); frequency.writeBigUInt64BE(7_074_000n); return Buffer.concat([header, stringField('WSJT-X'), frequency, stringField('FT4')]); };

afterEach(() => { listeners.splice(0).forEach(listener => listener.stop()); servers.splice(0).forEach(server => server.close()); });

describe('WSJT-X API timing', () => {
  it('reports current request and response timing without changing station state', async () => {
    const listener = new WsjtxListener({ now: () => new Date('2026-08-27T12:00:00.000Z') });
    listeners.push(listener);
    listener.handlePacket(statusPacket());
    const app = express();
    app.use(createWsjtxRouter(listener));
    const server = await new Promise<http.Server>(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    servers.push(server);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const current = await fetch(`http://127.0.0.1:${port}/api/wsjtx/current`);
    const currentBody = await current.json() as any;
    const diagnostics = await fetch(`http://127.0.0.1:${port}/api/wsjtx/diagnostics`);
    const diagnosticsBody = await diagnostics.json() as any;

    expect(currentBody).toMatchObject({ state: { band: '40m', frequencyMHz: 7.074, mode: 'FT4' }, timing: { requestId: 1, requestReceivedAtUtc: expect.any(String), responseProducedAtUtc: expect.any(String) } });
    expect(diagnosticsBody.timing).toMatchObject({ lastCurrentRequestId: 1, lastCurrentRequestReceivedAtUtc: currentBody.timing.requestReceivedAtUtc, lastCurrentResponseProducedAtUtc: currentBody.timing.responseProducedAtUtc });
    expect(diagnosticsBody.adifFile).toMatchObject({ enabled: false, state: 'unavailable', resolvedPath: null, filePresent: false, recordsRejected: 0 });
  });
});
