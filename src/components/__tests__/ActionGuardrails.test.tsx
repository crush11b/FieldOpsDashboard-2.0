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
  it('keeps the always-mounted header free of continuous compositing effects', () => {
    const markup = renderToStaticMarkup(
      <HeaderBar
        callsign="N0CALL"
        theme="dark_tactical"
        onThemeChange={vi.fn()}
        gps={gps}
        battery={battery}
        systemTelemetry={null}
        audioEnabled={false}
        onToggleAudio={vi.fn()}
        onOpenConfig={vi.fn()}
        onOpenRoadmap={vi.fn()}
        onToggleTouchMenu={vi.fn()}
        touchMenuOpen={false}
      />,
    );

    expect(markup).not.toContain('backdrop-blur-md');
    expect(markup).not.toContain('animate-pulse');
    expect(markup).not.toContain('animate-spin-slow');
  });

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
        systemTelemetry={null}
        audioEnabled={false}
        onToggleAudio={vi.fn()}
        onOpenConfig={vi.fn()}
        onOpenRoadmap={vi.fn()}
        onToggleTouchMenu={vi.fn()}
        touchMenuOpen={false}
      />,
    );

    expect(markup).toContain('id="header-network-status"');
    expect(markup).toContain('aria-label="Network status: Unavailable"');
    expect(markup).toContain('Unavailable');
    expect(markup).not.toContain('btn-header-network-toggle');
  });

  it('prevents keyboard activation of SOS and keeps removed prototypes out of the touch menu', () => {
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
    expect(markup).toContain('No emergency transmitter or mesh gateway is configured');
    expect(markup).toContain('Activation planning workspace');
    expect(markup).not.toContain('SmartFrequency');
    expect(markup).not.toContain('SmartLog+');
    expect(markup).not.toContain('AI Radio Advisor');
    expect(markup).not.toContain('Broadcast alert sent');
  });

  it('keeps SmartDeploy separate from the general antenna calculator', () => {
    const markup = renderToStaticMarkup(
      <RoadmapToolsModal
        theme="dark_tactical"
        audioEnabled={false}
        isOpen
        onClose={vi.fn()}
        callsign="N0CALL"
        gridSquare=""
        gps={gps}
        gpsProvenance={{ status: 'connecting', source: { id: 'gps:test', type: 'gps_acquisition' } }}
        initialTab="smart_deploy"
      />,
    );

    expect(markup).toContain('SMARTDEPLOY');
    expect(markup).not.toContain('ANTENNA LENGTH CALCULATOR');
    expect(markup).toContain('GENERATE SMARTDEPLOY PLAN');
    expect(markup).not.toContain('SmartFrequency');
    expect(markup).not.toContain('SmartLog+');
    expect(markup).not.toContain('POTA SPOTTER');
    expect(markup).not.toContain('AI Field Radio Advisor');
    expect(markup).not.toContain('K7POTA');
    expect(markup).not.toContain('W6SOTA');

    const calculatorMarkup = renderToStaticMarkup(
      <RoadmapToolsModal
        theme="dark_tactical"
        audioEnabled={false}
        isOpen
        onClose={vi.fn()}
        callsign="N0CALL"
        gridSquare=""
        gps={gps}
        gpsProvenance={{ status: 'connecting', source: { id: 'gps:test', type: 'gps_acquisition' } }}
        initialTab="antenna_calculator"
      />,
    );
    expect(calculatorMarkup).toContain('ANTENNA LENGTH CALCULATOR');
    expect(calculatorMarkup).toContain('31.59 FT (9.63 METERS)');
    expect(calculatorMarkup).toContain('15.80 FT (4.81 METERS)');
  });

  it('does not simulate hardware attachment from the disconnected battery card', () => {
    const markup = renderToStaticMarkup(
      <BatteryStatusWidget battery={battery} theme="dark_tactical" onUpdateBattery={vi.fn()} />,
    );

    expect(markup).toMatch(/<button[^>]*disabled[^>]*aria-label="Dock coupling unavailable; hardware detection is required"/);
    expect(markup).toContain('HARDWARE DETECTION REQUIRED');
    expect(markup).not.toContain('+ COUPLE DOCK');
  });

  it('renders a real low battery percentage as low', () => {
    const markup = renderToStaticMarkup(<BatteryStatusWidget battery={{ ...battery, mainTablet: { ...battery.mainTablet, percent: 15 } }} theme="dark_tactical" />);
    expect(markup).toContain('15%');
    expect(markup).toContain('bg-red-500');
  });

  it('preserves zero percent as a valid low battery value', () => {
    const markup = renderToStaticMarkup(<BatteryStatusWidget battery={{ ...battery, mainTablet: { ...battery.mainTablet, percent: 0 } }} theme="dark_tactical" />);
    expect(markup).toContain('0%');
    expect(markup).toContain('bg-red-500');
  });

  it('renders null percentage as unavailable without low-battery styling', () => {
    const markup = renderToStaticMarkup(<BatteryStatusWidget battery={{ ...battery, mainTablet: { ...battery.mainTablet, percent: null } }} theme="dark_tactical" />);
    expect(markup).toContain('UNAVAILABLE');
    expect(markup).not.toContain('bg-red-500');
  });

  it('renders physical battery values independently', () => {
    const markup = renderToStaticMarkup(<BatteryStatusWidget battery={{ ...battery, mainTablet: { ...battery.mainTablet, percent: 100 }, keyboardDock: { ...battery.keyboardDock, percent: 89, attached: true } }} theme="dark_tactical" />);
    expect(markup).toContain('100%');
    expect(markup).toContain('89%');
  });

  it('renders a detached second battery as uncoupled without stale percentage', () => {
    const markup = renderToStaticMarkup(<BatteryStatusWidget battery={{ ...battery, keyboardDock: { ...battery.keyboardDock, percent: null, attached: false } }} theme="dark_tactical" />);
    expect(markup).toContain('UNCOUPLED');
    expect(markup).not.toContain('94%');
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
