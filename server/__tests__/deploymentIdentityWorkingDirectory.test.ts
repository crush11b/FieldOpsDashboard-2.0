import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDeploymentIdentity } from '../deploymentIdentity';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('production deployment identity', () => {
  it('reproduces identity loss when cwd differs from the install root', () => {
    const installRoot = mkdtempSync(path.join(process.env.TEMP ?? '/tmp', 'fieldops-identity-install-'));
    const unrelatedWorkingDirectory = mkdtempSync(path.join(process.env.TEMP ?? '/tmp', 'fieldops-identity-cwd-'));
    temporaryDirectories.push(installRoot, unrelatedWorkingDirectory);
    mkdirSync(path.join(installRoot, 'dist'), { recursive: true });
    writeFileSync(path.join(installRoot, 'dist', 'server.cjs'), 'production bundle fixture');
    writeFileSync(path.join(installRoot, 'deployment-manifest.json'), JSON.stringify({
      sourceRevision: '095121a30adc0db516e048a80ac5b10b8c9f5d04',
      nativeRevision: '095121a30adc0db516e048a80ac5b10b8c9f5d04',
      informationalVersion: '2.9.0+095121a30adc0db516e048a80ac5b10b8c9f5d04',
      deployedAtUtc: '2026-09-13T00:00:00.000Z',
    }));

    const originalWorkingDirectory = process.cwd();
    try {
      process.chdir(unrelatedWorkingDirectory);
      expect(loadDeploymentIdentity(undefined, path.join(installRoot, 'dist', 'server.cjs'))).toMatchObject({
        sourceRevision: '095121a30adc0db516e048a80ac5b10b8c9f5d04',
        nativeRevision: '095121a30adc0db516e048a80ac5b10b8c9f5d04',
        informationalVersion: '2.9.0+095121a30adc0db516e048a80ac5b10b8c9f5d04',
      });
    } finally {
      process.chdir(originalWorkingDirectory);
    }
  });

  it.each([
    ['missing', 'missing.json'],
    ['malformed', 'malformed.json'],
    ['incomplete', 'incomplete.json'],
  ])('keeps %s manifests unavailable', (_label, fileName) => {
    const installRoot = mkdtempSync(path.join(process.env.TEMP ?? '/tmp', 'fieldops-identity-invalid-'));
    temporaryDirectories.push(installRoot);
    mkdirSync(path.join(installRoot, 'dist'), { recursive: true });
    const manifestPath = path.join(installRoot, fileName);
    if (_label === 'malformed') writeFileSync(manifestPath, '{not-json');
    if (_label === 'incomplete') writeFileSync(manifestPath, JSON.stringify({ sourceRevision: '095121a30adc0db516e048a80ac5b10b8c9f5d04' }));
    expect(loadDeploymentIdentity(manifestPath, path.join(installRoot, 'dist', 'server.cjs'))).toEqual({});
  });

  it('rejects a non-absolute explicit manifest path', () => {
    expect(loadDeploymentIdentity('deployment-manifest.json', 'C:\\FieldOpsDashboard\\dist\\server.cjs')).toEqual({});
  });
});