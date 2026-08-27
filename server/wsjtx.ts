import dgram from 'node:dgram';
import type { CurrentStationState } from '../src/currentStationState';

export const WSJTX_DEFAULT_HOST = '127.0.0.1';
export const WSJTX_DEFAULT_PORT = 2237;
export const WSJTX_FRESHNESS_WINDOW_MS = 10_000;
const WSJTX_MAGIC = 0xadbccbda;
const WSJTX_SUPPORTED_SCHEMAS = new Set([2, 3]);
const WSJTX_STATUS_MESSAGE = 1;

export interface WsjtxObservation {
  readonly state: CurrentStationState;
  readonly receivedAtUtc: string;
}

export interface WsjtxSnapshot {
  readonly status: 'available' | 'stale' | 'unavailable';
  readonly state: CurrentStationState | null;
  readonly receivedAtUtc: string | null;
  readonly limitation: string;
}

export function parseWsjtxStatusPacket(packet: Uint8Array, now = () => new Date()): WsjtxObservation | null {
  const reader = new PacketReader(packet);
  if (reader.readUint32() !== WSJTX_MAGIC) return null;
  const schema = reader.readUint32();
  if (schema === null || !WSJTX_SUPPORTED_SCHEMAS.has(schema) || reader.readUint32() !== WSJTX_STATUS_MESSAGE) return null;
  const id = reader.readString();
  if (id === null) return null;
  const dialFrequencyHz = reader.readUint64();
  const mode = reader.readString();
  if (dialFrequencyHz === null || mode === null || dialFrequencyHz <= 0) return null;
  const timestamp = now().toISOString();
  const frequencyMHz = dialFrequencyHz / 1_000_000;
  const band = deriveAmateurBand(frequencyMHz);
  return {
    receivedAtUtc: timestamp,
    state: {
      band,
      frequencyMHz,
      mode,
      source: 'wsjtx',
      observedAtUtc: timestamp,
      freshness: 'fresh',
      status: 'available',
      limitation: 'WSJT-X application status; not CAT, direct radio, or RF confirmation.',
    },
  };
}

export function deriveAmateurBand(frequencyMHz: number): string | null {
  const bands: readonly [string, number, number][] = [
    ['160m', 1.8, 2], ['80m', 3.5, 4], ['60m', 5.25, 5.45], ['40m', 7, 7.3],
    ['30m', 10.1, 10.15], ['20m', 14, 14.35], ['17m', 18.068, 18.168],
    ['15m', 21, 21.45], ['12m', 24.89, 24.99], ['10m', 28, 29.7],
    ['6m', 50, 54], ['2m', 144, 148], ['70cm', 420, 450], ['23cm', 1240, 1300],
  ];
  return bands.find(([, lower, upper]) => frequencyMHz >= lower && frequencyMHz <= upper)?.[0] ?? null;
}

export class WsjtxListener {
  private socket: dgram.Socket | null = null;
  private latest: WsjtxObservation | null = null;
  private lastError: string | null = null;
  constructor(private readonly options: { readonly host?: string; readonly port?: number; readonly now?: () => Date } = {}) {}

  start(): void {
    if (this.socket) return;
    const socket = dgram.createSocket('udp4');
    socket.on('message', packet => { const observation = parseWsjtxStatusPacket(packet, this.options.now); if (observation) { this.latest = observation; this.lastError = null; } });
    socket.on('error', error => { this.lastError = error.message; socket.close(); this.socket = null; });
    socket.bind(this.options.port ?? WSJTX_DEFAULT_PORT, this.options.host ?? WSJTX_DEFAULT_HOST);
    this.socket = socket;
  }

  stop(): void { this.socket?.close(); this.socket = null; }

  getSnapshot(now = this.options.now ?? (() => new Date())): WsjtxSnapshot {
    if (!this.latest) return { status: this.lastError ? 'unavailable' : 'unavailable', state: null, receivedAtUtc: null, limitation: this.lastError || 'No WSJT-X Status message has been received.' };
    const age = now().getTime() - new Date(this.latest.receivedAtUtc).getTime();
    if (age > WSJTX_FRESHNESS_WINDOW_MS) return { status: 'stale', state: { ...this.latest.state, freshness: 'stale', status: 'stale' }, receivedAtUtc: this.latest.receivedAtUtc, limitation: 'The last WSJT-X Status message is older than the freshness window.' };
    return { status: 'available', state: this.latest.state, receivedAtUtc: this.latest.receivedAtUtc, limitation: this.latest.state.limitation };
  }
}

class PacketReader {
  private offset = 0;
  constructor(private readonly packet: Uint8Array) {}
  readUint8(): number | null { if (this.offset + 1 > this.packet.length) return null; return this.packet[this.offset++]; }
  readUint32(): number | null { if (this.offset + 4 > this.packet.length) return null; const value = new DataView(this.packet.buffer, this.packet.byteOffset + this.offset, 4).getUint32(0); this.offset += 4; return value; }
  readUint64(): number | null { if (this.offset + 8 > this.packet.length) return null; const value = new DataView(this.packet.buffer, this.packet.byteOffset + this.offset, 8).getBigUint64(0); this.offset += 8; const number = Number(value); return Number.isSafeInteger(number) ? number : null; }
  readString(): string | null { const length = this.readUint32(); if (length === null) return null; if (length === 0xffffffff) return null; if (length > this.packet.length - this.offset) return null; try { const value = new TextDecoder('utf-8', { fatal: true }).decode(this.packet.slice(this.offset, this.offset + length)); this.offset += length; return value; } catch { return null; } }
}