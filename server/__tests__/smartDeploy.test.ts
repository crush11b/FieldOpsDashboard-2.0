import http from 'node:http';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { MissionEvidence } from '../missionEvidence';
import type { MissionWindowPropagationResult } from '../missionWindowPropagation';
import { PotaActivationTargetResolver } from '../potaTargetResolver';
import { createSmartDeployRouter, SmartDeployService } from '../smartDeploy';
import type { SmartDeployBrief } from '../smartDeployBrief';
import type { SmartDeployBriefStore } from '../smartDeployBriefStore';

const target = {
  program: 'POTA', reference: 'US-1234', displayName: 'Test Park', coordinates: { lat: 37.5, lon: -77.5 },
  gridSquare: 'FM17', provenance: { kind: 'externally_resolved', source: { id: 'pota', type: 'pota_individual_park_api', name: 'POTA' }, resolvedAtUtc: '2026-08-18T11:00:00.000Z' },
} as const;
const operatingLocation = {
  coordinates: { lat: 37.4, lon: -77.4 }, gridSquare: 'FM17', provenance: 'current', status: 'ok',
  source: { id: 'gps', type: 'serial_nmea', name: 'GNSS' },
} as const;
const propagation = { status: 'partial', missionWindow: { start: '2026-08-18T12:00:00.000Z', end: '2026-08-18T14:00:00.000Z' }, generatedAtUtc: '2026-08-18T11:00:00.000Z', samples: [], summary: { successfulSampleCount: 2, failedSampleCount: 1, strongestBandBySample: [], consistentStrongestBand: null, limitations: [] } } as unknown as MissionWindowPropagationResult;
const evidence = { status: 'complete', planningRequest: {}, propagation, geometry: {}, solar: {}, observedRf: {}, generatedAtUtc: '2026-08-18T11:00:00.000Z', limitations: [] } as unknown as MissionEvidence;
const brief = { schemaVersion: 1, briefId: 'brief-1', generatedAtUtc: '2026-08-18T11:00:00.000Z', status: 'partial', mission: {}, sections: {}, limitations: [], summary: 'summary' } as unknown as SmartDeployBrief;

function resolver(status: string, resolvedTarget: typeof target | undefined = target) {
  return { resolve: vi.fn(async () => ({ status, reference: 'US-1234', target: resolvedTarget })) } as unknown as PotaActivationTargetResolver;
}

function store(save: (value: SmartDeployBrief) => void = vi.fn()) {
  return { save, list: vi.fn(() => ({ status: 'missing', briefs: [], diagnostics: [] })), get: vi.fn(() => ({ status: 'notFound', diagnostics: [] })), delete: vi.fn(() => ({ status: 'notFound', diagnostics: [] })) } as unknown as SmartDeployBriefStore;
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    potaReference: ' us-1234 ',
    activationTarget: target,
    plannedOperatingLocation: { ...operatingLocation, planningSemantics: 'provider_reference_default' },
    currentDeviceLocation: operatingLocation,
    propagationObjective: { kind: 'regional', regionId: 'eastern_us' },
    missionWindow: { start: '2026-08-18T12:00:00Z', end: '2026-08-18T14:00:00Z' },
    equipment: { radio: { name: 'Field Radio' }, antenna: { type: 'EFHW' }, modes: ['SSB', 'FT8'], transmitPowerWatts: 10, deployment: { geometry: 'inverted_v', heightCategory: '15_to_30_ft' } },
    objective: 'Test mission',
    ...overrides,
  };
}

function service(options: Partial<ConstructorParameters<typeof SmartDeployService>[0]> = {}) {
  return new SmartDeployService({
    resolver: resolver('live'),
    store: store(),
    spaceWeather: { getSnapshot: vi.fn(async () => ({ modelSsn: { value: 100 } })) } as any,
    observedRf: { setOperatingLocation: vi.fn(), getSnapshot: vi.fn(() => null) } as any,
    propagate: vi.fn(async (value) => { expect(value.planningRequest.missionWindow).toEqual({ start: '2026-08-18T12:00:00.000Z', end: '2026-08-18T14:00:00.000Z' }); expect(value.planningRequest.equipment.modes).toEqual(['SSB', 'FT8']); return propagation; }),
    compose: vi.fn(() => evidence),
    generate: vi.fn(() => brief),
    now: () => new Date('2026-08-18T11:00:00Z'),
    ...options,
  });
}

describe('SmartDeploy orchestration', () => {
  it('resolves POTA, validates the canonical request, generates, and persists the brief', async () => {
    const save = vi.fn();
    const result = await service({ store: store(save) }).generateBrief(request());
    expect(result).toMatchObject({ kind: 'smartdeploy_generation', status: 'partial', persistence: { status: 'saved' }, brief });
    expect(save).toHaveBeenCalledWith(brief);
  });

  it('accepts a provider-neutral POTA target request while preserving the existing pipeline', async () => {
    const targetResolver = resolver('live');
    const result = await service({ resolver: targetResolver }).generateBrief(request({
      targetRequest: { program: 'pota', reference: ' us-1234 ' },
      potaReference: undefined,
    }));
    expect(result).toMatchObject({ kind: 'smartdeploy_generation', brief });
    expect(targetResolver.resolve).toHaveBeenCalledWith({ program: 'POTA', reference: 'us-1234' });
  });

  it('rejects unsupported target programs before resolver or evidence activity', async () => {
    const targetResolver = resolver('live');
    const propagate = vi.fn();
    const result = await service({ resolver: targetResolver, propagate }).generateBrief(request({
      targetRequest: { program: 'SOTA', reference: 'W4V/SH-001' },
      potaReference: undefined,
    }));
    expect(result).toMatchObject({ kind: 'smartdeploy_error', code: 'unsupported_target_program' });
    expect(targetResolver.resolve).not.toHaveBeenCalled();
    expect(propagate).not.toHaveBeenCalled();
  });

  it('defaults the planned site to the resolved provider reference without replacing current device context', async () => {
    const propagate = vi.fn(async value => {
      expect(value.planningRequest.plannedOperatingLocation.coordinates).toEqual(target.coordinates);
      expect(value.planningRequest.plannedOperatingLocation.planningSemantics).toBe('provider_reference_default');
      expect(value.planningRequest.currentDeviceLocation?.coordinates).toEqual(operatingLocation.coordinates);
      expect(value.planningRequest.operatingLocation.coordinates).toEqual(operatingLocation.coordinates);
      return propagation;
    });
    await service({ propagate }).generateBrief(request({ plannedOperatingLocation: undefined }));
    expect(propagate).toHaveBeenCalledOnce();
  });

  it('honors an explicit current-device planned-site selection', async () => {
    const propagate = vi.fn(async value => {
      expect(value.planningRequest.plannedOperatingLocation.coordinates).toEqual(operatingLocation.coordinates);
      expect(value.planningRequest.plannedOperatingLocation.planningSemantics).toBe('operator_selected_current_device');
      expect(value.planningRequest.activationTarget.coordinates).toEqual(target.coordinates);
      return propagation;
    });
    await service({ propagate }).generateBrief(request({ plannedOperatingLocation: undefined, plannedOperatingLocationSelection: 'current_device' }));
    expect(propagate).toHaveBeenCalledOnce();
  });

  it('rejects an invalid explicit propagation region before execution', async () => {
    const propagate = vi.fn();
    const result = await service({ propagate }).generateBrief(request({ propagationObjective: { kind: 'regional', regionId: 'not-a-region' } }));
    expect(result).toMatchObject({ kind: 'smartdeploy_error', code: 'invalid_request' });
    expect(propagate).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', 'pota_invalid', 400], ['unknown', 'pota_unknown', 404], ['unavailable', 'pota_unavailable', 503],
  ] as const)('does not generate for POTA %s', async (status, code, _statusCode) => {
    const generate = vi.fn();
    const result = await service({ resolver: resolver(status), generate }).generateBrief(request());
    expect(result).toMatchObject({ kind: 'smartdeploy_error', code });
    expect(generate).not.toHaveBeenCalled();
  });

  it('allows a stale usable target while preserving a limitation', async () => {
    const compose = vi.fn(() => ({ ...evidence, limitations: [] }));
    const generate = vi.fn((value) => { expect(value.missionEvidence.limitations).toContain('POTA target data is stale and was used without a successful refresh.'); return brief; });
    const result = await service({ resolver: resolver('stale'), compose, generate }).generateBrief(request());
    expect(result).toMatchObject({ kind: 'smartdeploy_generation' });
  });

  it('returns structured planning validation issues before modeling', async () => {
    const propagate = vi.fn();
    const result = await service({ propagate }).generateBrief(request({ missionWindow: { start: '2026-08-18T14:00:00Z', end: '2026-08-18T12:00:00Z' }, equipment: {} }));
    expect(result).toMatchObject({ kind: 'smartdeploy_error', code: 'invalid_request' });
    expect((result as any).issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'missionWindow' }), expect.objectContaining({ path: 'equipment.radio' })]));
    expect(propagate).not.toHaveBeenCalled();
  });

  it('returns the brief with an explicit persistence warning when saving fails', async () => {
    const result = await service({ store: store(() => { throw new Error('disk full'); }) }).generateBrief(request());
    expect(result).toMatchObject({ kind: 'smartdeploy_generation', persistence: { status: 'warning' }, brief });
  });

  it('does not substitute current time for the supplied mission window', async () => {
    const propagate = vi.fn(async (value) => { expect(value.planningRequest.missionWindow.start).toBe('2026-08-18T12:00:00.000Z'); expect(value.planningRequest.missionWindow.end).toBe('2026-08-18T14:00:00.000Z'); return propagation; });
    await service({ propagate }).generateBrief(request());
    expect(propagate).toHaveBeenCalledOnce();
  });

  it('uses only the explicitly marked long-lived model SSN for a future mission and exposes the temporal limitation', async () => {
    const propagate = vi.fn(async (value) => {
      expect(value.ssn).toBe(100);
      return propagation;
    });
    const generate = vi.fn((value) => {
      expect(value.missionEvidence.limitations).toContain('Propagation modeling uses a long-lived smoothed monthly SSN model input; mission-window space-weather forecasting is not included in Slice 1.');
      return brief;
    });
    const result = await service({
      spaceWeather: {
        getSnapshot: vi.fn(async () => ({
          modelSsn: { value: 100, state: 'live', modelInput: { semanticBasis: 'noaa_smoothed_monthly_ssn', validity: 'long_lived_model_input' } },
          products: { ssn: { value: 240, state: 'live' } },
        })),
      } as any,
      propagate,
      generate,
    }).generateBrief(request({ missionWindow: { start: '2035-08-18T12:00:00Z', end: '2035-08-18T14:00:00Z' } }));
    expect(result).toMatchObject({ kind: 'smartdeploy_generation' });
    expect(propagate).toHaveBeenCalledWith(expect.objectContaining({ ssn: 100 }));
  });

  it('does not treat an unmarked live value as an approved future model input', async () => {
    const propagate = vi.fn(async (value) => { expect(value.ssn).toBeNaN(); return propagation; });
    await service({ spaceWeather: { getSnapshot: vi.fn(async () => ({ modelSsn: { value: 240, state: 'live' }, products: { ssn: { value: 240, state: 'live' } } })) } as any, propagate }).generateBrief(request({ missionWindow: { start: '2035-08-18T12:00:00Z', end: '2035-08-18T14:00:00Z' } }));
    expect(propagate).toHaveBeenCalledOnce();
  });
});

describe('SmartDeploy retained-brief routes', () => {
  it('lists, gets, and deletes retained briefs without invoking generation', async () => {
    const list = vi.fn(() => ({ status: 'loaded', briefs: [brief], diagnostics: [] }));
    const get = vi.fn((id: string) => id === 'brief-1' ? { status: 'found', brief, diagnostics: [] } : { status: 'notFound', diagnostics: [] });
    const deleteBrief = vi.fn((id: string) => id === 'brief-1' ? { status: 'deleted', brief, diagnostics: [] } : { status: 'notFound', diagnostics: [] });
    const store = { list, get, delete: deleteBrief } as any;
    const app = express();
    app.use(createSmartDeployRouter({ service: { generateBrief: vi.fn() } as any, store }));
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    try {
      expect((await fetch(`${baseUrl}/api/smartdeploy/briefs`)).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/smartdeploy/briefs/brief-1`)).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/smartdeploy/briefs/unknown`)).status).toBe(404);
      expect((await fetch(`${baseUrl}/api/smartdeploy/briefs/brief-1`, { method: 'DELETE' })).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/smartdeploy/briefs/unknown`, { method: 'DELETE' })).status).toBe(404);
      expect(list).toHaveBeenCalledOnce();
      expect(get).toHaveBeenCalledWith('brief-1');
      expect(deleteBrief).toHaveBeenCalledWith('brief-1');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});