import * as net from 'node:net';
import type { Request, Response, Router } from 'express';
import express from 'express';
import type { AppLauncherItem } from '../src/types';
import { toCatalogRecord, type AppCatalogRecord } from '../src/appCatalog/domain';
import type { DashboardCatalogRuntimeResult } from './dashboardConfig';

export const LAUNCHER_PIPE = '\\\\.\\pipe\\FieldOps.Tray.Launcher.v2';
export const LAUNCHER_PROTOCOL_VERSION = 2 as const;
export const LAUNCHER_MAX_FRAME = 8192;
export const LAUNCHER_TIMEOUT_MS = 5000;
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_BYTES = 4096;
const MAX_WORKING_DIRECTORY_LENGTH = 4096;

export type TrayLaunchType = 1 | 2;
export type TrayLaunchResult = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type LaunchApiStatus =
  | 'Launched'
  | 'UriOpened'
  | 'ExecutableNotFound'
  | 'InvalidRequest'
  | 'LaunchFailed'
  | 'Busy'
  | 'LauncherUnavailable'
  | 'LauncherProtocolError'
  | 'ProtocolIncompatible'
  | 'InvalidWorkingDirectory'
  | 'ConfigurationError';

export interface TrayLaunchRequest {
  ProtocolVersion: typeof LAUNCHER_PROTOCOL_VERSION;
  LaunchType: TrayLaunchType;
  Target: string;
  Arguments?: string[];
  WorkingDirectory?: string;
}

export interface TrayLaunchResponse {
  Result: TrayLaunchResult;
  Detail: string;
}

export interface LaunchApiResponse {
  status: LaunchApiStatus;
  detail: string;
}

export interface TrayLauncherClient {
  launch(request: TrayLaunchRequest): Promise<TrayLaunchResponse>;
}

export class LauncherProtocolError extends Error {
  constructor(message = 'The Tray launcher protocol response was invalid.') {
    super(message);
    this.name = 'LauncherProtocolError';
  }
}

export class LocalLauncherRequestError extends Error {
  constructor() {
    super('The local launcher request is invalid or too large.');
    this.name = 'LocalLauncherRequestError';
  }
}

export function isPermittedHttpUri(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const uri = new URL(value);
    return (uri.protocol === 'http:' || uri.protocol === 'https:') && uri.hostname.length > 0;
  } catch {
    return false;
  }
}

export function isAbsoluteLocalExePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('\\\\')
    && /^[A-Za-z]:\\/.test(value)
    && value.toLowerCase().endsWith('.exe')
    && !/["\0]/.test(value);
}

export function isAbsoluteLocalDirectoryPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_WORKING_DIRECTORY_LENGTH
    && !value.startsWith('\\\\')
    && /^[A-Za-z]:[\\/]/.test(value)
    && !/["\0]/.test(value);
}

export function parseConfiguredArguments(value: unknown): string[] | LaunchApiResponse {
  if (value === undefined || value === '') return [];
  if (typeof value !== 'string' || value.includes('\0')) {
    return { status: 'InvalidRequest', detail: 'Configured arguments are invalid.' };
  }

  const argumentsList: string[] = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /[ \t]/.test(value[index])) index++;
    if (index >= value.length) break;

    let argument = '';
    let inQuotes = false;
    let started = false;
    while (index < value.length) {
      let slashCount = 0;
      while (value[index] === '\\') {
        slashCount++;
        index++;
      }
      if (value[index] === '"') {
        argument += '\\'.repeat(Math.floor(slashCount / 2));
        if (slashCount % 2 === 1) {
          argument += '"';
          index++;
          started = true;
        } else {
          inQuotes = !inQuotes;
          index++;
          started = true;
        }
        continue;
      }
      argument += '\\'.repeat(slashCount);
      if (slashCount > 0) started = true;
      if (index >= value.length) break;
      if (!inQuotes && /[ \t]/.test(value[index])) break;
      argument += value[index++];
      started = true;
    }
    if (inQuotes || !started) return { status: 'InvalidRequest', detail: 'Configured arguments are malformed.' };
    argumentsList.push(argument);
    if (argumentsList.length > MAX_ARGUMENTS) return { status: 'InvalidRequest', detail: 'Configured arguments exceed the allowed count.' };
  }

  if (Buffer.byteLength(JSON.stringify(argumentsList), 'utf8') > MAX_ARGUMENT_BYTES) {
    return { status: 'InvalidRequest', detail: 'Configured arguments exceed the allowed size.' };
  }
  return argumentsList;
}

export function resolveConfiguredLaunch(apps: readonly AppLauncherItem[], appId: unknown): TrayLaunchRequest | LaunchApiResponse {
  const records = apps.map(app => toCatalogRecord(app)).filter((record): record is AppCatalogRecord => record !== null);
  return resolveConfiguredCatalogLaunch(records, appId);
}

export function resolveConfiguredCatalogLaunch(records: readonly AppCatalogRecord[], appId: unknown): TrayLaunchRequest | LaunchApiResponse {
  if (typeof appId !== 'string' || appId.length === 0 || appId.length > 128) {
    return { status: 'InvalidRequest', detail: 'Application ID is required.' };
  }

  const matches = records.filter(app => app.id === appId);
  if (matches.length !== 1) {
    return {
      status: 'InvalidRequest',
      detail: matches.length === 0 ? 'The configured application was not found.' : 'The application ID is ambiguous.',
    };
  }

  const app = matches[0];
  if (!app.enabled) return { status: 'InvalidRequest', detail: 'The configured application is disabled.' };
  if (app.target.kind === 'unsupported') return { status: 'InvalidRequest', detail: 'The configured application target is invalid.' };
  const legacyApp: AppLauncherItem = {
    id: app.id, name: app.name, category: 'utilities', iconName: app.iconName,
    executablePath: app.target.kind === 'native' ? app.target.executablePath : '',
    ...(app.target.kind === 'web' ? { uri: app.target.url } : {}),
    ...(app.target.kind === 'native' && app.target.args ? { args: app.target.args } : {}),
    ...(app.target.kind === 'native' && app.target.workingDir ? { workingDir: app.target.workingDir } : {}),
    description: app.description, installed: false, favorite: app.favorite,
  };
  if (legacyApp.uri !== undefined) {
    if (legacyApp.args !== undefined || legacyApp.workingDir !== undefined) {
      return { status: 'InvalidRequest', detail: 'Web launches cannot include native launch options.' };
    }
    if (isPermittedHttpUri(legacyApp.uri)) {
      return { ProtocolVersion: LAUNCHER_PROTOCOL_VERSION, LaunchType: 2, Target: legacyApp.uri };
    }
    return { status: 'InvalidRequest', detail: 'The configured application URI is invalid.' };
  }
  if (isAbsoluteLocalExePath(legacyApp.executablePath)) {
    const argumentsList = parseConfiguredArguments(legacyApp.args);
    if (!Array.isArray(argumentsList)) return argumentsList;
    if (legacyApp.workingDir !== undefined && !isAbsoluteLocalDirectoryPath(legacyApp.workingDir)) {
      return { status: 'InvalidWorkingDirectory', detail: 'The configured working directory is invalid.' };
    }
    const request: TrayLaunchRequest = {
      ProtocolVersion: LAUNCHER_PROTOCOL_VERSION,
      LaunchType: 1,
      Target: legacyApp.executablePath,
      ...(argumentsList.length > 0 ? { Arguments: argumentsList } : {}),
      ...(legacyApp.workingDir !== undefined ? { WorkingDirectory: legacyApp.workingDir } : {}),
    };
    if (Buffer.byteLength(JSON.stringify(request), 'utf8') > LAUNCHER_MAX_FRAME) {
      return { status: 'InvalidRequest', detail: 'The configured launcher request exceeds the allowed size.' };
    }
    return request;
  }

  return { status: 'InvalidRequest', detail: 'The configured application target is invalid.' };
}

export class NamedPipeTrayLauncherClient implements TrayLauncherClient {
  constructor(
    private readonly pipeName = LAUNCHER_PIPE,
    private readonly timeoutMs = LAUNCHER_TIMEOUT_MS,
    private readonly connect: typeof net.connect = net.connect,
  ) {}

  launch(request: TrayLaunchRequest): Promise<TrayLaunchResponse> {
    return new Promise((resolve, reject) => {
      let payload: Buffer;
      try {
        payload = Buffer.from(JSON.stringify(request));
      } catch {
        reject(new LocalLauncherRequestError());
        return;
      }
      if (payload.length <= 0 || payload.length > LAUNCHER_MAX_FRAME) {
        reject(new LocalLauncherRequestError());
        return;
      }
      const socket = this.connect(this.pipeName);
      let buffer = Buffer.alloc(0);
      let pendingResponse: TrayLaunchResponse | undefined;
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.destroy();
        callback();
      };
      const timer = setTimeout(() => finish(() => reject(new Error('Launcher pipe request timed out.'))), this.timeoutMs);

      socket.once('connect', () => {
        const frame = Buffer.alloc(4 + payload.length);
        frame.writeInt32LE(payload.length, 0);
        payload.copy(frame, 4);
        socket.write(frame);
      });
      socket.on('data', chunk => {
        if (pendingResponse !== undefined) {
          finish(() => reject(new LauncherProtocolError()));
          return;
        }
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > LAUNCHER_MAX_FRAME + 4) {
          finish(() => reject(new LauncherProtocolError()));
          return;
        }
        if (buffer.length < 4) return;
        const length = buffer.readInt32LE(0);
        if (length <= 0 || length > LAUNCHER_MAX_FRAME) {
          finish(() => reject(new LauncherProtocolError()));
          return;
        }
        if (buffer.length < length + 4) return;
        try {
          if (buffer.length !== length + 4) throw new LauncherProtocolError();
          const parsed = JSON.parse(buffer.subarray(4, length + 4).toString('utf8')) as TrayLaunchResponse;
          if (!parsed || ![1, 2, 3, 4, 5, 6, 7, 8].includes(parsed.Result) || typeof parsed.Detail !== 'string' || parsed.Detail.length > 512 || Object.keys(parsed).some(key => !['Result', 'Detail'].includes(key))) {
            throw new LauncherProtocolError();
          }
          pendingResponse = parsed;
        } catch (error) {
          finish(() => reject(error instanceof LauncherProtocolError ? error : new LauncherProtocolError()));
        }
      });
      socket.once('error', error => finish(() => reject(error)));
      socket.once('close', () => {
        if (!settled) {
          if (pendingResponse !== undefined) {
            const response = pendingResponse;
            pendingResponse = undefined;
            finish(() => resolve(response));
            return;
          }
          finish(() => reject(buffer.length > 0 ? new LauncherProtocolError() : new Error('Launcher pipe is unavailable.')));
        }
      });
    });
  }
}

function mapTrayResponse(response: TrayLaunchResponse): LaunchApiResponse {
  const statuses: Record<TrayLaunchResult, LaunchApiStatus> = {
    1: 'Launched',
    2: 'UriOpened',
    3: 'ExecutableNotFound',
    4: 'InvalidRequest',
    5: 'LaunchFailed',
    6: 'Busy',
    7: 'ProtocolIncompatible',
    8: 'InvalidWorkingDirectory',
  };
  return { status: statuses[response.Result] ?? 'LaunchFailed', detail: response.Detail.slice(0, 512) };
}

export function createLauncherRouter(
  appsOrResolver: readonly AppLauncherItem[] | (() => DashboardCatalogRuntimeResult),
  client: TrayLauncherClient,
): Router {
  const router = express.Router();
  router.post('/api/apps/launch', async (request: Request, response: Response) => {
    if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::1' && request.socket.remoteAddress !== '::ffff:127.0.0.1') {
      response.status(403).json({ status: 'InvalidRequest', detail: 'Application launching is local-only.' } satisfies LaunchApiResponse);
      return;
    }

    const runtime = typeof appsOrResolver === 'function' ? appsOrResolver() : { kind: 'ready' as const, catalog: { schemaVersion: 1 as const, records: appsOrResolver.map(app => toCatalogRecord(app)).filter((record): record is AppCatalogRecord => record !== null), deletedBuiltInIds: [] } };
    if (runtime.kind === 'unavailable') {
      response.status(503).json({ status: 'ConfigurationError', detail: runtime.reason } satisfies LaunchApiResponse);
      return;
    }
    const resolved = resolveConfiguredCatalogLaunch(runtime.catalog.records, request.body?.appId);
    if ('status' in resolved) {
      response.status(400).json(resolved);
      return;
    }

    try {
      response.json(mapTrayResponse(await client.launch(resolved)));
    } catch (error) {
      if (error instanceof LocalLauncherRequestError) {
        response.status(400).json({ status: 'InvalidRequest', detail: 'The configured launcher request exceeds the allowed size.' } satisfies LaunchApiResponse);
        return;
      }
      if (error instanceof LauncherProtocolError) {
        response.json({ status: 'LauncherProtocolError', detail: 'The Tray launcher returned an invalid protocol response.' } satisfies LaunchApiResponse);
        return;
      }
      response.json({ status: 'LauncherUnavailable', detail: 'The FieldOps Tray launcher is unavailable. Start the Tray and try again.' } satisfies LaunchApiResponse);
    }
  });
  return router;
}
