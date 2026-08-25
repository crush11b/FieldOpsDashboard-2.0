import { describe, expect, it } from 'vitest';
import { getDashboardRuntimeMode } from '../runtimeMode';

describe('Dashboard runtime mode', () => {
  it('defaults a built server without NODE_ENV to production', () => {
    expect(getDashboardRuntimeMode(undefined)).toBe('production');
    expect(getDashboardRuntimeMode('')).toBe('production');
  });

  it('selects Vite development mode only when explicitly requested', () => {
    expect(getDashboardRuntimeMode('development')).toBe('development');
    expect(getDashboardRuntimeMode('production')).toBe('production');
  });
});