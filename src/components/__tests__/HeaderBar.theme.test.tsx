// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UIThemeMode } from '../../types';
import { HeaderBar } from '../HeaderBar';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HeaderBar semantic theme controls', () => {
  it.each([
    ['dark_tactical', 'Dark field theme'],
    ['night_vision', 'Red-light field mode'],
    ['sunlight', 'Sunlight day mode'],
  ] as const)('marks only %s as selected', (theme, selectedLabel) => {
    renderHeader(theme);

    const group = screen.getByRole('group', { name: 'Display theme' });
    expect(group).toHaveClass('fo-theme-group');
    expect(screen.getByRole('button', { name: selectedLabel })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getAllByRole('button', { pressed: false })).toHaveLength(2);
  });

  it('uses semantic controls and 44-pixel touch targets for primary header actions', () => {
    renderHeader('dark_tactical');

    expect(screen.getByRole('button', { name: 'Toggle field menu' })).toHaveClass('fo-control', 'min-h-11', 'min-w-11');
    expect(screen.getByRole('button', { name: 'Open dashboard configuration' })).toHaveClass('fo-control', 'min-h-11', 'min-w-11');
    expect(screen.getByRole('button', { name: 'Dark field theme' })).toHaveClass('fo-theme-choice', 'min-h-11', 'min-w-11');
  });
});

function renderHeader(theme: UIThemeMode) {
  return render(
    <div data-theme={theme}>
      <HeaderBar
        callsign="KQ4EVK"
        theme={theme}
        onThemeChange={() => undefined}
        gps={{ lat: 0, lon: 0, altitudeM: 0, speedKmh: 0, gridSquare: 'FM17aa', satCount: 0, fixType: 'No Fix', lockTime: '', mode: 'manual', deviceName: 'Manual Location' }}
        battery={{
          mainTablet: { percent: 90, charging: false, voltage: 12, health: 'Good', tempC: 25, timeRemainingMins: 300 },
          keyboardDock: { percent: 80, charging: false, voltage: 12, health: 'Good', tempC: 25, timeRemainingMins: 240, attached: true },
          powerSource: 'Battery',
        }}
        systemTelemetry={null}
        audioEnabled={false}
        onToggleAudio={() => undefined}
        onOpenConfig={() => undefined}
        onOpenRoadmap={() => undefined}
        onToggleTouchMenu={() => undefined}
        touchMenuOpen={false}
      />
    </div>,
  );
}
