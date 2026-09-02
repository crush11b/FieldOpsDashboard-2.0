import dgram from 'node:dgram';
import os from 'node:os';
import type { CurrentStationState } from '../src/currentStationState';
import { normalizeQsoCallsign } from './qso';

export const WSJTX_DEFAULT_HOST = '127.0.0.1';
export const WSJTX_DEFAULT_PORT = 2237;
export const WSJTX_STALE_AFTER_MS = 10_000;
export const WSJTX_UNAVAILABLE_AFTER_MS = 30_000;
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

export interface WsjtxTimingEvidence {
  readonly lastStatusPacketReceivedAtUtc: string | null;
  readonly lastStatusParsedAtUtc: string | null;
  readonly lastStatusStateUpdatedAtUtc: string | null;
  readonly lastCurrentRequestId: number | null;
  readonly lastCurrentRequestReceivedAtUtc: string | null;
  readonly lastCurrentResponseProducedAtUtc: string | null;
}

export interface WsjtxDiagnostics {
  readonly listenerMode: 'unicast' | 'multicast';
  readonly listenerState: 'stopped' | 'starting' | 'active' | 'failed' | 'recovering';
  readonly multicastAddress: string | null;
  readonly multicastInterface: string | null;
  readonly multicastInterfaces: readonly string[];
  readonly multicastJoined: boolean;
  readonly lastSocketError: string | null;
  readonly packetsReceived: number;
  readonly lastPacketReceivedAtUtc: string | null;
  readonly statusPacketsAccepted: number;
  readonly lastStatusParsedAtUtc: string | null;
  readonly lastStatusStateUpdatedAtUtc: string | null;
  readonly loggedQsoPacketsAccepted: number;
  readonly loggedQsoParseFailures: number;
  readonly lastLoggedQsoAtUtc: string | null;
  readonly lastLoggedQsoResult: string | null;
  readonly lastLoggedQsoCallsign: string | null;
  readonly lastLoggedQsoBand: string | null;
  readonly lastLoggedQsoMode: string | null;
  readonly lastLoggedQsoFrequencyMHz: number | null;
  readonly lastImportSuccessAtUtc: string | null;
  readonly lastImportFailureStage: string | null;
  readonly lastImportFailureReason: string | null;
  readonly timing: WsjtxTimingEvidence;
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
  private joinedMulticastInterfaces = new Set<string>();
  private listenerState: WsjtxDiagnostics['listenerState'] = 'stopped';
  private recoveryTimer: NodeJS.Timeout | null = null;
  private recoveryAttempts = 0;
  private lastSocketError: string | null = null;
  private latest: WsjtxObservation | null = null;
  private lastError: string | null = null;
  private packetsReceived = 0;
  private lastPacketReceivedAtUtc: string | null = null;
  private lastStatusPacketReceivedAtUtc: string | null = null;
  private statusPacketsAccepted = 0;
  private lastStatusParsedAtUtc: string | null = null;
  private lastStatusStateUpdatedAtUtc: string | null = null;
  private loggedQsoPacketsAccepted = 0;
  private loggedQsoParseFailures = 0;
  private lastLoggedQsoAtUtc: string | null = null;
  private lastLoggedQsoResult: string | null = null;
  private lastLoggedQsoCallsign: string | null = null;
  private lastLoggedQsoBand: string | null = null;
  private lastLoggedQsoMode: string | null = null;
  private lastLoggedQsoFrequencyMHz: number | null = null;
  private lastImportSuccessAtUtc: string | null = null;
  private lastImportFailureStage: string | null = null;
  private lastImportFailureReason: string | null = null;
  private lastCurrentRequestId: number | null = null;
  private lastCurrentRequestReceivedAtUtc: string | null = null;
  private lastCurrentResponseProducedAtUtc: string | null = null;
  constructor(private readonly options: { readonly host?: string; readonly port?: number; readonly multicastAddress?: string; readonly multicastInterface?: string; readonly networkInterfaces?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>; readonly now?: () => Date; readonly onLoggedQso?: (candidate: WsjtxLoggedQsoCandidate) => string | void } = {}) {}

  start(): void {
    if (this.socket || this.recoveryTimer) return;
    if (this.listenerState === 'stopped') this.recoveryAttempts = 0;
    this.listenerState = 'starting';
    const socket = this.options.multicastAddress ? dgram.createSocket({ type: 'udp4', reuseAddr: true }) : dgram.createSocket('udp4');
    socket.on('message', packet => this.handlePacket(packet));
    socket.on('error', error => this.failSocket(socket, error.message));
    socket.on('close', () => {
      if (this.socket !== socket || this.listenerState === 'stopped') return;
      this.socket = null;
      this.joinedMulticastInterfaces.clear();
      this.lastError = 'WSJT-X listener socket closed unexpectedly.';
      this.scheduleRecovery();
    });
    const bindHost = this.options.multicastAddress ? '0.0.0.0' : this.options.host ?? WSJTX_DEFAULT_HOST;
    this.socket = socket;
    socket.bind(this.options.port ?? WSJTX_DEFAULT_PORT, bindHost, () => {
      if (!this.options.multicastAddress) { this.listenerState = 'active'; this.lastError = null; return; }
      const interfaces = this.options.multicastInterface ? [this.options.multicastInterface] : this.getEligibleMulticastInterfaces();
      const failures: string[] = [];
      for (const networkInterface of interfaces) {
        try { socket.addMembership(this.options.multicastAddress, networkInterface); this.joinedMulticastInterfaces.add(networkInterface); }
        catch (error) { failures.push(`${networkInterface}: ${error instanceof Error ? error.message : 'membership failed'}`); }
      }
      if (this.joinedMulticastInterfaces.size === 0) { this.failSocket(socket, failures.join('; ') || 'No eligible IPv4 multicast interfaces were found.'); return; }
      this.lastError = failures.length ? `Some WSJT-X multicast memberships failed: ${failures.join('; ')}` : null;
      if (failures.length) this.lastSocketError = this.lastError;
      this.listenerState = 'active';
      this.recoveryAttempts = 0;
    });
  }

  handlePacket(packet: Uint8Array): void {
    this.packetsReceived += 1;
    const receivedAtUtc = this.options.now?.().toISOString() ?? new Date().toISOString();
    this.lastPacketReceivedAtUtc = receivedAtUtc;
    if (isStatusPacket(packet)) this.lastStatusPacketReceivedAtUtc = receivedAtUtc;
    const observation = parseWsjtxStatusPacket(packet, this.options.now);
    if (observation) { this.latest = observation; this.statusPacketsAccepted += 1; this.lastStatusParsedAtUtc = observation.receivedAtUtc; this.lastStatusStateUpdatedAtUtc = observation.receivedAtUtc; this.lastError = null; }
    const loggedQso = parseWsjtxLoggedQsoPacket(packet);
    if (loggedQso) {
      this.loggedQsoPacketsAccepted += 1;
      this.lastLoggedQsoAtUtc = this.options.now?.().toISOString() ?? new Date().toISOString();
      this.lastLoggedQsoCallsign = loggedQso.callsign;
      this.lastLoggedQsoBand = loggedQso.band;
      this.lastLoggedQsoMode = loggedQso.mode;
      this.lastLoggedQsoFrequencyMHz = loggedQso.frequencyMHz;
      setImmediate(() => {
        try {
          const result = this.options.onLoggedQso?.(loggedQso);
          const outcome = typeof result === 'string' ? result : 'received';
          this.lastLoggedQsoResult = outcome;
          if (outcome === 'persisted') this.lastImportSuccessAtUtc = this.lastLoggedQsoAtUtc;
          else {
            const separator = outcome.indexOf(':');
            this.lastImportFailureStage = separator < 0 ? outcome : outcome.slice(0, separator);
            this.lastImportFailureReason = separator < 0 ? null : outcome.slice(separator + 1);
          }
        } catch {
          this.lastLoggedQsoResult = 'handler_error';
          this.lastImportFailureStage = 'handler';
          this.lastImportFailureReason = 'The Logged QSO handler failed.';
        }
      });
    } else if (isLoggedQsoPacket(packet)) {
      this.loggedQsoParseFailures += 1;
      this.lastLoggedQsoResult = 'parse_failed';
    }
  }

  recordCurrentRequest(requestId: number, receivedAtUtc: string): void { this.lastCurrentRequestId = requestId; this.lastCurrentRequestReceivedAtUtc = receivedAtUtc; }
  recordCurrentResponse(producedAtUtc: string): void { this.lastCurrentResponseProducedAtUtc = producedAtUtc; }

  getDiagnostics(): WsjtxDiagnostics { return { listenerMode: this.options.multicastAddress ? 'multicast' : 'unicast', listenerState: this.listenerState, multicastAddress: this.options.multicastAddress ?? null, multicastInterface: this.options.multicastInterface ?? null, multicastInterfaces: [...this.joinedMulticastInterfaces], multicastJoined: this.joinedMulticastInterfaces.size > 0, lastSocketError: this.lastSocketError, packetsReceived: this.packetsReceived, lastPacketReceivedAtUtc: this.lastPacketReceivedAtUtc, statusPacketsAccepted: this.statusPacketsAccepted, lastStatusParsedAtUtc: this.lastStatusParsedAtUtc, lastStatusStateUpdatedAtUtc: this.lastStatusStateUpdatedAtUtc, loggedQsoPacketsAccepted: this.loggedQsoPacketsAccepted, loggedQsoParseFailures: this.loggedQsoParseFailures, lastLoggedQsoAtUtc: this.lastLoggedQsoAtUtc, lastLoggedQsoResult: this.lastLoggedQsoResult, lastLoggedQsoCallsign: this.lastLoggedQsoCallsign, lastLoggedQsoBand: this.lastLoggedQsoBand, lastLoggedQsoMode: this.lastLoggedQsoMode, lastLoggedQsoFrequencyMHz: this.lastLoggedQsoFrequencyMHz, lastImportSuccessAtUtc: this.lastImportSuccessAtUtc, lastImportFailureStage: this.lastImportFailureStage, lastImportFailureReason: this.lastImportFailureReason, timing: { lastStatusPacketReceivedAtUtc: this.lastStatusPacketReceivedAtUtc, lastStatusParsedAtUtc: this.lastStatusParsedAtUtc, lastStatusStateUpdatedAtUtc: this.lastStatusStateUpdatedAtUtc, lastCurrentRequestId: this.lastCurrentRequestId, lastCurrentRequestReceivedAtUtc: this.lastCurrentRequestReceivedAtUtc, lastCurrentResponseProducedAtUtc: this.lastCurrentResponseProducedAtUtc } }; }

  stop(): void { this.listenerState = 'stopped'; this.recoveryAttempts = 0; if (this.recoveryTimer) clearTimeout(this.recoveryTimer); this.recoveryTimer = null; if (this.socket) this.leaveMulticast(this.socket); this.socket?.close(); this.socket = null; }

  private failSocket(socket: dgram.Socket, message: string): void {
    if (this.socket !== socket) return;
    this.lastError = message;
    this.lastSocketError = message;
    this.leaveMulticast(socket);
    socket.close();
    this.socket = null;
    this.scheduleRecovery();
  }

  private scheduleRecovery(): void {
    this.listenerState = this.recoveryAttempts < 3 ? 'recovering' : 'failed';
    if (this.listenerState !== 'recovering') return;
    this.recoveryAttempts += 1;
    this.recoveryTimer = setTimeout(() => { this.recoveryTimer = null; this.start(); }, 1000);
  }

  private leaveMulticast(socket: dgram.Socket): void {
    if (this.options.multicastAddress) {
      for (const networkInterface of this.joinedMulticastInterfaces) {
        try { socket.dropMembership(this.options.multicastAddress, networkInterface); } catch { /* socket is already closing */ }
      }
      this.joinedMulticastInterfaces.clear();
    }
  }

  private getEligibleMulticastInterfaces(): string[] {
    const addresses = new Set<string>();
    for (const entries of Object.values(this.options.networkInterfaces?.() ?? os.networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === 'IPv4') addresses.add(entry.address);
      }
    }
    return [...addresses].sort();
  }

  getSnapshot(now = this.options.now ?? (() => new Date())): WsjtxSnapshot {
    if (!this.latest) return { status: this.lastError ? 'unavailable' : 'unavailable', state: null, receivedAtUtc: null, limitation: this.lastError || 'No WSJT-X Status message has been received.' };
    const age = now().getTime() - new Date(this.latest.receivedAtUtc).getTime();
    if (age > WSJTX_UNAVAILABLE_AFTER_MS) return { status: 'unavailable', state: null, receivedAtUtc: this.latest.receivedAtUtc, limitation: 'No recent WSJT-X Status message is available.' };
    if (age > WSJTX_STALE_AFTER_MS) return { status: 'stale', state: { ...this.latest.state, freshness: 'stale', status: 'stale' }, receivedAtUtc: this.latest.receivedAtUtc, limitation: 'The last WSJT-X Status message is older than the fresh-state tolerance.' };
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

function isLoggedQsoPacket(packet: Uint8Array): boolean {
  if (packet.length < 12) return false;
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  return view.getUint32(0) === WSJTX_MAGIC && WSJTX_SUPPORTED_SCHEMAS.has(view.getUint32(4)) && view.getUint32(8) === WSJTX_QSO_LOGGED_MESSAGE;
}

function isStatusPacket(packet: Uint8Array): boolean {
  if (packet.length < 12) return false;
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  return view.getUint32(0) === WSJTX_MAGIC && WSJTX_SUPPORTED_SCHEMAS.has(view.getUint32(4)) && view.getUint32(8) === WSJTX_STATUS_MESSAGE;
}