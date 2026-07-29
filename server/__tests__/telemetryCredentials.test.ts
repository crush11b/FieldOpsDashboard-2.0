import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  constantTimeDigestEquals,
  digestTelemetryBearerToken,
  FileTelemetryCredentialRepository,
  generateTelemetryBearerCredential,
  getDefaultTelemetryCredentialPath,
  TELEMETRY_TOKEN_BYTES,
} from '../telemetryCredentials';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('telemetry credential generation', () => {
  it('generates distinct transport-safe credentials with 256 bits of material', () => {
    const first = generateTelemetryBearerCredential();
    const second = generateTelemetryBearerCredential();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first, 'base64url')).toHaveLength(TELEMETRY_TOKEN_BYTES);
  });

  it('creates stable SHA-256 digests and compares them safely', () => {
    const token = generateTelemetryBearerCredential();
    const digest = digestTelemetryBearerToken(token);

    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(constantTimeDigestEquals(digest, digest)).toBe(true);
    expect(constantTimeDigestEquals(digest, digestTelemetryBearerToken(generateTelemetryBearerCredential()))).toBe(false);
    expect(constantTimeDigestEquals(digest, 'malformed')).toBe(false);
  });
});

describe('FileTelemetryCredentialRepository', () => {
  it('resolves an enabled credential to its receiver-owned identity and scopes', async () => {
    const token = generateTelemetryBearerCredential();
    const { repository, contents } = await repositoryFor([
      record('field-agent-1', token, ['telemetry:write']),
    ]);

    await expect(repository.resolveBearerToken(token)).resolves.toEqual({
      agentId: 'field-agent-1',
      scopes: ['telemetry:write'],
    });
    expect(contents).not.toContain(token);
    expect(contents).toContain(digestTelemetryBearerToken(token));
  });

  it('rejects wrong, malformed, and revoked credentials', async () => {
    const token = generateTelemetryBearerCredential();
    const { repository } = await repositoryFor([record('field-agent-1', token, ['telemetry:write'], false)]);

    await expect(repository.resolveBearerToken(token)).resolves.toBeNull();
    await expect(repository.resolveBearerToken(generateTelemetryBearerCredential())).resolves.toBeNull();
    await expect(repository.resolveBearerToken('not-a-canonical-token')).resolves.toBeNull();
  });

  it.each([
    ['missing', null],
    ['malformed JSON', '{'],
    ['wrong schema', JSON.stringify({ schemaVersion: 2, records: [] })],
    ['empty records', JSON.stringify({ schemaVersion: 1, records: [] })],
  ])('fails closed for a %s repository', async (_name, contents) => {
    const directory = await createTemporaryDirectory();
    const credentialPath = path.join(directory, 'credentials.json');
    if (contents !== null) {
      await writeFile(credentialPath, contents);
    }
    const repository = new FileTelemetryCredentialRepository(credentialPath);

    await expect(repository.resolveBearerToken(generateTelemetryBearerCredential())).resolves.toBeNull();
    await expect(repository.isProvisioned()).resolves.toBe(false);
  });

  it('fails closed when the repository path is unreadable as a credential file', async () => {
    const directory = await createTemporaryDirectory();
    const repository = new FileTelemetryCredentialRepository(directory);

    await expect(repository.resolveBearerToken(generateTelemetryBearerCredential())).resolves.toBeNull();
    await expect(repository.isProvisioned()).resolves.toBe(false);
  });

  it('fails closed for duplicate agent IDs or token digests', async () => {
    const first = generateTelemetryBearerCredential();
    const second = generateTelemetryBearerCredential();
    const duplicateAgent = await repositoryFor([
      record('same-agent', first, ['telemetry:write']),
      record('same-agent', second, ['telemetry:write']),
    ]);
    const duplicateDigest = await repositoryFor([
      record('agent-one', first, ['telemetry:write']),
      record('agent-two', first, ['telemetry:write']),
    ]);

    await expect(duplicateAgent.repository.resolveBearerToken(first)).resolves.toBeNull();
    await expect(duplicateDigest.repository.resolveBearerToken(first)).resolves.toBeNull();
  });

  it('reloads the repository deterministically after rotation', async () => {
    const oldToken = generateTelemetryBearerCredential();
    const newToken = generateTelemetryBearerCredential();
    const directory = await createTemporaryDirectory();
    const credentialPath = path.join(directory, 'credentials.json');
    const repository = new FileTelemetryCredentialRepository(credentialPath);
    await writeRepository(credentialPath, [record('field-agent-1', oldToken, ['telemetry:write'])]);
    await expect(repository.resolveBearerToken(oldToken)).resolves.not.toBeNull();

    await writeRepository(credentialPath, [record('field-agent-1', newToken, ['telemetry:write'])]);

    await expect(repository.resolveBearerToken(oldToken)).resolves.toBeNull();
    await expect(repository.resolveBearerToken(newToken)).resolves.toMatchObject({ agentId: 'field-agent-1' });
  });

  it('preserves insufficient scopes for Express to return 403', async () => {
    const token = generateTelemetryBearerCredential();
    const { repository } = await repositoryFor([record('field-agent-1', token, ['telemetry:read'])]);

    await expect(repository.resolveBearerToken(token)).resolves.toEqual({
      agentId: 'field-agent-1',
      scopes: ['telemetry:read'],
    });
  });

  it('uses explicit configuration or the protected ProgramData default', () => {
    expect(getDefaultTelemetryCredentialPath({
      FIELDOPS_TELEMETRY_CREDENTIAL_FILE: 'C:\\secure\\receiver.json',
    })).toBe(path.resolve('C:\\secure\\receiver.json'));
    expect(getDefaultTelemetryCredentialPath({ ProgramData: 'C:\\ProgramData' }))
      .toContain(path.join('FieldOpsDashboard', 'Dashboard', 'telemetry-credentials.json'));
    expect(getDefaultTelemetryCredentialPath({})).toBeNull();
  });
});

async function repositoryFor(records: unknown[]) {
  const directory = await createTemporaryDirectory();
  const credentialPath = path.join(directory, 'credentials.json');
  const contents = JSON.stringify({ schemaVersion: 1, records });
  await writeFile(credentialPath, contents);
  return { repository: new FileTelemetryCredentialRepository(credentialPath), contents };
}

async function writeRepository(credentialPath: string, records: unknown[]): Promise<void> {
  await writeFile(credentialPath, JSON.stringify({ schemaVersion: 1, records }));
}

function record(agentId: string, token: string, scopes: string[], enabled = true) {
  return {
    agentId,
    tokenDigest: digestTelemetryBearerToken(token),
    scopes,
    enabled,
    createdAt: '2026-07-28T16:00:00.000Z',
  };
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'fieldops-telemetry-credentials-'));
  temporaryDirectories.push(directory);
  return directory;
}
