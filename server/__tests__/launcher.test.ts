import { EventEmitter } from 'node:events';
import express from 'express';
import { describe, expect, it } from 'vitest';
import {
  isAbsoluteLocalDirectoryPath,
  isAbsoluteLocalExePath,
  isPermittedHttpUri,
  LAUNCHER_MAX_FRAME,
  LocalLauncherRequestError,
  LauncherProtocolError,
  NamedPipeTrayLauncherClient,
  parseConfiguredArguments,
  resolveConfiguredLaunch,
  createLauncherRouter,
} from '../launcher';
import type { AppLauncherItem } from '../../src/types';
import { INITIAL_CONFIG } from '../../src/data/defaultConfig';

const app = (overrides: Partial<AppLauncherItem> = {}): AppLauncherItem => ({
  id: 'radio-tool',
  name: 'Radio Tool',
  category: 'utilities',
  iconName: 'Radio',
  executablePath: 'C:\\Radio\\tool.exe',
  description: 'Test application',
  installed: false,
  favorite: false,
  ...overrides,
});

describe('Dashboard launcher trust boundary', () => {
  it('resolves only the configured app ID, never a browser target', () => {
    expect(resolveConfiguredLaunch([app()], 'radio-tool')).toEqual({
      ProtocolVersion: 2,
      LaunchType: 1,
      Target: 'C:\\Radio\\tool.exe',
    });
    expect(resolveConfiguredLaunch([app()], 'C:\\Users\\attacker\\evil.exe')).toMatchObject({ status: 'InvalidRequest' });
  });

  it('rejects duplicate IDs instead of guessing', () => {
    expect(resolveConfiguredLaunch([app(), app({ name: 'Other' })], 'radio-tool')).toMatchObject({
      status: 'InvalidRequest',
    });
  });

  it('allows only HTTP and HTTPS configured URIs', () => {
    expect(isPermittedHttpUri('https://field.example/app')).toBe(true);
    expect(isPermittedHttpUri('file:///Windows/System32/calc.exe')).toBe(false);
    expect(resolveConfiguredLaunch([app({ uri: 'powershell://evil' })], 'radio-tool')).toMatchObject({ status: 'InvalidRequest' });
  });

  it('requires an absolute local executable ending in exe', () => {
    expect(isAbsoluteLocalExePath('C:\\Radio\\tool.exe')).toBe(true);
    expect(isAbsoluteLocalExePath('\\\\server\\share\\tool.exe')).toBe(false);
    expect(isAbsoluteLocalExePath('C:\\Radio\\tool.bat')).toBe(false);
  });

  it('preserves quoted arguments as data without shell interpretation', () => {
    expect(resolveConfiguredLaunch([app({ args: '--name "two words" & whoami' })], 'radio-tool')).toEqual({
      ProtocolVersion: 2,
      LaunchType: 1,
      Target: 'C:\\Radio\\tool.exe',
      Arguments: ['--name', 'two words', '&', 'whoami'],
    });
  });

  it('rejects malformed or oversized configured arguments', () => {
    expect(parseConfiguredArguments('')).toEqual([]);
    expect(parseConfiguredArguments('\\')).toEqual(['\\']);
    expect(parseConfiguredArguments('\\\\')).toEqual(['\\\\']);
    expect(parseConfiguredArguments('\\ next')).toEqual(['\\', 'next']);
    expect(parseConfiguredArguments('""')).toEqual(['']);
    expect(parseConfiguredArguments('--name ""')).toEqual(['--name', '']);
    expect(parseConfiguredArguments('"two words"')).toEqual(['two words']);
    expect(parseConfiguredArguments('"quoted   spaces"\tsecond')).toEqual(['quoted   spaces', 'second']);
    expect(parseConfiguredArguments('literal\\"quote')).toEqual(['literal"quote']);
    expect(parseConfiguredArguments('"slashes\\\\\\\"quote"')).toEqual(['slashes\\"quote']);
    expect(parseConfiguredArguments('"trailing\\\\"')).toEqual(['trailing\\']);
    expect(parseConfiguredArguments('pre"middle"post')).toEqual(['premiddlepost']);
    expect(parseConfiguredArguments('"unterminated')).toMatchObject({ status: 'InvalidRequest' });
    expect(parseConfiguredArguments('nul\0value')).toMatchObject({ status: 'InvalidRequest' });
    expect(parseConfiguredArguments(Array.from({ length: 65 }, () => 'x').join(' '))).toMatchObject({ status: 'InvalidRequest' });
    expect(parseConfiguredArguments('x'.repeat(4097))).toMatchObject({ status: 'InvalidRequest' });
  });

  it('carries only a valid explicit native working directory', () => {
    expect(isAbsoluteLocalDirectoryPath('C:\\Radio')).toBe(true);
    expect(isAbsoluteLocalDirectoryPath('\\\\server\\share')).toBe(false);
    expect(resolveConfiguredLaunch([app({ workingDir: 'relative' })], 'radio-tool')).toMatchObject({ status: 'InvalidWorkingDirectory' });
    expect(resolveConfiguredLaunch([app({ uri: 'https://field.example', args: '--not-native' })], 'radio-tool')).toMatchObject({ status: 'InvalidRequest' });
  });
});


class FakeSocket extends EventEmitter {
  readonly writes: Buffer[] = [];
  destroyed = false;

  write(value: Buffer): boolean {
    this.writes.push(value);
    return true;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

function responseFrame(response: unknown, trailing = Buffer.alloc(0)): Buffer {
  const payload = Buffer.from(JSON.stringify(response));
  const frame = Buffer.alloc(4 + payload.length + trailing.length);
  frame.writeInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  trailing.copy(frame, 4 + payload.length);
  return frame;
}

function validRequest() {
  return resolveConfiguredLaunch([app({ args: '"two words"' })], 'radio-tool') as Exclude<ReturnType<typeof resolveConfiguredLaunch>, { status: string }>;
}

describe('Named pipe launcher client', () => {
  it('accepts a response split across data events and cleans up', async () => {
    const socket = new FakeSocket();
    const promise = new NamedPipeTrayLauncherClient('test', 100, (() => socket) as never).launch(validRequest());
    socket.emit('connect');
    const frame = responseFrame({ Result: 1, Detail: 'accepted' });
    socket.emit('data', frame.subarray(0, 3));
    socket.emit('data', frame.subarray(3));
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    socket.emit('close');
    await expect(promise).resolves.toEqual({ Result: 1, Detail: 'accepted' });
    expect(socket.destroyed).toBe(true);
    expect(socket.listenerCount('data')).toBe(0);
  });

  it('resolves a clean close and rejects trailing data after an event-loop delay', async () => {
    const socket = new FakeSocket();
    const promise = new NamedPipeTrayLauncherClient('test', 100, (() => socket) as never).launch(validRequest());
    socket.emit('connect');
    socket.emit('data', responseFrame({ Result: 1, Detail: 'accepted' }));
    await new Promise(resolve => setTimeout(resolve, 0));
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    expect(settled).toBe(false);
    socket.emit('data', Buffer.from([1]));
    await expect(promise).rejects.toBeInstanceOf(LauncherProtocolError);
  });

  it.each([
    ['zero', Buffer.from([0, 0, 0, 0])],
    ['negative', Buffer.from([255, 255, 255, 255])],
    ['oversized', (() => { const value = Buffer.alloc(4); value.writeInt32LE(LAUNCHER_MAX_FRAME + 1); return value; })()],
  ])('rejects %s response length as a protocol error', async (_name, frame) => {
    const socket = new FakeSocket();
    const promise = new NamedPipeTrayLauncherClient('test', 100, (() => socket) as never).launch(validRequest());
    socket.emit('connect');
    socket.emit('data', frame);
    await expect(promise).rejects.toBeInstanceOf(LauncherProtocolError);
  });

  it.each([
    ['truncated', Buffer.from([5, 0, 0, 0, 123])],
    ['malformed JSON', responseFrameText('{bad')],
    ['unknown member', responseFrame({ Result: 1, Detail: 'ok', Extra: true })],
    ['invalid result', responseFrame({ Result: 99, Detail: 'ok' })],
    ['oversized detail', responseFrame({ Result: 1, Detail: 'x'.repeat(513) })],
    ['trailing bytes', responseFrame({ Result: 1, Detail: 'ok' }, Buffer.from([1]))],
  ])('rejects %s response as a protocol error', async (_name, frame) => {
    const socket = new FakeSocket();
    const promise = new NamedPipeTrayLauncherClient('test', 100, (() => socket) as never).launch(validRequest());
    socket.emit('connect');
    socket.emit('data', frame);
    if (_name === 'truncated') socket.emit('close');
    await expect(promise).rejects.toBeInstanceOf(LauncherProtocolError);
  });

  it('distinguishes timeout and connection failure from protocol failure', async () => {
    const timeoutSocket = new FakeSocket();
    const timeout = new NamedPipeTrayLauncherClient('test', 5, (() => timeoutSocket) as never).launch(validRequest());
    await expect(timeout).rejects.not.toBeInstanceOf(LauncherProtocolError);

    const failedSocket = new FakeSocket();
    const failed = new NamedPipeTrayLauncherClient('test', 100, (() => failedSocket) as never).launch(validRequest());
    failedSocket.emit('error', new Error('connection failed'));
    await expect(failed).rejects.not.toBeInstanceOf(LauncherProtocolError);
  });

  it('rejects a locally oversized request before opening the pipe', async () => {
    let connected = false;
    const request = { ...validRequest(), Arguments: ['x'.repeat(LAUNCHER_MAX_FRAME)] };
    const client = new NamedPipeTrayLauncherClient('test', 100, (() => { connected = true; return new FakeSocket(); }) as never);
    await expect(client.launch(request)).rejects.toBeInstanceOf(LocalLauncherRequestError);
    expect(connected).toBe(false);
  });
});

function responseFrameText(payload: string): Buffer {
  const bytes = Buffer.from(payload);
  const frame = Buffer.alloc(4 + bytes.length);
  frame.writeInt32LE(bytes.length, 0);
  bytes.copy(frame, 4);
  return frame;
}

describe('Launcher route mapping', () => {
  async function post(body: unknown, client: { launch: (request: any) => Promise<any> }, apps = [app({ args: '--configured' })]) {
    const application = express();
    application.use(express.json());
    application.use(createLauncherRouter(apps, client));
    const server = await new Promise<ReturnType<typeof application.listen>>(resolve => {
      const instance = application.listen(0, '127.0.0.1', () => resolve(instance));
    });
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      return await fetch(`http://127.0.0.1:${port}/api/apps/launch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }

  it('ignores browser target, arguments, and working-directory fields', async () => {
    let received: any;
    const response = await post({ appId: 'radio-tool', Target: 'C:\\attacker.exe', Arguments: ['evil'], WorkingDirectory: 'C:\\attacker' }, { launch: async request => { received = request; return { Result: 1, Detail: 'ok' }; } });
    expect(response.status).toBe(200);
    expect(received).toEqual({ ProtocolVersion: 2, LaunchType: 1, Target: 'C:\\Radio\\tool.exe', Arguments: ['--configured'] });
  });

  it('reports a locally oversized configured request as invalid request', async () => {
    const oversized = app({ executablePath: `C:\\${'x'.repeat(8200)}.exe` });
    const response = await post({ appId: 'radio-tool' }, { launch: async () => ({ Result: 1, Detail: 'unexpected' }) }, [oversized]);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ status: 'InvalidRequest', detail: 'The configured launcher request exceeds the allowed size.' });
  });

  it('maps protocol errors and unavailable errors separately', async () => {
    const protocol = await post({ appId: 'radio-tool' }, { launch: async () => { throw new LauncherProtocolError(); } });
    await expect(protocol.json()).resolves.toMatchObject({ status: 'LauncherProtocolError' });
    const unavailable = await post({ appId: 'radio-tool' }, { launch: async () => { throw new Error('pipe closed'); } });
    await expect(unavailable.json()).resolves.toMatchObject({ status: 'LauncherUnavailable' });
    const incompatible = await post({ appId: 'radio-tool' }, { launch: async () => ({ Result: 7, Detail: 'unsupported' }) });
    await expect(incompatible.json()).resolves.toMatchObject({ status: 'ProtocolIncompatible' });
  });

  it('uses the persisted catalog target and rejects disabled records', async () => {
    const editedRecord = { ...INITIAL_CONFIG.appCatalog.records[0], target: { kind: 'native' as const, executablePath: 'C:\\Edited\\target.exe' } };
    const catalog = { ...INITIAL_CONFIG.appCatalog, records: [editedRecord] };
    let received: any;
    const response = await post({ appId: editedRecord.id }, { launch: async request => { received = request; return { Result: 1, Detail: 'ok' }; } }, [],);
    expect(response.status).toBe(400);

    const application = express();
    application.use(express.json());
    application.use(createLauncherRouter(() => ({ kind: 'ready', catalog }), { launch: async request => { received = request; return { Result: 1, Detail: 'ok' }; } }));
    const server = await new Promise<ReturnType<typeof application.listen>>(resolve => {
      const instance = application.listen(0, '127.0.0.1', () => resolve(instance));
    });
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const editedResponse = await fetch(`http://127.0.0.1:${port}/api/apps/launch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appId: editedRecord.id }) });
      expect(editedResponse.status).toBe(200);
      expect(received.Target).toBe('C:\\Edited\\target.exe');

      const disabledCatalog = { ...catalog, records: [{ ...editedRecord, enabled: false }] };
      const disabledApplication = express();
      disabledApplication.use(express.json());
      disabledApplication.use(createLauncherRouter(() => ({ kind: 'ready', catalog: disabledCatalog }), { launch: async () => ({ Result: 1, Detail: 'unexpected' }) }));
      const disabledServer = await new Promise<ReturnType<typeof disabledApplication.listen>>(resolve => {
        const instance = disabledApplication.listen(0, '127.0.0.1', () => resolve(instance));
      });
      try {
        const disabledAddress = disabledServer.address();
        const disabledPort = typeof disabledAddress === 'object' && disabledAddress ? disabledAddress.port : 0;
        const disabledResponse = await fetch(`http://127.0.0.1:${disabledPort}/api/apps/launch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appId: editedRecord.id }) });
        expect(disabledResponse.status).toBe(400);
      } finally {
        await new Promise<void>(resolve => disabledServer.close(() => resolve()));
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
