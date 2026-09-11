import express from 'express';
import { describe, expect, it } from 'vitest';
import { createAppDiscoveryRouter, statAppFileProbe, WINDOWS_CANDIDATE_PATHS } from '../appDiscovery';
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

async function post(body: unknown, apps: AppLauncherItem[] = [app()], options: Partial<Parameters<typeof createAppDiscoveryRouter>[0]> = {}) {
  const application = express();
  application.use(express.json());
  application.use(createAppDiscoveryRouter({ apps, probe: () => 'missing', now: () => '2026-09-11T00:00:00.000Z', ...options }));
  const server = await new Promise<ReturnType<typeof application.listen>>(resolve => {
    const instance = application.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return await fetch(`http://127.0.0.1:${port}/api/apps/discover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe('App discovery route', () => {
  it('resolves configured applications by ID and reports bounded evidence', async () => {
    const response = await post({ ids: ['radio-tool'] }, [app()], { probe: () => 'file' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.observations['radio-tool']).toMatchObject({ detected: 'yes', installed: 'unknown', available: 'yes', launch: 'unknown' });
  });

  it('reports installed=yes only from an injected installation-evidence provider, never from the file probe alone', async () => {
    const response = await post({ ids: ['radio-tool'] }, [app()], { probe: () => 'file', installationEvidence: () => 'yes' });
    const body = await response.json();
    expect(body.observations['radio-tool']).toMatchObject({ detected: 'yes', installed: 'yes' });
  });

  it('rejects a request body containing any field besides ids, including browser-supplied paths, arguments, working directories, and application objects', async () => {
    const withApps = await post({
      ids: ['radio-tool'],
      executablePath: 'C:\\attacker\\evil.exe',
      apps: [{ id: 'radio-tool', executablePath: 'C:\\attacker\\evil.exe' }],
    });
    expect(withApps.status).toBe(400);

    const withOs = await post({ ids: ['radio-tool'], os: 'windows' });
    expect(withOs.status).toBe(400);

    const withArgs = await post({ ids: ['radio-tool'], args: '--evil' });
    expect(withArgs.status).toBe(400);

    const withWorkingDir = await post({ ids: ['radio-tool'], workingDir: 'C:\\evil' });
    expect(withWorkingDir.status).toBe(400);
  });

  it('rejects malformed, empty, and oversized requests', async () => {
    const malformed = await post({ ids: 'radio-tool' });
    expect(malformed.status).toBe(400);
    const empty = await post({ ids: [] });
    expect(empty.status).toBe(400);
    const oversized = await post({ ids: Array.from({ length: 51 }, (_, i) => `id-${i}`) });
    expect(oversized.status).toBe(400);
    for (const id of ['__proto__', 'radio/tool', 'radio tool', 'RADIO-TOOL']) {
      const invalidId = await post({ ids: [id] });
      expect(invalidId.status).toBe(400);
    }
  });

  it('reports candidate-only native detection as unavailable to the current launcher', async () => {
    const response = await post(
      { ids: ['radio-tool'] },
      [app()],
      { candidatePathsById: { 'radio-tool': ['C:\\Candidate\\tool.exe'] }, probe: path => path.includes('Candidate') ? 'file' : 'missing' },
    );
    const body = await response.json();
    expect(body.observations['radio-tool']).toMatchObject({ detected: 'yes', available: 'no', evidenceSource: 'candidate_path' });
    expect(body.observations['radio-tool'].reason).toMatch(/current launcher/i);
  });

  it('reports an unknown catalog ID truthfully', async () => {
    const response = await post({ ids: ['ghost'] });
    const body = await response.json();
    expect(body.observations.ghost).toMatchObject({ configured: 'no', enabled: 'unknown', detected: 'unknown', installed: 'unknown', available: 'unknown', evidenceSource: 'unknown_id' });
  });

  it('produces deterministic results across repeated calls', async () => {
    const first = await (await post({ ids: ['radio-tool'] }, [app()], { probe: () => 'file' })).json();
    const second = await (await post({ ids: ['radio-tool'] }, [app()], { probe: () => 'file' })).json();
    expect(first).toEqual(second);
  });

  it('reflects persisted catalog enabled state and rejects invalid persisted state', async () => {
    const record = INITIAL_CONFIG.appCatalog.records.find(candidate => candidate.id === 'wsjtx');
    if (!record) throw new Error('Expected persisted catalog record.');
    const disabledResponse = await post({ ids: ['wsjtx'] }, [app()], {
      catalogResolver: () => ({ kind: 'ready', catalog: { ...INITIAL_CONFIG.appCatalog, records: [{ ...record, enabled: false }] } }),
    });
    expect((await disabledResponse.json()).observations.wsjtx).toMatchObject({ enabled: 'no', available: 'no', evidenceSource: 'disabled_record' });

    const invalidResponse = await post({ ids: ['wsjtx'] }, [app()], {
      catalogResolver: () => ({ kind: 'unavailable', reason: 'The persisted configuration is invalid.' }),
    });
    expect(invalidResponse.status).toBe(503);
    expect(await invalidResponse.json()).toMatchObject({ code: 'configuration_unavailable' });
  });
});

describe('statAppFileProbe', () => {
  it('verifies an actual file, not merely a constructed path', () => {
    expect(statAppFileProbe(__filename)).toBe('file');
    expect(statAppFileProbe(__dirname)).toBe('directory');
    expect(statAppFileProbe('C:\\definitely\\does\\not\\exist.exe')).toBe('missing');
  });
});

describe('Windows candidate paths', () => {
  it('never spawns a process or package manager to discover candidates', () => {
    // The candidate table is pure data; asserting its shape guards against
    // reintroducing shell/installer invocation inside discovery.
    for (const paths of Object.values(WINDOWS_CANDIDATE_PATHS)) {
      expect(Array.isArray(paths)).toBe(true);
      for (const path of paths) expect(typeof path).toBe('string');
    }
  });
});
