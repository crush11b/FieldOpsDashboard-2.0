import { describe, expect, it } from 'vitest';
import { INITIAL_CONFIG } from '../data/defaultConfig';
import { isUsableDashboardConfig } from '../dashboardConfigValidation';

describe('Dashboard bootstrap configuration validation', () => {
  it('accepts the complete product configuration', () => {
    expect(isUsableDashboardConfig(INITIAL_CONFIG)).toBe(true);
  });

  for (const section of ['propagation', 'apps'] as const) {
    it(`rejects missing ${section}`, () => {
      const value = { ...INITIAL_CONFIG, [section]: undefined };
      expect(isUsableDashboardConfig(value)).toBe(false);
    });
  }

  it('rejects malformed nested station profile sections', () => {
    for (const section of ['stationProfile', 'antenna', 'deployment'] as const) {
      const value = structuredClone(INITIAL_CONFIG);
      if (section === 'stationProfile') value.propagation = { ...value.propagation, stationProfile: undefined as never };
      if (section === 'antenna') value.propagation = { ...value.propagation, stationProfile: { ...value.propagation.stationProfile, antenna: undefined as never } };
      if (section === 'deployment') value.propagation = { ...value.propagation, stationProfile: { ...value.propagation.stationProfile, deployment: undefined as never } };
      expect(isUsableDashboardConfig(value)).toBe(false);
    }
  });

  it('rejects malformed application fields and grid values', () => {
    const invalidApp = { ...INITIAL_CONFIG, apps: [{ ...INITIAL_CONFIG.apps[0], name: undefined }] };
    expect(isUsableDashboardConfig(invalidApp)).toBe(false);
    expect(isUsableDashboardConfig({ ...INITIAL_CONFIG, appGridColumns: 5 })).toBe(false);
  });
});