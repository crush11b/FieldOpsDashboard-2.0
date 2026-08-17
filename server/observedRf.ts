import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';

import type { OperatingLocation } from '../src/location/operatingLocation';
import {
  OBSERVED_RF_CACHE_STALE_AFTER_MS,
  OBSERVED_RF_SOURCE_ID,
  OBSERVED_RF_SOURCE_NAME,
  OBSERVED_RF_WINDOW_MS,
  buildObservedRfTopicPatterns,
  isPskReceptionReport,
  latLonGrid4,
  parsePskPayload,
  summarizeObservedRfReports,
  type ObservedRfConnectionStatus,
  type ObservedRfSnapshot,
  type PskReceptionReport,
} from '../src/propagation/observedRf';

export const PSKREPORTER_MQTT_URL = 'wss://mqtt.pskreporter.info:1886/mqtt';
export const OBSERVED_RF_RECONNECT_MAX_MS = 120_000;

export interface ObservedRfMqttClient {
  on(event: 'connect' | 'close' | 'error' | 'offline' | 'message', listener: (...args: any[]) => void): this;
  subscribe(topic: string | string[], options: { qos: 0 }, callback: (error?: Error) => void): this;
  unsubscribe(topic: string | string[], callback: (error?: Error) => void): this;
  end(force?: boolean): this;
  removeAllListeners(): this;
}

export type ObservedRfMqttFactory = (url: string, options: IClientOptions) => ObservedRfMqttClient;

interface CacheFile {
  readonly grid4: string;
  readonly observationWindow: { readonly startsAt: string; readonly endsAt: string };
  readonly sourceWasLive: boolean;
  readonly validCollection: boolean;
  readonly collectedAtUtc: string;
  readonly reports: readonly PskReceptionReport[];
}

export function getDefaultObservedRfCachePath(environment: NodeJS.ProcessEnv = process.env, homeDirectory = os.homedir()): string {
  const localAppData = environment.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local');
  return path.join(localAppData, 'FieldOpsDashboard', 'observed-rf-cache.json');
}

export interface ObservedRfServiceOptions {
  readonly cachePath?: string;
  readonly now?: () => Date;
  readonly mqttFactory?: ObservedRfMqttFactory;
  readonly mqttUrl?: string;
  readonly reconnectBaseMs?: number;
}

export class ObservedRfService {
  private readonly now: () => Date;
  private readonly cachePath: string;
  private readonly mqttFactory: ObservedRfMqttFactory;
  private readonly mqttUrl: string;
  private readonly reconnectBaseMs: number;
  private client: ObservedRfMqttClient | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private connectionStatus: ObservedRfConnectionStatus = 'unavailable';
  private operatingGrid4: string | null = null;
  private cachedGrid4: string | null = null;
  private reports = new Map<string, PskReceptionReport>();
  private cachedCollectedAtUtc: string | null = null;
  private cachedObservationWindow: CacheFile['observationWindow'] | null = null;
  private cachedValidCollection = false;

  constructor(options: ObservedRfServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.cachePath = options.cachePath ?? getDefaultObservedRfCachePath();
    this.mqttFactory = options.mqttFactory ?? ((url, mqttOptions) => mqtt.connect(url, mqttOptions) as unknown as ObservedRfMqttClient);
    this.mqttUrl = options.mqttUrl ?? PSKREPORTER_MQTT_URL;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1000;
    this.loadCache();
  }

  setOperatingLocation(location: OperatingLocation | null): void {
    const nextGrid4 = location?.coordinates
      && location.provenance !== 'unavailable'
      ? latLonGrid4(location.coordinates.lat, location.coordinates.lon)
      : null;
    if (nextGrid4 === this.operatingGrid4) {
      if (nextGrid4 && !this.client && this.connectionStatus === 'unavailable') this.connect();
      return;
    }

    const oldGrid4 = this.operatingGrid4;
    this.operatingGrid4 = nextGrid4;
    const cacheMatchesOperatingGrid = nextGrid4 !== null && nextGrid4 === this.cachedGrid4;
    if (!cacheMatchesOperatingGrid) {
      this.reports.clear();
      this.cachedCollectedAtUtc = null;
      this.cachedObservationWindow = null;
      this.cachedValidCollection = false;
    }
    if (oldGrid4) this.unsubscribeGrid(oldGrid4);
    if (nextGrid4) {
      this.connectionStatus = 'connecting';
      if (this.client) this.subscribeGrid(nextGrid4);
      else this.connect();
    } else {
      this.disconnect(false);
      this.connectionStatus = 'unavailable';
    }
    if (!cacheMatchesOperatingGrid) this.persist(false);
  }

  getSnapshot(): ObservedRfSnapshot {
    const now = this.now();
    this.prune(now);
    const reports = [...this.reports.values()].sort((left, right) => left.observedAtUtc.localeCompare(right.observedAtUtc));
    const newest = reports.at(-1)?.observedAtUtc ?? this.cachedCollectedAtUtc ?? now.toISOString();
    const status = this.resolveStatus(now, newest);
    const topics = this.operatingGrid4 ? buildObservedRfTopicPatterns(this.operatingGrid4) : ([] as const);
    return {
      kind: 'observed_rf',
      status,
      evidenceStatus: status === 'live' ? 'live_observed_rf_source' : status === 'cached' ? 'cached_observed_rf_source' : status === 'stale' ? 'stale_observed_rf_source' : 'unavailable',
      operatingGrid4: this.operatingGrid4,
      observationWindow: status === 'live' || !this.cachedObservationWindow
        ? { startsAt: new Date(now.getTime() - OBSERVED_RF_WINDOW_MS).toISOString(), endsAt: now.toISOString() }
        : this.cachedObservationWindow,
      collectedAtUtc: this.cachedCollectedAtUtc ?? now.toISOString(),
      reports,
      bandSummaries: summarizeObservedRfReports(reports),
      provenance: {
        sourceId: OBSERVED_RF_SOURCE_ID,
        sourceName: OBSERVED_RF_SOURCE_NAME,
        transport: 'mqtts-websocket',
        brokerHost: 'mqtt.pskreporter.info',
        brokerPort: 1886,
        topicPatterns: topics,
      },
    };
  }

  close(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.disconnect(true);
    this.connectionStatus = 'unavailable';
  }

  private connect(): void {
    if (!this.operatingGrid4 || this.client) return;
    this.connectionStatus = this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting';
    const client = this.mqttFactory(this.mqttUrl, {
      clientId: `fieldops_observed_rf_${Math.random().toString(16).slice(2, 12)}`,
      clean: true,
      connectTimeout: 15_000,
      reconnectPeriod: 0,
      keepalive: 60,
      protocolVersion: 4,
    });
    this.client = client;
    client.on('connect', () => {
      if (client !== this.client || !this.operatingGrid4) return;
      this.reconnectAttempt = 0;
      this.connectionStatus = 'live';
      this.cachedValidCollection = true;
      this.cachedObservationWindow = { startsAt: new Date(this.now().getTime() - OBSERVED_RF_WINDOW_MS).toISOString(), endsAt: this.now().toISOString() };
      this.persist(true);
      this.subscribeGrid(this.operatingGrid4);
    });
    client.on('message', (topic: string, payload: Uint8Array) => {
      if (client !== this.client || !this.operatingGrid4) return;
      const report = parsePskPayload(topic, payload, this.operatingGrid4, this.now());
      if (!report) return;
      this.reports.set(report.reportId, report);
      this.prune(this.now());
      this.persist(true);
    });
    client.on('offline', () => { if (client === this.client) this.connectionStatus = 'reconnecting'; });
    client.on('error', () => { if (client === this.client) this.connectionStatus = 'reconnecting'; });
    client.on('close', () => {
      if (client !== this.client) return;
      this.client = null;
      this.connectionStatus = 'reconnecting';
      this.scheduleReconnect();
    });
  }

  private subscribeGrid(grid4: string): void {
    if (!this.client) return;
    this.client.subscribe([...buildObservedRfTopicPatterns(grid4)], { qos: 0 }, () => {});
  }

  private unsubscribeGrid(grid4: string): void {
    if (!this.client) return;
    this.client.unsubscribe([...buildObservedRfTopicPatterns(grid4)], () => {});
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.operatingGrid4) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(this.reconnectBaseMs * 2 ** Math.min(this.reconnectAttempt - 1, 10), OBSERVED_RF_RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private disconnect(force: boolean): void {
    const client = this.client;
    this.client = null;
    if (!client) return;
    client.removeAllListeners();
    client.on('error', () => {});
    client.end(force);
  }

  private prune(now: Date): void {
    const cutoff = now.getTime() - OBSERVED_RF_WINDOW_MS;
    for (const [id, report] of this.reports) {
      const observedAt = Date.parse(report.observedAtUtc);
      if (!isPskReceptionReport(report)
        || !Number.isFinite(observedAt)
        || observedAt < cutoff
        || observedAt > now.getTime() + 2 * 60 * 1000) {
        this.reports.delete(id);
      }
    }
  }

  private resolveStatus(now: Date, newest: string): ObservedRfConnectionStatus {
    if (this.connectionStatus === 'live') return 'live';
    if (this.operatingGrid4 === null) return 'unavailable';
    const age = now.getTime() - Date.parse(newest);
    if (this.cachedValidCollection) return age <= OBSERVED_RF_WINDOW_MS ? 'cached' : 'stale';
    return this.connectionStatus === 'connecting' || this.connectionStatus === 'reconnecting' ? this.connectionStatus : 'unavailable';
  }

  private loadCache(): void {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      if (!isCacheFile(value)) return;
      this.cachedGrid4 = value.grid4;
      this.cachedCollectedAtUtc = value.collectedAtUtc;
      this.cachedObservationWindow = value.observationWindow;
      this.cachedValidCollection = value.validCollection && value.sourceWasLive;
      this.reports = new Map(value.reports.map(report => [report.reportId, report]));
      this.prune(this.now());
    } catch { /* cache is optional */ }
  }

  private persist(validCollection: boolean): void {
    if (!this.operatingGrid4) return;
    const now = this.now();
    const cache: CacheFile = {
      grid4: this.operatingGrid4,
      observationWindow: { startsAt: new Date(now.getTime() - OBSERVED_RF_WINDOW_MS).toISOString(), endsAt: now.toISOString() },
      sourceWasLive: validCollection,
      validCollection,
      collectedAtUtc: now.toISOString(),
      reports: [...this.reports.values()],
    };
    this.cachedGrid4 = this.operatingGrid4;
    this.cachedCollectedAtUtc = cache.collectedAtUtc;
    this.cachedObservationWindow = cache.observationWindow;
    this.cachedValidCollection = validCollection;
    const directory = path.dirname(this.cachePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.cachePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporaryPath, this.cachePath);
    } finally {
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
    }
  }
}

function isCacheFile(value: unknown): value is CacheFile {
  return isRecord(value) && typeof value.grid4 === 'string' && /^[A-R]{2}[0-9]{2}$/.test(value.grid4)
    && isRecord(value.observationWindow)
    && typeof value.observationWindow.startsAt === 'string' && Number.isFinite(Date.parse(value.observationWindow.startsAt))
    && typeof value.observationWindow.endsAt === 'string' && Number.isFinite(Date.parse(value.observationWindow.endsAt))
    && Date.parse(value.observationWindow.startsAt) <= Date.parse(value.observationWindow.endsAt)
    && typeof value.sourceWasLive === 'boolean' && typeof value.validCollection === 'boolean'
    && typeof value.collectedAtUtc === 'string' && Number.isFinite(Date.parse(value.collectedAtUtc))
    && Array.isArray(value.reports) && value.reports.every(isPskReceptionReport);
}
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
