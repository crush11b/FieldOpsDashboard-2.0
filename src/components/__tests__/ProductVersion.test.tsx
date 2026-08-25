import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HeaderBar } from '../HeaderBar';

describe('product version presentation', () => {
  it('renders the centralized display version in the existing header badge', () => {
    const markup = renderToStaticMarkup(
      <HeaderBar
        callsign="N0CALL"
        theme="dark_tactical"
        onThemeChange={() => undefined}
        gps={{
          lat: 0,
          lon: 0,
          altitudeM: 0,
          speedKmh: 0,
          gridSquare: 'JJ00aa',
          satCount: 0,
          fixType: 'No Fix',
          lockTime: '',
          mode: 'manual',
          deviceName: 'Manual Location',
        }}
        battery={{
          mainTablet: { percent: 0, charging: false, voltage: 0, health: 'Fair', tempC: 0, timeRemainingMins: 0 },
          keyboardDock: { percent: 0, charging: false, voltage: 0, health: 'Fair', tempC: 0, timeRemainingMins: 0, attached: false },
          powerSource: 'Unavailable',
        }}
        audioEnabled={false}
        onToggleAudio={() => undefined}
        onOpenConfig={() => undefined}
        onOpenRoadmap={() => undefined}
        onToggleTouchMenu={() => undefined}
        touchMenuOpen={false}
      />,
    );

    expect(markup).toContain('Version 2.5.0');
    expect(markup).not.toContain('v2.1');
  });
});
