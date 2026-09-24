/* @vitest-environment jsdom */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { INITIAL_CONFIG } from '../data/defaultConfig';
import App from '../App';

vi.mock('../components/GPSGridWidget', () => ({ GPSGridWidget: (props: { comPort?: string; baudRate?: number }) => <div data-testid="effective-gps-config">{props.comPort} @ {props.baudRate}</div> }));
vi.mock('../components/BatteryStatusWidget', () => ({ BatteryStatusWidget: () => <div /> }));
vi.mock('../components/WeatherNOAAWidget', () => ({ WeatherNOAAWidget: () => <div /> }));
vi.mock('../components/VOACAPPropagationWidget', () => ({ VOACAPPropagationWidget: () => <div /> }));
vi.mock('../components/AppLauncherGrid', () => ({ AppLauncherGrid: () => <div /> }));
vi.mock('../components/ConfigModal', () => ({ ConfigModal: () => null }));
vi.mock('../components/RoadmapToolsModal', () => ({ RoadmapToolsModal: () => null }));
vi.mock('../components/TouchMenuDrawer', () => ({ TouchMenuDrawer: () => null }));

describe('browser GPS configuration bootstrap', () => {
  it('uses effective Agent diagnostics instead of reverting to AUTO_DETECT at 9600', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return Promise.resolve(new Response(JSON.stringify({ config: { ...INITIAL_CONFIG, gpsComPort: 'AUTO_DETECT', gpsBaudRate: 9600 } }), { status: 200 }));
      if (url === '/api/location/diagnostics') return Promise.resolve(new Response(JSON.stringify({ portName: 'COM7', baudRate: 115200, transportStatus: 'available' }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    }));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('effective-gps-config')).toHaveTextContent('COM7 @ 115200'));
    vi.unstubAllGlobals();
  });
});