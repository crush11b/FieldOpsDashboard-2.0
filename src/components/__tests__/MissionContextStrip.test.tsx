/** @vitest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MissionContextStrip } from '../MissionContextStrip';

const brief = {
  schemaVersion: 2,
  briefId: 'brief-context',
  activation: { program: 'POTA', reference: 'US-1234', displayName: 'Test Park' },
  plannedOperatingSite: { location: { coordinates: { lat: 37.4, lon: -77.4 }, gridSquare: 'FM17' }, description: 'Operator planned site' },
  missionWindow: { start: '2026-09-20T12:00:00.000Z', end: '2026-09-20T16:00:00.000Z' },
  station: { radio: { name: 'IC-705' }, antenna: { type: 'EFHW' }, selectedModes: ['SSB'], transmitPowerWatts: 10 },
  loadoutSnapshot: { loadoutId: 'loadout-1', loadoutName: 'Portable', capturedAtUtc: '2026-09-16T00:00:00.000Z', items: [{}, {}] },
} as any;

const activation = {
  activationId: 'activation-1',
  briefId: 'brief-context',
  type: 'POTA',
  reference: 'US-1234',
  status: 'active',
  startedAtUtc: '2026-09-20T12:05:00.000Z',
  missionWindow: { start: '2026-09-20T13:00:00.000Z', end: '2026-09-20T17:00:00.000Z' },
  plannedLocation: { latitude: 38, longitude: -78, gridSquare: 'FM18' },
  operatingObjective: { goal: 'secure_activation', label: 'Qualify POTA' },
} as any;

describe('MissionContextStrip', () => {
  it('keeps the same retained mission facts visible through every workflow phase', () => {
    const { rerender } = render(<MissionContextStrip brief={brief} activation={activation} phase="plan" qsoCount={3} />);
    for (const phase of ['plan', 'prepare', 'operate', 'review'] as const) {
      rerender(<MissionContextStrip brief={brief} activation={activation} phase={phase} qsoCount={3} />);
      const context = screen.getByRole('region', { name: 'Mission and operation context' });
      expect(context).toHaveTextContent(`${phase} · operation context`);
      expect(context).toHaveTextContent('FM17');
      expect(context).toHaveTextContent('IC-705 · EFHW · 10 W');
      expect(context).toHaveTextContent('Portable · 2 items');
      expect(context).toHaveTextContent('Qualify POTA');
    }
  });

  it('discloses copied Activation drift while retaining the brief values', () => {
    render(<MissionContextStrip brief={brief} activation={activation} phase="operate" qsoCount={3} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Activation mission-window copy differs from the retained plan');
    expect(screen.getByRole('alert')).toHaveTextContent('Activation planned-location copy differs from the retained plan');
    expect(screen.queryByText('FM18')).toBeNull();
  });
});
