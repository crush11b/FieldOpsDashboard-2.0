import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppLauncherGrid } from '../AppLauncherGrid';
import { HeaderBar } from '../HeaderBar';
import { RoadmapToolsModal } from '../RoadmapToolsModal';
import { TouchMenuDrawer } from '../TouchMenuDrawer';
import { BatteryStatusWidget } from '../BatteryStatusWidget';
import type { AppLauncherItem, DualBatteryStatus, GPSStatus } from '../../types';

describe('misleading action guardrails', () => {
  it('marks automatic installation unavailable with native disabled semantics', () => {
    const markup = renderToStaticMarkup(
      <AppLauncherGrid
        apps={[app]}
        theme="dark_tactical"
        audioEnabled={false}
        gridColumns={3}
        onToggleFavorite={vi.fn()}
        onEditApp={vi.fn()}
        onAddNewApp={vi.fn()}
      />,
    );

    expect(markup).toMatch(/id="btn-auto-installer-suite"[^>]*disabled/);
    expect(markup).toContain('AUTO-INSTALL UNAVAILABLE');
    expect(markup).toContain('future privileged local service');
    expect(markup).not.toContain('PROCESS DISPATCHED');
  });

  it('renders network switching as unavailable rather than actionable status', () => {
    const markup = renderToStaticMarkup(
      <HeaderBar
        callsign="N0CALL"
        theme="dark_tactical"
        onThemeChange={vi.fn()}
        gps={gps}
        battery={battery}
        audioEnabled={false}
        onToggleAudio={vi.fn()}
        onOpenConfig={vi.fn()}
        onOpenRoadmap={vi.fn()}
        onToggleTouchMenu={vi.fn()}
        touchMenuOpen={false}
      />,
    );

    expect(markup).toMatch(/id="btn-header-network-toggle"[^>]*disabled/);
    expect(markup).toContain('STATUS UNAVAILABLE');
    expect(markup).toContain('aria-describedby="network-control-unavailable"');
  });

  it('prevents keyboard activation of SOS and placeholder frequency guidance', () => {
    const markup = renderToStaticMarkup(
      <TouchMenuDrawer
        isOpen
        onClose={vi.fn()}
        theme="dark_tactical"
        audioEnabled={false}
        onThemeChange={vi.fn()}
        onOpenConfig={vi.fn()}
        onOpenRoadmap={vi.fn()}
        callsign="N0CALL"
        gridSquare=""
      />,
    );

    expect(markup).toMatch(/id="btn-emergency-sos"[^>]*disabled/);
    expect(markup).toMatch(/id="drawer-btn-smart-freq"[^>]*disabled/);
    expect(markup).toContain('No emergency transmitter or mesh gateway is configured');
    expect(markup).not.toContain('Broadcast alert sent');
  });

  it('disables SmartFrequency and does not preload fabricated contacts', () => {
    const markup = renderToStaticMarkup(
      <RoadmapToolsModal
        theme="dark_tactical"
        audioEnabled={false}
        isOpen
        onClose={vi.fn()}
        callsign="N0CALL"
        gridSquare=""
        initialTab="smart_frequency"
      />,
    );

    expect(markup).toMatch(/id="tab-smart-frequency"[^>]*disabled/);
    expect(markup).toContain('FIELD ANTENNA CUTTING');
    expect(markup).not.toContain('K7POTA');
    expect(markup).not.toContain('W6SOTA');
  });

  it('does not simulate hardware attachment from the disconnected battery card', () => {
    const markup = renderToStaticMarkup(
      <BatteryStatusWidget battery={battery} theme="dark_tactical" onUpdateBattery={vi.fn()} />,
    );

    expect(markup).toMatch(/<button[^>]*disabled[^>]*aria-label="Dock coupling unavailable; hardware detection is required"/);
    expect(markup).toContain('HARDWARE DETECTION REQUIRED');
    expect(markup).not.toContain('+ COUPLE DOCK');
  });
});

const app: AppLauncherItem = {
  id: 'test-app',
  name: 'Test App',
  category: 'utilities',
  iconName: 'Terminal',
  executablePath: 'C:\\Tools\\test.exe',
  description: 'Configured test application',
  installed: true,
  favorite: false,
};

const gps: GPSStatus = {
  lat: Number.NaN,
  lon: Number.NaN,
  altitudeM: 0,
  speedKmh: 0,
  gridSquare: '',
  satCount: 0,
  fixType: 'Searching',
  lockTime: '',
  mode: 'auto',
  deviceName: 'GPS Receiver',
};

const battery: DualBatteryStatus = {
  mainTablet: { percent: 0, charging: false, voltage: 0, health: 'Fair', tempC: 0, timeRemainingMins: 0 },
  keyboardDock: { percent: 0, charging: false, voltage: 0, health: 'Fair', tempC: 0, timeRemainingMins: 0, attached: false },
  powerSource: 'Battery',
};
