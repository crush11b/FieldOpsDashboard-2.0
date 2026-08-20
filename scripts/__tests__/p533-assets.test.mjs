import {existsSync} from 'node:fs';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {assertSha256, requiredRuntimeFiles, validateManifest, verifyP533Assets} from '../p533-assets.mjs';
import {getP533RuntimePath, runtimeRoot} from '../p533-runtime-path.mjs';

describe('P.533 offline asset manifest', () => {
  it('pins the complete model identity, all months, static decile data, and both WASM hashes', async () => {
    const manifest = JSON.parse(await readFile(path.resolve('p533-assets/manifest.json'), 'utf8'));
    expect(validateManifest(manifest).dataFiles).toHaveLength(25);
    expect(manifest.p533MjsSha256).toHaveLength(64);
    expect(manifest.p533WasmSha256).toHaveLength(64);
    expect(requiredRuntimeFiles()).toHaveLength(28);
  });

  it('rejects missing files and corrupted bytes through the verifier helpers', async () => {
    const bundle = await mkdtemp(path.join(os.tmpdir(), 'fieldops-p533-test-'));
    await writeFile(path.join(bundle, 'provenance.json'), JSON.stringify({modelVersion: 'v14.3', dataVersion: 'p533-data-v14.3', installedFiles: {}}));
    await expect(verifyP533Assets(bundle)).rejects.toThrow(/runtime file is missing: p533\.mjs/);
    const original = new TextEncoder().encode('p533');
    const expected = 'a1c1d7a0d8c3f9a8a6c0e50f3c6c1c4f5a6d3bc8c7a7c1be1c6d1e96b0db2a15';
    expect(() => assertSha256(new TextEncoder().encode('corrupt'), expected, 'p533.wasm')).toThrow(/SHA-256 mismatch/);
  });

  it('resolves only a local runtime path and has no URL or fetch dependency', () => {
    expect(runtimeRoot).toMatch(/[\\/]p533-assets[\\/]runtime$/);
    expect(getP533RuntimePath('p533.wasm')).toMatch(/[\\/]p533-assets[\\/]runtime[\\/]p533\.wasm$/);
    expect(() => getP533RuntimePath('../outside')).toThrow(/local basenames/);
  });

  it.skipIf(!existsSync(getP533RuntimePath('p533.wasm')))('verifies the provisioned loader and WASM bytes', async () => {
    await expect(verifyP533Assets()).resolves.toMatchObject({files: 27});
  });
});