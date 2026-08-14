import * as net from 'node:net';
import type { Request, Response, Router } from 'express';
import express from 'express';
import type { AppLauncherItem } from '../src/types';

export const LAUNCHER_PIPE = '\\\\.\\pipe\\FieldOps.Tray.Launcher.v1';
export const LAUNCHER_MAX_FRAME = 4096;
export const LAUNCHER_TIMEOUT_MS = 5000;

export type TrayLaunchType = 1 | 2;
export type TrayLaunchResult = 1 | 2 | 3 | 4 | 5 | 6;
export type LaunchApiStatus =
  | 'Launched'
  | 'UriOpened'
  | 'ExecutableNotFound'
  | 'InvalidRequest'
  | 'LaunchFailed'
  | 'Busy'
  | 'LauncherUnavailable';

export interface TrayLaunchRequest {
  LaunchType: TrayLaunchType;
  Target: string;
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

export function resolveConfiguredLaunch(apps: readonly AppLauncherItem[], appId: unknown): TrayLaunchRequest | LaunchApiResponse {
  if (typeof appId !== 'string' || appId.length === 0 || appId.length > 128) {
    return { status: 'InvalidRequest', detail: 'Application ID is required.' };
  }

  const matches = apps.filter(app => app.id === appId);
  if (matches.length !== 1) {
    return {
      status: 'InvalidRequest',
      detail: matches.length === 0 ? 'The configured application was not found.' : 'The application ID is ambiguous.',
    };
  }

  const app = matches[0];
  if (app.uri !== undefined) {
    if (isPermittedHttpUri(app.uri)) {
      return { LaunchType: 2, Target: app.uri };
    }
    return { status: 'InvalidRequest', detail: 'The configured application URI is invalid.' };
  }
  if (isAbsoluteLocalExePath(app.executablePath)) {
    return { LaunchType: 1, Target: app.executablePath };
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
      const socket = this.connect(this.pipeName);
      let buffer = Buffer.alloc(0);
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
        const payload = Buffer.from(JSON.stringify(request));
        if (payload.length > LAUNCHER_MAX_FRAME) {
          finish(() => reject(new Error('Launcher request is too large.')));
          return;
        }
        const frame = Buffer.alloc(4 + payload.length);
        frame.writeInt32LE(payload.length, 0);
        payload.copy(frame, 4);
        socket.write(frame);
      });
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > LAUNCHER_MAX_FRAME + 4) {
          finish(() => reject(new Error('Launcher response is too large.')));
          return;
        }
        if (buffer.length < 4) return;
        const length = buffer.readInt32LE(0);
        if (length <= 0 || length > LAUNCHER_MAX_FRAME) {
          finish(() => reject(new Error('Launcher response framing was invalid.')));
          return;
        }
        if (buffer.length < length + 4) return;
        try {
          const parsed = JSON.parse(buffer.subarray(4, length + 4).toString('utf8')) as TrayLaunchResponse;
          if (!parsed || !Number.isInteger(parsed.Result) || typeof parsed.Detail !== 'string') throw new Error('Launcher response was malformed.');
          finish(() => resolve(parsed));
        } catch (error) {
          finish(() => reject(error));
        }
      });
      socket.once('error', error => finish(() => reject(error)));
      socket.once('close', () => {
        if (!settled) finish(() => reject(new Error('Launcher pipe is unavailable.')));
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
  };
  return { status: statuses[response.Result] ?? 'LaunchFailed', detail: response.Detail.slice(0, 512) };
}

export function createLauncherRouter(
  apps: readonly AppLauncherItem[],
  client: TrayLauncherClient,
): Router {
  const router = express.Router();
  router.post('/api/apps/launch', async (request: Request, response: Response) => {
    if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::1' && request.socket.remoteAddress !== '::ffff:127.0.0.1') {
      response.status(403).json({ status: 'InvalidRequest', detail: 'Application launching is local-only.' } satisfies LaunchApiResponse);
      return;
    }

    const resolved = resolveConfiguredLaunch(apps, request.body?.appId);
    if ('status' in resolved) {
      response.status(400).json(resolved);
      return;
    }

    try {
      response.json(mapTrayResponse(await client.launch(resolved)));
    } catch {
      response.json({ status: 'LauncherUnavailable', detail: 'The FieldOps Tray launcher is unavailable. Start the Tray and try again.' } satisfies LaunchApiResponse);
    }
  });
  return router;
}