import express from 'express';
import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createOperationsReadinessRouter } from '../operationsReadinessApi';
import type { OperationsReadinessAssemblyOptions, OperationsReadinessAssemblyResult } from '../operationsReadinessAssembly';
import type { MissionForecastRecord } from '../missionForecast';

function appFor(result: OperationsReadinessAssemblyResult) {
  const app = express();
  app.use(createOperationsReadinessRouter({ assembly: async () => result }));
  return app;
}

function appForAssembly(assembly: (briefId: string, options?: OperationsReadinessAssemblyOptions) => Promise<OperationsReadinessAssemblyResult>) {
  const app = express();
  app.use(createOperationsReadinessRouter({ assembly }));
  return app;
}

function offlineResult(): OperationsReadinessAssemblyResult { return { status: 'ok', summary: { plan: { activationReference: 'K8ABC/POTA' }, evaluatedAtUtc: '2026-08-25T12:00:00.000Z', findings: [{ id: 'plan-retained', status: 'ready', message: 'Plan retained' }, { id: 'current-location', status: 'ready', message: 'GPS ready' }, { id: 'clock-synchronization', status: 'ready', message: 'Clock synchronized' }, { id: 'mission-window', status: 'ready', message: 'Window retained' }, { id: 'weather', status: 'unavailable', message: 'Network weather unavailable' }, { id: 'weather-alerts', status: 'unavailable', message: 'Network alerts unavailable' }, { id: 'propagation-evidence', status: 'attention', message: 'Propagation retained' }, { id: 'sota-dataset-state', status: 'ready', message: 'SOTA data retained' }] } as never, displayEvidence: {} as never, diagnostics: [{ code: 'weather_enrichment_unavailable', message: 'Network weather unavailable.' }] }; }
function forecast(): MissionForecastRecord { return { schemaVersion: 1, briefId: 'brief-1', activation: { program: 'POTA', reference: 'K8ABC/POTA' }, plannedSite: { latitude: 40, longitude: -80, gridSquare: null, provenance: 'operator' }, missionWindow: { start: '2026-08-25T13:00:00.000Z', end: '2026-08-25T15:00:00.000Z' }, provider: { id: 'open-meteo-mission-forecast', name: 'Open-Meteo', timezone: 'UTC' }, retrievedAtUtc: '2026-08-25T12:00:00.000Z', periods: [], status: 'live', sourceUrl: 'https://example.test', limitations: [], diagnostics: [], updatedAtUtc: '2026-08-25T12:00:00.000Z' }; }

async function request(result: OperationsReadinessAssemblyResult, path: string) {
  const server = http.createServer(appFor(result));
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}${path}`;
  try {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function requestApp(app: express.Express, path: string) {
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}${path}`;
  try {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function requestPost(app: express.Express, path: string) {
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}${path}`;
  try {
    const response = await fetch(url, { method: 'POST' });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe('Operations Readiness API', () => {
  it('reports retained forecast and verified offline P.533 independently when network evidence fails', async () => {
    const app = express().use(createOperationsReadinessRouter({ assembly: async () => offlineResult(), offlineEvidence: { readGnssTime: async () => ({ status: 'Available', timestampUtc: '2026-08-25T12:00:00.000Z', sentenceType: 'RMC' }), readMissionForecast: () => ({ status: 'found', record: forecast(), diagnostics: [] }), verifyP533: async () => ({ files: 27 }) } }));
    const result = await requestPost(app, '/api/offline-preparation/brief-1'); const checks = result.body.checks as { id: string; status: string }[];
    expect(result.status).toBe(200); expect(checks.find(check => check.id === 'mission-forecast')).toMatchObject({ status: 'ready' }); expect(checks.find(check => check.id === 'offline-p533')).toMatchObject({ status: 'ready' }); expect(checks.find(check => check.id === 'weather')).toMatchObject({ status: 'unavailable' });
  });

  it('distinguishes missing retained forecast from P.533 verification error', async () => {
    const app = express().use(createOperationsReadinessRouter({ assembly: async () => offlineResult(), offlineEvidence: { readGnssTime: async () => ({ status: 'Unavailable', timestampUtc: null, sentenceType: 'RMC' }), readMissionForecast: () => ({ status: 'notFound', diagnostics: [] }), verifyP533: async () => { throw new Error('runtime not present'); } } }));
    const result = await requestPost(app, '/api/offline-preparation/brief-1'); const checks = result.body.checks as { id: string; status: string; message: string }[];
    expect(result.status).toBe(200); expect(checks.find(check => check.id === 'mission-forecast')).toMatchObject({ status: 'unavailable' }); expect(checks.find(check => check.id === 'offline-p533')).toMatchObject({ status: 'error', message: 'Error - runtime not present' }); expect(checks.find(check => check.id === 'gnss-time')).toMatchObject({ status: 'unavailable' });
  });
  it('rejects malformed brief IDs before assembly', async () => {
    const result = await request({ status: 'ok', summary: {} as never, displayEvidence: {} as never, diagnostics: [] }, '/api/operations-readiness/%5Cbad');
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ kind: 'operations_readiness_error', code: 'invalid_id' });
  });

  it.each([
    ['notFound', 404, 'brief_not_found'],
    ['unsupported', 422, 'unsupported_brief_schema'],
    ['unavailable', 503, 'readiness_unavailable'],
  ] as const)('maps %s assembly results to the contract status', async (status, expectedStatus, code) => {
    const result = await request({ status, diagnostics: [{ code: code as never, message: 'safe diagnostic' }] } as never, '/api/operations-readiness/brief-1');
    expect(result.status).toBe(expectedStatus);
    expect(result.body).toMatchObject({ kind: 'operations_readiness_error', code, diagnostics: [{ message: 'safe diagnostic' }] });
  });

  it('returns the read-only summary envelope', async () => {
    const result = await request({ status: 'ok', summary: { evaluatedAtUtc: '2026-08-19T12:00:00.000Z' } as never, displayEvidence: { weather: { status: 'not_requested', data: null, retrievedAtUtc: null, source: { id: 'local', type: 'derived' } }, alerts: { status: 'not_requested', active: [], retrievedAtUtc: null, source: { id: 'local', type: 'derived' } } }, diagnostics: [] }, '/api/operations-readiness/brief-1');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ kind: 'operations_readiness', briefId: 'brief-1', summary: { evaluatedAtUtc: '2026-08-19T12:00:00.000Z' }, displayEvidence: { weather: { status: 'not_requested', data: null }, alerts: { status: 'not_requested', active: [] } }, diagnostics: [] });
  });

  it('serializes complete live display evidence without invoking providers', async () => {
    const retrievedAtUtc = '2026-08-20T12:00:00.000Z';
    const result = await request({
      status: 'ok',
      summary: {} as never,
      displayEvidence: {
        weather: {
          status: 'live',
          data: {
            tempF: 41, tempC: 5, humidity: 70, pressureInHg: 29.88, pressureHpa: 1012,
            windMph: 12, windGustMph: 18, windDir: 'W', condition: 'Partly Cloudy', icon: 'sun',
            locationName: 'Elkins, WV', dewPointF: 30, uvIndex: 1, lastUpdated: retrievedAtUtc,
            cached: false, hourlyForecast: [{ time: '12 PM', tempF: 42, precipProb: 20, windMph: 10, weatherCode: 2 }],
          },
          retrievedAtUtc,
          source: { id: 'open-meteo-current-weather', type: 'weather_provider', name: 'Open-Meteo current weather' },
          limitation: 'Provider request succeeded, but no freshness threshold or provider observation timestamp is established.',
        },
        alerts: {
          status: 'live',
          active: [{ id: 'alert-1', severity: 'Unknown', title: 'High Wind Warning', description: 'Strong winds expected.', area: 'Test County', issued: 'Recently', expires: 'Until further notice' }],
          retrievedAtUtc,
          source: { id: 'noaa-nws-active-alerts', type: 'weather_alert_provider', name: 'NOAA/NWS active alerts' },
          limitation: 'Provider request succeeded, but no freshness threshold or provider observation timestamp is established.',
        },
      },
      diagnostics: [],
    }, '/api/operations-readiness/brief-1');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      kind: 'operations_readiness',
      displayEvidence: {
        weather: {
          status: 'live',
          data: { tempF: 41, pressureHpa: 1012, locationName: 'Elkins, WV', hourlyForecast: [{ tempF: 42, precipProb: 20, windMph: 10, weatherCode: 2 }] },
          retrievedAtUtc,
          source: { id: 'open-meteo-current-weather' },
          limitation: expect.stringContaining('no freshness threshold'),
        },
        alerts: {
          status: 'live',
          active: [{ id: 'alert-1', severity: 'Unknown', title: 'High Wind Warning', description: 'Strong winds expected.', area: 'Test County', issued: 'Recently', expires: 'Until further notice' }],
          retrievedAtUtc,
          source: { id: 'noaa-nws-active-alerts' },
          limitation: expect.stringContaining('no freshness threshold'),
        },
      },
    });
  });

  it('passes the decoded valid brief ID to the assembly', async () => {
    let receivedBriefId = '';
    const result = await requestApp(appForAssembly(async briefId => {
      receivedBriefId = briefId;
      return { status: 'ok', summary: {} as never, displayEvidence: {} as never, diagnostics: [] };
    }), '/api/operations-readiness/brief%3Aone');
    expect(result.status).toBe(200);
    expect(receivedBriefId).toBe('brief:one');
  });

  it.each([
    ['omitted', '', false],
    ['empty', '?includeLiveWeather=', false],
    ['false', '?includeLiveWeather=false', false],
    ['one', '?includeLiveWeather=1', false],
    ['yes', '?includeLiveWeather=yes', false],
    ['uppercase', '?includeLiveWeather=TRUE', false],
    ['repeated values', '?includeLiveWeather=true&includeLiveWeather=false', false],
    ['array-like value', '?includeLiveWeather[]=true', false],
    ['object-like value', '?includeLiveWeather[enabled]=true', false],
    ['exact lowercase true', '?includeLiveWeather=true', true],
  ] as const)('uses live weather only for %s', async (_label, query, expected) => {
    let received: boolean | undefined;
    const result = await requestApp(appForAssembly(async (_briefId, options) => {
      received = options?.includeLiveWeather;
      return { status: 'ok', summary: {} as never, displayEvidence: {} as never, diagnostics: [] };
    }), `/api/operations-readiness/brief-1${query}`);
    expect(result.status).toBe(200);
    expect(received).toBe(expected);
  });

  it('returns 200 when optional evidence is diagnosed but summary assembly succeeds', async () => {
    const result = await request({ status: 'ok', summary: {} as never, displayEvidence: {} as never, diagnostics: [{ code: 'checklist_unavailable', message: 'Checklist evidence is unavailable.' }] }, '/api/operations-readiness/brief-1');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ kind: 'operations_readiness', diagnostics: [{ code: 'checklist_unavailable' }] });
  });

  it('keeps bounded unavailable results at 503', async () => {
    const result = await request({ status: 'unavailable', diagnostics: [{ code: 'evaluation_clock_unavailable', message: 'The evaluation clock is unavailable.' }] }, '/api/operations-readiness/brief-1');
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: 'readiness_unavailable', diagnostics: [{ code: 'evaluation_clock_unavailable' }] });
  });

  it('returns a safe 500 when assembly unexpectedly throws', async () => {
    const result = await requestApp(appForAssembly(async () => { throw new Error('C:\\private\\secret\nstack'); }), '/api/operations-readiness/brief-1');
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ kind: 'operations_readiness_error', code: 'readiness_internal_error', message: 'Operations Readiness encountered an unexpected internal error.' });
    expect(JSON.stringify(result.body)).not.toContain('private');
    expect(JSON.stringify(result.body)).not.toContain('secret');
  });

  it('does not invoke assembly for a malformed ID', async () => {
    const assembly = async () => ({ status: 'ok', summary: {} as never, displayEvidence: {} as never, diagnostics: [] } as OperationsReadinessAssemblyResult);
    const spy = vi.fn(assembly);
    const result = await requestApp(appForAssembly(spy), '/api/operations-readiness/%5Cbad');
    expect(result.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});
