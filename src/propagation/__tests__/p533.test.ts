import { describe, expect, it } from 'vitest';
import {
  P533_BAND_FREQUENCIES,
  P533RequestValidationError,
  createP533CircuitRequest,
  createP533Input,
  parseP533Report,
} from '../p533';
import { executeP533Circuit } from '../../../server/p533Engine';

const request = createP533CircuitRequest({
  origin: { lat: 37.408, lon: -77.4592 },
  destination: { lat: 40.4168, lon: -3.7038 },
  year: 2025,
  month: 1,
  day: 15,
  utcHour: 17,
  ssn: 120,
  band: '20m',
  mode: 'SSB',
  transmitPowerWatts: 20,
  requiredSnrDb: 15,
  bandwidthHz: 3000,
  requiredReliabilityPercent: 90,
  antenna: { model: 'ISOTROPIC', gainOffsetDb: 0 },
  noiseEnvironment: 'RESIDENTIAL',
});

describe('Slice 5D-B P.533 boundary', () => {
  it('uses the explicit canonical frequency map and rejects 6m', () => {
    expect(P533_BAND_FREQUENCIES['160m'].modelFrequencyMHz).toBe(2.0);
    expect(() => createP533CircuitRequest({ ...request, band: '6m' as never })).toThrow(P533RequestValidationError);
    expect(() => createP533CircuitRequest({ ...request, origin: { lat: 0, lon: 0 }, destination: { lat: 0, lon: 0 } })).not.toThrow();
  });

  it('builds deterministic engine input with watts converted to dBW', () => {
    expect(createP533Input(request)).toBe(createP533Input(request));
    expect(createP533Input(request)).toContain('Path.txpower 13.0');
    expect(createP533Input(request)).toContain('Path.frequency 14.100');
  });

  it('parses the official calculated-parameters columns', () => {
    const parsed = parseP533Report(`HF Model (P533) Ver 14.2\nNoise Model (P372) Ver 14.3\nColumn 01: Month\nColumn 02: Hour\nColumn 03: Frequency (MHz)\nColumn 04: BMUF - Path basic MUF (MHz)\nColumn 05: Pr - Median receiver power (dB)\nColumn 06: SNR - Median signal-to-noise ratio (dB)\nColumn 07: BCR - Basic circuit reliability (%)\n******************************** Calculated Parameters ************************\n01, 17, 14.100, 27.87, -114.53, 13.01, 36.01\n************************ End Calculated Parameters ************************`);
    expect(parsed).toMatchObject({ modelEngineVersion: '14.2', noiseModelVersion: '14.3', frequencies: [{ frequencyMHz: 14.1, basicMufMHz: 27.87, receivedPowerDb: -114.53, snrDb: 13.01, basicCircuitReliabilityPercent: 36.01 }] });
  });

  it('executes the provisioned WASM engine for the real Virginia-to-Madrid circuit', async () => {
    const execution = await executeP533Circuit(request);
    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    expect(execution.result.sourceState).toBe('modeled');
    expect(execution.result.frequency.frequencyMHz).toBe(14.1);
    expect(execution.result.reportBytes).toBeGreaterThan(1000);
    expect(execution.result.assetProvenance.runtimeNetworkRequired).toBe(false);
  }, 30_000);
});