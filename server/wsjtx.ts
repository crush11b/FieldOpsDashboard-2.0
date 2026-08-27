import dgram from 'node:dgram';
import type { CurrentStationState } from '../src/currentStationState';
import { normalizeQsoCallsign } from './qso';

export const WSJTX_DEFAULT_HOST = '127.0.0.1';
export const WSJTX_DEFAULT_PORT = 2237;
export const WSJTX_FRESHNESS_WINDOW_MS = 10_000;
const WSJTX_MAGIC = 0xadbccbda;
const WSJTX_SUPPORTED_SCHEMAS = new Set([2, 3]);
const WSJTX_STATUS_MESSAGE = 1;
const WSJTX_QSO_LOGGED_MESSAGE = 5;

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

export interface WsjtxDiagnostics {
  readonly packetsReceived: number;
  readonly statusPacketsAccepted: number;
  readonly loggedQsoPacketsAccepted: number;
  readonly lastLoggedQsoAtUtc: string | null;
  readonly lastLoggedQsoResult: string | null;
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

export function parseWsjtxLoggedQsoPacket(packet: Uint8Array): WsjtxLoggedQsoCandidate | null {
  const reader = new PacketReader(packet);
  if (reader.readUint32() !== WSJTX_MAGIC) return null;
  const schema = reader.readUint32();
  if (schema === null || !WSJTX_SUPPORTED_SCHEMAS.has(schema) || reader.readUint32() !== WSJTX_QSO_LOGGED_MESSAGE) return null;
  if (reader.readString() === null) return null;
  const timeOff = reader.readDateTime();
  const callsign = reader.readString();
  const grid = reader.readString();
  const frequencyHz = reader.readUint64();
  const mode = reader.readString();
  const rstSent = reader.readString();
  const rstReceived = reader.readString();
  const txPower = reader.readString();
  const comments = reader.readString();
  const name = reader.readString();
  const timeOn = reader.readDateTime();
  const operatorCallsign = reader.readString();
  const stationCallsign = reader.readString();
  const myGridSquare = reader.readString();
  const exchangeSent = reader.readString();
  const exchangeReceived = reader.readString();
  const propagationMode = reader.readString();
  if (reader.isMalformed || !timeOff || !timeOn || callsign === null || frequencyHz === null || mode === null || !mode || frequencyHz <= 0) return null;
  const normalizedCallsign = normalizeQsoCallsign(callsign);
  if (!normalizedCallsign) return null;
  const frequencyMHz = frequencyHz / 1_000_000;
  return { qsoDateTimeUtc: timeOn, callsign: normalizedCallsign, band: deriveAmateurBand(frequencyMHz), frequencyMHz, mode: mode.toUpperCase(), ...(rstSent ? { rstSent } : {}), ...(rstReceived ? { rstReceived } : {}), ...(grid ? { gridSquare: grid } : {}), ...(operatorCallsign ? { operatorCallsign } : {}), ...(stationCallsign ? { stationCallsign } : {}), ...(myGridSquare ? { myGridSquare } : {}), source: 'wsjtx' };
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
  private packetsReceived = 0;
  private statusPacketsAccepted = 0;
  private loggedQsoPacketsAccepted = 0;
  private lastLoggedQsoAtUtc: string | null = null;
  private lastLoggedQsoResult: string | null = null;
  constructor(private readonly options: { readonly host?: string; readonly port?: number; readonly now?: () => Date; readonly onLoggedQso?: (candidate: WsjtxLoggedQsoCandidate) => string | void } = {}) {}

  start(): void {
    if (this.socket) return;
    const socket = dgram.createSocket('udp4');
    socket.on('message', packet => this.handlePacket(packet));
    socket.on('error', error => { this.lastError = error.message; socket.close(); this.socket = null; });
    socket.bind(this.options.port ?? WSJTX_DEFAULT_PORT, this.options.host ?? WSJTX_DEFAULT_HOST);
    this.socket = socket;
  }

  handlePacket(packet: Uint8Array): void {
    this.packetsReceived += 1;
    const observation = parseWsjtxStatusPacket(packet, this.options.now);
    if (observation) { this.latest = observation; this.statusPacketsAccepted += 1; this.lastError = null; }
    const loggedQso = parseWsjtxLoggedQsoPacket(packet);
    if (loggedQso) {
      this.loggedQsoPacketsAccepted += 1;
      this.lastLoggedQsoAtUtc = this.options.now?.().toISOString() ?? new Date().toISOString();
      try { const result = this.options.onLoggedQso?.(loggedQso); this.lastLoggedQsoResult = typeof result === 'string' ? result : 'received'; } catch { this.lastLoggedQsoResult = 'handler_error'; }
    }
  }

  getDiagnostics(): WsjtxDiagnostics { return { packetsReceived: this.packetsReceived, statusPacketsAccepted: this.statusPacketsAccepted, loggedQsoPacketsAccepted: this.loggedQsoPacketsAccepted, lastLoggedQsoAtUtc: this.lastLoggedQsoAtUtc, lastLoggedQsoResult: this.lastLoggedQsoResult }; }

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
  private malformed = false;
  get isMalformed(): boolean { return this.malformed; }
  constructor(private readonly packet: Uint8Array) {}
  readUint8(): number | null { if (this.offset + 1 > this.packet.length) return null; return this.packet[this.offset++]; }
  readUint32(): number | null { if (this.offset + 4 > this.packet.length) return null; const value = new DataView(this.packet.buffer, this.packet.byteOffset + this.offset, 4).getUint32(0); this.offset += 4; return value; }
  readUint64(): number | null { if (this.offset + 8 > this.packet.length) return null; const value = new DataView(this.packet.buffer, this.packet.byteOffset + this.offset, 8).getBigUint64(0); this.offset += 8; const number = Number(value); return Number.isSafeInteger(number) ? number : null; }
  readInt64(): number | null { if (this.offset + 8 > this.packet.length) return null; const value = new DataView(this.packet.buffer, this.packet.byteOffset + this.offset, 8).getBigInt64(0); this.offset += 8; const number = Number(value); return Number.isSafeInteger(number) ? number : null; }
  readInt32(): number | null { if (this.offset + 4 > this.packet.length) return null; const value = new DataView(this.packet.buffer, this.packet.byteOffset + this.offset, 4).getInt32(0); this.offset += 4; return value; }
  readString(): string | null { const length = this.readUint32(); if (length === null) { this.malformed = true; return null; } if (length === 0xffffffff) return null; if (length > this.packet.length - this.offset) { this.malformed = true; return null; } try { const value = new TextDecoder('utf-8', { fatal: true }).decode(this.packet.slice(this.offset, this.offset + length)); this.offset += length; return value; } catch { this.malformed = true; return null; } }
  readDateTime(): string | null { const julianDay = this.readInt64(); const milliseconds = this.readUint32(); const timeSpec = this.readUint8(); if (julianDay === null || milliseconds === null || timeSpec === null || timeSpec > 2 || milliseconds >= 86_400_000) { this.malformed = true; return null; } const offsetSeconds = timeSpec === 2 ? this.readInt32() : 0; if (offsetSeconds === null) { this.malformed = true; return null; } const value = new Date((julianDay - 2_440_588) * 86_400_000 + milliseconds - offsetSeconds * 1000); return Number.isNaN(value.getTime()) ? null : value.toISOString(); }
}

export interface WsjtxLoggedQsoCandidate {
  readonly qsoDateTimeUtc: string;
  readonly callsign: string;
  readonly band: string | null;
  readonly frequencyMHz: number;
  readonly mode: string;
  readonly rstSent?: string;
  readonly rstReceived?: string;
  readonly gridSquare?: string;
  readonly operatorCallsign?: string;
  readonly stationCallsign?: string;
  readonly myGridSquare?: string;
  readonly source: 'wsjtx';
}