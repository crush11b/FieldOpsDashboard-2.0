import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import canonicalMetadata from '../../product-metadata.json';
import {
  getDiagnosticProductMetadata,
  getProductUserAgent,
  getVersionedDownloadFilename,
  PRODUCT_METADATA,
} from '../productMetadata';

const root = path.resolve(import.meta.dirname, '../..');

describe('centralized product metadata', () => {
  it('exposes the canonical release identity and valid semantic version', () => {
    expect(PRODUCT_METADATA.productName).toBe('FieldOps Dashboard');
    expect(PRODUCT_METADATA.version).toBe('2.2.0');
    expect(PRODUCT_METADATA.version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    expect(PRODUCT_METADATA.releaseName).toBe('Trustworthy Dashboard');
  });

  it('keeps package and lock metadata synchronized with the authority', () => {
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');

    expect(packageJson.name).toBe(canonicalMetadata.packageName);
    expect(packageJson.version).toBe(canonicalMetadata.version);
    expect(packageLock.name).toBe(canonicalMetadata.packageName);
    expect(packageLock.version).toBe(canonicalMetadata.version);
    expect(packageLock.packages[''].name).toBe(canonicalMetadata.packageName);
    expect(packageLock.packages[''].version).toBe(canonicalMetadata.version);
  });

  it('derives user-agent, ZIP, ADIF, and sanitized diagnostic metadata', () => {
    expect(getProductUserAgent()).toBe('FieldOpsDashboard/2.2.0');
    expect(getProductUserAgent('NOAA/NWS')).toBe('FieldOpsDashboard/2.2.0 (NOAA/NWS)');
    expect(getVersionedDownloadFilename()).toBe('FieldOpsDashboard-2.2.0.zip');
    expect(PRODUCT_METADATA.adifProgramId).toBe('FieldOpsDashboard');
    expect(PRODUCT_METADATA.adifProgramVersion).toBe('2.2.0');
    expect(getDiagnosticProductMetadata()).toEqual({
      product: 'FieldOps Dashboard',
      version: '2.2.0',
      release: 'Trustworthy Dashboard',
    });
  });

  it('removes obsolete prototype identity from release-facing manifests', () => {
    const releaseFiles = [
      'package.json',
      'package-lock.json',
      'bun.lock',
      'index.html',
      'metadata.json',
      'public/manifest.json',
      'public/sw.js',
      'README_OFFLINE_DEPLOYMENT.txt',
    ].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');

    expect(releaseFiles).not.toContain('react-example');
    expect(releaseFiles).not.toContain('"version": "0.0.0"');
  });
});

function readJson(relativePath: string): any {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}
