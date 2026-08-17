import { describe, expect, it } from 'vitest';
import {
  ANTENNA_OPTIONS,
  DEFAULT_STATION_PROFILE,
  getAntennaOptions,
  getDeploymentOptionsForAntenna,
  getHeightOptionsForDeployment,
  getModeOptions,
  getPowerPresetOptions,
  normalizeStationProfile,
} from '../stationProfileCatalog';
import { isValidStationProfile } from '../domain';

describe('Slice 5B station profile catalog', () => {
  it('exposes the exact mode catalog and labels', () => {
    expect(getModeOptions()).toEqual([
      { id: 'SSB', label: 'SSB' }, { id: 'CW', label: 'CW' }, { id: 'FT8', label: 'FT8' },
      { id: 'FT4', label: 'FT4' }, { id: 'JS8', label: 'JS8' }, { id: 'RTTY', label: 'RTTY' },
    ]);
  });

  it('exposes exact power presets without treating custom as wattage', () => {
    expect(getPowerPresetOptions()).toEqual([
      { id: '5w', label: '5 W', watts: 5 }, { id: '10w', label: '10 W', watts: 10 },
      { id: '20w', label: '20 W', watts: 20 }, { id: '50w', label: '50 W', watts: 50 },
      { id: '100w', label: '100 W', watts: 100 }, { id: 'custom', label: 'Custom', watts: null },
    ]);
    expect(isValidStationProfile({ ...DEFAULT_STATION_PROFILE, transmitPowerWatts: 37 })).toBe(true);
  });

  it('exposes the exact antenna catalog and operator labels', () => {
    expect(getAntennaOptions()).toEqual([
      { id: 'EFHW', label: 'EFHW' }, { id: 'EFRW', label: 'EFRW' }, { id: 'dipole', label: 'Dipole' },
      { id: 'vertical', label: 'Vertical' }, { id: 'loaded_vertical', label: 'Hamstick / Loaded Vertical' },
      { id: 'portable_whip', label: 'Portable Whip' }, { id: 'beam', label: 'Beam / Directional' },
      { id: 'unknown_random_wire', label: 'Random Wire / Unknown' }, { id: 'custom', label: 'Custom' },
    ]);
    expect(ANTENNA_OPTIONS).toHaveLength(9);
  });

  it('filters deployment options by antenna type', () => {
    expect(getDeploymentOptionsForAntenna('EFHW').map(option => option.id)).toEqual(['inverted_v', 'sloper', 'vertical', 'horizontal']);
    expect(getDeploymentOptionsForAntenna('dipole').map(option => option.id)).toEqual(['inverted_v', 'horizontal']);
    expect(getDeploymentOptionsForAntenna('beam').map(option => option.id)).toEqual(['directional']);
    expect(getDeploymentOptionsForAntenna('custom').map(option => option.id)).toEqual(['other']);
  });

  it('uses field-facing height ranges and does not ask for wire height when it is meaningless', () => {
    expect(getHeightOptionsForDeployment('inverted_v').map(option => option.id)).toEqual(['under_15_ft', '15_to_30_ft', 'over_30_ft', 'unknown']);
    expect(getHeightOptionsForDeployment('vertical').map(option => option.id)).toEqual(['not_applicable']);
    expect(getHeightOptionsForDeployment('directional').map(option => option.id)).toEqual(['not_applicable']);
  });

  it('defines the valid conservative default profile', () => {
    expect(DEFAULT_STATION_PROFILE).toEqual({
      mode: 'SSB', transmitPowerWatts: 10, antenna: { type: 'EFHW' },
      deployment: { geometry: 'inverted_v', heightCategory: '15_to_30_ft' },
    });
    expect(isValidStationProfile(DEFAULT_STATION_PROFILE)).toBe(true);
  });

  it('normalizes each invalid profile field independently and preserves valid custom power', () => {
    expect(normalizeStationProfile({ mode: 'VARA', transmitPowerWatts: -1, antenna: { type: 'nope' }, deployment: { geometry: 'nope', heightCategory: 'nope' } })).toEqual(DEFAULT_STATION_PROFILE);
    expect(normalizeStationProfile({ mode: 'FT8', transmitPowerWatts: 37, antenna: { type: 'vertical' }, deployment: { geometry: 'horizontal', heightCategory: 'over_30_ft' } })).toEqual({
      mode: 'FT8', transmitPowerWatts: 37, antenna: { type: 'vertical' }, deployment: { geometry: 'vertical', heightCategory: 'not_applicable' },
    });
    expect(normalizeStationProfile({ mode: 'CW', transmitPowerWatts: '20', antenna: { type: 'beam' }, deployment: { geometry: 'vertical', heightCategory: 'under_15_ft' } })).toEqual({
      mode: 'CW', transmitPowerWatts: 10, antenna: { type: 'beam' }, deployment: { geometry: 'directional', heightCategory: 'not_applicable' },
    });
  });

  it('accepts the documented compatible combinations', () => {
    const profiles = [
      { antenna: { type: 'EFRW' }, deployment: { geometry: 'sloper' } },
      { antenna: { type: 'EFRW' }, deployment: { geometry: 'vertical' } },
      { antenna: { type: 'dipole' }, deployment: { geometry: 'horizontal' } },
      { antenna: { type: 'vertical' }, deployment: { geometry: 'vertical' } },
      { antenna: { type: 'loaded_vertical' }, deployment: { geometry: 'vertical' } },
      { antenna: { type: 'portable_whip' }, deployment: { geometry: 'vertical' } },
      { antenna: { type: 'beam' }, deployment: { geometry: 'directional' } },
      { antenna: { type: 'custom' }, deployment: { geometry: 'other' } },
    ];
    for (const partial of profiles) expect(isValidStationProfile(normalizeStationProfile(partial))).toBe(true);
  });
});