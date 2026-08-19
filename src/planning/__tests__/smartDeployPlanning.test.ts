import { describe, expect, it } from 'vitest';
import { resolveOperatingLocation } from '../../location/operatingLocation';
import { normalizeSmartDeployPlanningRequest, resolvePlannedOperatingLocation, SMART_DEPLOY_MAX_MISSION_DURATION_MS, validateSmartDeployPlanningRequest, type SmartDeployPlanningRequest } from '../smartDeployPlanning';

const source = { id: 'pota:test', type: 'pota_catalog', name: 'POTA catalog' };
const location = resolveOperatingLocation(
  { lat: 37.4, lon: -77.4, gridSquare: '' },
  { status: 'ok', source: { id: 'gps:test', type: 'serial_nmea', name: 'Test GNSS' } },
);
const baseRequest = {
  activationTarget: {
    program: 'POTA', reference: 'US-1234', displayName: 'Test Park', coordinates: { lat: 38, lon: -78 }, gridSquare: 'FM18aa',
    provenance: { kind: 'externally_resolved' as const, source, resolvedAtUtc: '2026-08-18T12:00:00-04:00' },
  },
  plannedOperatingLocation: location,
  currentDeviceLocation: { ...location, coordinates: { lat: 38.1, lon: -78.1 }, gridSquare: 'FM18' },
  propagationObjective: { kind: 'regional' as const, regionId: 'western_europe' as const },
  missionWindow: { start: '2026-08-18T12:00:00Z', end: '2026-08-18T18:00:00Z' },
  equipment: {
    radio: { name: 'Field Radio' }, antenna: { type: 'EFHW' as const }, modes: ['SSB', 'FT8'] as const, transmitPowerWatts: 10,
    deployment: { geometry: 'inverted_v' as const, heightCategory: '15_to_30_ft' as const },
  },
  objective: 'Complete the activation',
} satisfies SmartDeployPlanningRequest;

function validate(overrides: Record<string, unknown> = {}) {
  return validateSmartDeployPlanningRequest({ ...baseRequest, ...overrides });
}

describe('SmartDeploy Slice 1 planning contract', () => {
  it('accepts a POTA-shaped target and normalizes strings and offset timestamps to UTC', () => {
    const result = normalizeSmartDeployPlanningRequest({ ...baseRequest, objective: '  Complete the activation  ' });
    expect(result.valid).toBe(true);
    expect(result.request?.activationTarget.provenance.resolvedAtUtc).toBe('2026-08-18T16:00:00.000Z');
    expect(result.request?.objective).toBe('Complete the activation');
  });

  it('does not structurally restrict a non-POTA provider', () => {
    expect(validate({ activationTarget: { ...baseRequest.activationTarget, program: 'SOTA' } }).valid).toBe(true);
  });

  it('requires a usable planned operating location and preserves no fabricated defaults', () => {
    expect(validate({ plannedOperatingLocation: { ...location, coordinates: null, provenance: 'unavailable' } }).issues.map(issue => issue.code)).toContain('invalid_coordinates');
    const result = normalizeSmartDeployPlanningRequest({ ...baseRequest, activationTarget: { ...baseRequest.activationTarget, gridSquare: undefined, displayName: undefined } });
    expect(result.request?.activationTarget.gridSquare).toBeUndefined();
    expect(result.request?.activationTarget.displayName).toBeUndefined();
  });

  it('accepts same-day, midnight-crossing, and exactly twelve-hour windows', () => {
    expect(validate().valid).toBe(true);
    expect(validate({ missionWindow: { start: '2026-08-18T23:00:00Z', end: '2026-08-19T05:00:00Z' } }).valid).toBe(true);
    expect(validate({ missionWindow: { start: '2026-08-18T06:00:00Z', end: new Date(Date.parse('2026-08-18T06:00:00Z') + SMART_DEPLOY_MAX_MISSION_DURATION_MS).toISOString() } }).valid).toBe(true);
  });

  it('rejects invalid, equal, reversed, and overlong windows', () => {
    expect(validate({ missionWindow: { start: 'not-a-date', end: '2026-08-18T18:00:00Z' } }).issues).toContainEqual(expect.objectContaining({ path: 'missionWindow.start', code: 'invalid_timestamp' }));
    expect(validate({ missionWindow: { start: '2026-08-18T12:00:00Z', end: '2026-08-18T12:00:00Z' } }).valid).toBe(false);
    expect(validate({ missionWindow: { start: '2026-08-18T18:00:00Z', end: '2026-08-18T12:00:00Z' } }).valid).toBe(false);
    expect(validate({ missionWindow: { start: '2026-08-18T00:00:00Z', end: '2026-08-18T12:01:00Z' } }).issues).toContainEqual(expect.objectContaining({ code: 'duration_exceeded' }));
  });

  it('accepts multiple modes and deterministically removes duplicate modes', () => {
    const result = normalizeSmartDeployPlanningRequest({ ...baseRequest, equipment: { ...baseRequest.equipment, modes: [' SSB ', 'SSB', 'FT8'] } });
    expect(result.valid).toBe(true);
    expect(result.request?.equipment.modes).toEqual(['SSB', 'FT8']);
    const deduplicated = normalizeSmartDeployPlanningRequest({ ...baseRequest, equipment: { ...baseRequest.equipment, modes: ['SSB', 'SSB', 'FT8'] } });
    expect(deduplicated.valid).toBe(true);
    expect(deduplicated.request?.equipment.modes).toEqual(['SSB', 'FT8']);
  });

  it('rejects empty modes, invalid power, and bad coordinates', () => {
    expect(validate({ equipment: { ...baseRequest.equipment, modes: [] } }).valid).toBe(false);
    for (const power of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validate({ equipment: { ...baseRequest.equipment, transmitPowerWatts: power } }).issues).toContainEqual(expect.objectContaining({ path: 'equipment.transmitPowerWatts' }));
    }
    expect(validate({ activationTarget: { ...baseRequest.activationTarget, coordinates: { lat: 91, lon: -78 } } }).issues).toContainEqual(expect.objectContaining({ code: 'invalid_coordinates' }));
  });

  it('handles optional objectives and enforces whitespace and length rules', () => {
    expect(normalizeSmartDeployPlanningRequest({ ...baseRequest, objective: '   ' }).request?.objective).toBeUndefined();
    expect(validate({ objective: 'x'.repeat(257) }).issues).toContainEqual(expect.objectContaining({ path: 'objective', code: 'too_long' }));
  });

  it('rejects malformed provenance and timestamps without network or UI dependencies', () => {
    expect(validate({ activationTarget: { ...baseRequest.activationTarget, provenance: { kind: 'unknown' } } }).issues).toContainEqual(expect.objectContaining({ path: 'activationTarget.provenance', code: 'invalid_provenance' }));
    expect(validate({ activationTarget: { ...baseRequest.activationTarget, provenance: { kind: 'externally_resolved', source, resolvedAtUtc: 'tomorrow' } } }).issues).toContainEqual(expect.objectContaining({ code: 'invalid_timestamp' }));
  });

  it('keeps planned, current, activation, propagation, and narrative objectives independent', () => {
    const request = normalizeSmartDeployPlanningRequest(baseRequest);
    expect(request.valid).toBe(true);
    expect(request.request?.plannedOperatingLocation.coordinates).not.toEqual(request.request?.currentDeviceLocation?.coordinates);
    expect(request.request?.activationTarget.coordinates).not.toEqual(request.request?.plannedOperatingLocation.coordinates);
    expect(request.request?.propagationObjective).toEqual({ kind: 'regional', regionId: 'western_europe' });
    expect(request.request?.objective).toBe('Complete the activation');
  });

  it('allows current device location to be omitted', () => {
    expect(validate({ currentDeviceLocation: undefined }).valid).toBe(true);
  });

  it('rejects missing canonical fields deterministically', () => {
    const result = validate({ plannedOperatingLocation: undefined, propagationObjective: undefined });
    expect(result.issues).toContainEqual(expect.objectContaining({ path: 'plannedOperatingLocation', code: 'required' }));
    expect(result.issues).toContainEqual(expect.objectContaining({ path: 'propagationObjective', code: 'required' }));
  });

  it('preserves coordinate, grid, and provenance values without fabrication', () => {
    const result = normalizeSmartDeployPlanningRequest(baseRequest);
    expect(result.request?.plannedOperatingLocation.gridSquare).toBe(location.gridSquare);
    expect(result.request?.plannedOperatingLocation.provenance).toBe(location.provenance);
    expect(result.request?.currentDeviceLocation?.gridSquare).toBe('FM18');
  });

  it('rejects an invalid propagation region without conflating it with the activation target', () => {
    const result = validate({ propagationObjective: { kind: 'regional', regionId: 'US-1234' } });
    expect(result.issues).toContainEqual(expect.objectContaining({ path: 'propagationObjective.regionId', code: 'invalid_value' }));
  });

  it('defaults planned operation to the activation provider reference with explicit semantics', () => {
    const result = resolvePlannedOperatingLocation(baseRequest.activationTarget, baseRequest.currentDeviceLocation);
    expect(result).toMatchObject({ status: 'resolved', location: { coordinates: baseRequest.activationTarget.coordinates, planningSemantics: 'provider_reference_default', provenance: 'manual' } });
    expect((result as any).location.gridSquare).toBe('FM18aa');
  });

  it('requires an explicit current-device selection and fails honestly when unavailable', () => {
    const selected = resolvePlannedOperatingLocation(baseRequest.activationTarget, baseRequest.currentDeviceLocation, 'current_device');
    expect(selected).toMatchObject({ status: 'resolved', location: { coordinates: baseRequest.currentDeviceLocation?.coordinates, planningSemantics: 'operator_selected_current_device' } });
    const unavailable = resolvePlannedOperatingLocation(baseRequest.activationTarget, { ...location, coordinates: null, provenance: 'unavailable' }, 'current_device');
    expect(unavailable).toEqual({ status: 'unavailable', reason: 'Current device location is unavailable.' });
  });
});