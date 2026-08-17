import {createHash} from 'node:crypto';
import {cp, mkdtemp, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'p533-assets', 'manifest.json');
const runtimePath = path.join(root, 'p533-assets', 'runtime');
const publicPath = path.join(root, 'public', 'p533');
const noticePath = path.join(root, 'p533-assets', 'NOTICE.txt');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function assertSha256(bytes, expected, fileName) {
  const actual = sha256(bytes);
  if (actual !== expected) throw new Error(`P.533 SHA-256 mismatch for ${fileName}: expected ${expected}, got ${actual}.`);
  return actual;
}

export function requiredRuntimeFiles() {
  return ['p533.mjs', 'p533.wasm', ...manifest.dataFiles.map((file) => file.runtimeName), 'provenance.json'];
}

export function validateManifest(value = manifest) {
  if (value.modelName !== 'ITU-R P.533' || value.recommendation !== 'P.533-14' || value.modelVersion !== 'v14.3') throw new Error('P.533 manifest has an unexpected model identity.');
  if (value.dataVersion !== 'p533-data-v14.3' || value.dataFiles.length !== 25) throw new Error('P.533 manifest does not contain the complete v14.3 runtime file set.');
  const ionos = new Set(value.dataFiles.filter((file) => file.runtimeName.startsWith('ionos')).map((file) => file.runtimeName));
  const coeff = new Set(value.dataFiles.filter((file) => file.runtimeName.startsWith('COEFF')).map((file) => file.runtimeName));
  for (let month = 1; month <= 12; month += 1) {
    const suffix = String(month).padStart(2, '0');
    if (!ionos.has(`ionos${suffix}.bin`) || !coeff.has(`COEFF${suffix}W.txt`)) throw new Error(`P.533 manifest is missing month ${suffix}.`);
  }
  if (!value.dataFiles.some((file) => file.runtimeName === 'P1239-3 Decile Factors.txt')) throw new Error('P.533 manifest is missing P.1239 decile factors.');
  return value;
}

export async function verifyP533Assets(bundlePath = runtimePath) {
  validateManifest();
  let provenance;
  try { provenance = JSON.parse(await readFile(path.join(bundlePath, 'provenance.json'), 'utf8')); } catch (error) { throw new Error(`P.533 provenance is missing or malformed: ${error.message}`); }
  if (provenance.dataVersion !== manifest.dataVersion || provenance.modelVersion !== manifest.modelVersion) throw new Error('P.533 provenance does not match the pinned manifest.');
  const expected = new Map([['p533.mjs', manifest.p533MjsSha256], ['p533.wasm', manifest.p533WasmSha256], ...Object.entries(provenance.installedFiles || {})]);
  for (const fileName of requiredRuntimeFiles().filter((name) => name !== 'provenance.json')) {
    const bytes = await readFile(path.join(bundlePath, fileName)).catch(() => { throw new Error(`P.533 runtime file is missing: ${fileName}`); });
    assertSha256(bytes, expected.get(fileName), fileName);
  }
  return {bundlePath, files: requiredRuntimeFiles().length - 1};
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`P.533 asset download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function provision() {
  validateManifest();
  const tempPath = await mkdtemp(path.join(root, 'p533-assets-'));
  try {
    const installedFiles = {};
    for (const [name, url, expected] of [
      ['p533.mjs', `${manifest.wasmSource}/p533.mjs`, manifest.p533MjsSha256],
      ['p533.wasm', `${manifest.wasmSource}/p533.wasm`, manifest.p533WasmSha256],
    ]) {
      const bytes = await download(url);
      if (sha256(bytes) !== expected) throw new Error(`P.533 SHA-256 mismatch for downloaded ${name}.`);
      await writeFile(path.join(tempPath, name), bytes);
    }
    for (const file of manifest.dataFiles) {
      const compressed = await download(`https://github.com/accius/openhamclock/releases/download/${manifest.dataVersion}/${file.name}`);
      if (sha256(compressed) !== file.sha256) throw new Error(`P.533 SHA-256 mismatch for downloaded ${file.name}.`);
      const output = gunzipSync(compressed);
      await writeFile(path.join(tempPath, file.runtimeName), output);
      installedFiles[file.runtimeName] = sha256(output);
    }
    await writeFile(path.join(tempPath, 'provenance.json'), JSON.stringify({
      modelName: manifest.modelName, recommendation: manifest.recommendation, modelVersion: manifest.modelVersion,
      dataVersion: manifest.dataVersion, wasmReleaseId: manifest.wasmReleaseId, dataReleaseId: manifest.dataReleaseId,
      wasmSourceRevision: manifest.wasmSourceRevision, provisionedAtUtc: new Date().toISOString(), installedFiles,
      runtimeNetworkRequired: false,
    }, null, 2) + '\n');
    await rm(runtimePath, {recursive: true, force: true});
    await rename(tempPath, runtimePath);
    console.log(`P.533 assets provisioned under ${runtimePath}`);
  } catch (error) {
    await rm(tempPath, {recursive: true, force: true});
    throw error;
  }
}

export async function preparePublicAssets() {
  await verifyP533Assets();
  await rm(publicPath, {recursive: true, force: true});
  await cp(runtimePath, publicPath, {recursive: true});
  await cp(noticePath, path.join(publicPath, 'NOTICE.txt'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const verifyOnly = process.argv.includes('--verify-only');
  const prepare = process.argv.includes('--prepare-public');
  const bundleArgument = process.argv.find((argument) => argument.startsWith('--bundle='));
  const bundlePath = bundleArgument ? path.resolve(bundleArgument.slice('--bundle='.length)) : runtimePath;
  if (prepare) await preparePublicAssets();
  else if (verifyOnly) await verifyP533Assets(bundlePath);
  else await provision();
}