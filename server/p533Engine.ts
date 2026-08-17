import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {getP533RuntimePath} from '../scripts/p533-runtime-path.mjs';
import {
  createP533Input,
  parseP533Report,
  validateP533CircuitRequest,
  type P533AssetProvenance,
  type P533CircuitExecution,
  type P533ErrorCode,
  type P533CircuitRequest,
  type P533CircuitResult,
} from '../src/propagation/p533';

interface P533Module {
  readonly FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array | string): void;
    readFile(path: string): Uint8Array;
  };
  callMain(args: readonly string[]): number;
}

interface P533Factory {
  (options: Record<string, unknown>): Promise<P533Module>;
}

interface P533Manifest {
  readonly modelName: string;
  readonly recommendation: string;
  readonly modelVersion: string;
  readonly p533MjsSha256: string;
  readonly p533WasmSha256: string;
  readonly wasmReleaseId: number;
  readonly dataReleaseId: number;
  readonly wasmSourceRevision: string;
  readonly dataVersion: string;
  readonly dataFiles: readonly { readonly runtimeName: string }[];
  readonly installedFileSha256: Readonly<Record<string, string>>;
}

let executionQueue = Promise.resolve();
let modulePromise: Promise<P533Module> | null = null;

export function executeP533Circuit(request: P533CircuitRequest): Promise<P533CircuitExecution> {
  const issues = validateP533CircuitRequest(request);
  if (issues.length > 0) return Promise.resolve(failure('invalid_request', issues.join('; ')));
  const execution = executionQueue.then(() => executeSerialized(request));
  executionQueue = execution.then(() => undefined, () => undefined);
  return execution;
}

async function executeSerialized(request: P533CircuitRequest): Promise<P533CircuitExecution> {
  try {
    const module = await getP533Module();
    const manifest = await readManifest();
    const started = Date.now();
    await populateDataFiles(module, manifest, request.month);
    module.FS.writeFile('/input.txt', createP533Input(request));
    const returnCode = module.callMain(['/input.txt', '/tmp/output.txt']);
    if (returnCode !== 0) return failure('execution_failed', `P.533 engine returned exit code ${returnCode}.`);
    let rawReport: string;
    try {
      rawReport = new TextDecoder().decode(module.FS.readFile('/tmp/output.txt'));
    } catch {
      return failure('report_missing', 'P.533 engine did not produce /tmp/output.txt.');
    }
    const parsed = parseP533Report(rawReport);
    if (!parsed) return failure('report_parse_failed', 'P.533 report did not contain a parseable calculated-parameters row.');
    const frequency = parsed.frequencies.find(value => Math.abs(value.frequencyMHz - request.frequencyMHz) < 0.001);
    if (!frequency) return failure('report_parse_failed', 'P.533 report did not contain the requested modeled frequency.');
    const result: P533CircuitResult = {
      sourceState: 'modeled',
      model: 'ITU-R P.533',
      modelVersion: 'P.533-14',
      engine: 'ITU-R-HF v14.3',
      request,
      modeledPeriod: { year: request.year, month: request.month, day: request.day, utcHour: request.utcHour },
      frequency,
      elapsedMs: Date.now() - started,
      reportBytes: rawReport.length,
      rawReport,
      assetProvenance: toAssetProvenance(manifest),
    };
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(message.includes('ENOENT') ? 'assets_unavailable' : 'engine_initialization_failed', message);
  }
}

async function getP533Module(): Promise<P533Module> {
  if (!modulePromise) {
    modulePromise = initializeP533Module().catch(error => {
      modulePromise = null;
      throw error;
    });
  }
  return modulePromise;
}

async function initializeP533Module(): Promise<P533Module> {
  const wasmBinary = new Uint8Array(await readFile(getP533RuntimePath('p533.wasm')));
  const imported = await import(pathToFileURL(getP533RuntimePath('p533.mjs')).href) as { default: P533Factory };
  return imported.default({
    wasmBinary,
    noInitialRun: true,
    noExitRuntime: true,
    print: () => undefined,
    printErr: () => undefined,
  });
}

async function populateDataFiles(module: P533Module, manifest: P533Manifest, month: number): Promise<void> {
  module.FS.mkdirTree('/data');
  module.FS.mkdirTree('/tmp');
  const monthCode = String(month).padStart(2, '0');
  const expected = new Set([`ionos${monthCode}.bin`, `COEFF${monthCode}W.txt`, 'P1239-3 Decile Factors.txt']);
  for (const entry of manifest.dataFiles) {
    if (!expected.has(entry.runtimeName)) continue;
    module.FS.writeFile(`/data/${entry.runtimeName}`, new Uint8Array(await readFile(getP533RuntimePath(entry.runtimeName))));
  }
}

async function readManifest(): Promise<P533Manifest> {
  const runtimePath = getP533RuntimePath();
  const manifestPath = path.resolve(runtimePath, '..', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Omit<P533Manifest, 'installedFileSha256'>;
  const provenance = JSON.parse(await readFile(path.join(runtimePath, 'provenance.json'), 'utf8')) as { installedFiles?: Readonly<Record<string, string>> };
  return { ...manifest, installedFileSha256: provenance.installedFiles ?? {} };
}

function toAssetProvenance(manifest: P533Manifest): P533AssetProvenance {
  return {
    modelName: manifest.modelName,
    recommendation: manifest.recommendation,
    modelVersion: manifest.modelVersion,
    dataVersion: manifest.dataVersion,
    wasmReleaseId: manifest.wasmReleaseId,
    dataReleaseId: manifest.dataReleaseId,
    wasmSourceRevision: manifest.wasmSourceRevision,
    p533MjsSha256: manifest.p533MjsSha256,
    p533WasmSha256: manifest.p533WasmSha256,
    installedFileSha256: manifest.installedFileSha256,
    runtimeNetworkRequired: false,
  };
}

function failure(code: P533ErrorCode, message: string): P533CircuitExecution {
  return { ok: false, error: { code, message } } as P533CircuitExecution;
}