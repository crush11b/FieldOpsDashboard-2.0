import path from 'node:path';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
import {
  validateP533CircuitRequest,
  type P533CircuitExecution,
  type P533ErrorCode,
  type P533CircuitRequest,
} from '../src/propagation/p533';

interface P533WorkerMessage {
  readonly id: number;
  readonly result: P533CircuitExecution;
}

export interface P533WorkerLike {
  on(event: 'message', listener: (message: P533WorkerMessage) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  postMessage(message: unknown): void;
  terminate(): Promise<number>;
  unref?(): void;
}

interface PendingRequest {
  readonly resolve: (result: P533CircuitExecution) => void;
  readonly reject: (error: Error) => void;
}

export type P533WorkerFactory = () => P533WorkerLike;

export class P533WorkerClient {
  private worker: P533WorkerLike | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly createWorker: P533WorkerFactory = createDefaultWorker) {}

  execute(request: P533CircuitRequest): Promise<P533CircuitExecution> {
    const worker = this.ensureWorker();
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, request });
      } catch (error) {
        this.pending.delete(id);
        reject(toError(error));
      }
    });
  }

  async shutdown(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    this.rejectPending(new Error('P.533 worker was shut down.'));
    await worker.terminate();
  }

  private ensureWorker(): P533WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    this.worker = worker;
    worker.unref?.();
    worker.on('message', message => this.resolveMessage(worker, message));
    worker.on('error', error => this.failWorker(worker, error));
    worker.on('exit', code => this.failWorker(worker, new Error(`P.533 worker exited with code ${code}.`)));
    return worker;
  }

  private resolveMessage(worker: P533WorkerLike, message: P533WorkerMessage): void {
    if (this.worker !== worker) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    pending.resolve(message.result);
  }

  private failWorker(worker: P533WorkerLike, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = null;
    this.rejectPending(error);
    void worker.terminate();
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

const workerClient = new P533WorkerClient();
let executionQueue = Promise.resolve();

export function executeP533Circuit(request: P533CircuitRequest): Promise<P533CircuitExecution> {
  const issues = validateP533CircuitRequest(request);
  if (issues.length > 0) return Promise.resolve(failure('invalid_request', issues.join('; ')));
  const execution = executionQueue.then(() => workerClient.execute(request).catch(error => failure('engine_initialization_failed', errorMessage(error))));
  executionQueue = execution.then(() => undefined, () => undefined);
  return execution;
}

export async function shutdownP533Worker(): Promise<void> {
  await workerClient.shutdown();
}

function createDefaultWorker(): P533WorkerLike {
  const sourceDirectory = path.join(process.cwd(), 'server');
  const bundledWorkerPath = path.join(path.dirname(process.argv[1] ?? ''), 'p533Worker.cjs');
  if (existsSync(bundledWorkerPath)) return new Worker(bundledWorkerPath) as unknown as P533WorkerLike;
  const execArgv = process.execArgv.some(argument => argument.includes('tsx'))
    ? process.execArgv
    : [...process.execArgv, '--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href];
  return new Worker(pathToFileURL(path.join(sourceDirectory, 'p533Worker.ts')), { execArgv }) as unknown as P533WorkerLike;
}

function failure(code: P533ErrorCode, message: string): P533CircuitExecution {
  return { ok: false, error: { code, message } } as P533CircuitExecution;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}