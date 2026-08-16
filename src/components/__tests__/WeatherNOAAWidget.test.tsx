/* @vitest-environment jsdom */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WeatherNOAAWidget } from '../WeatherNOAAWidget';

const audioMocks = vi.hoisted(() => ({
  speakNOAAAlert: vi.fn(),
  speakNOAAAlertFull: vi.fn(),
  cancelSpeech: vi.fn(),
  playTacticalClick: vi.fn(),
  playEmergencyBeep: vi.fn(),
}));

vi.mock('../../utils/audio', () => audioMocks);

const alertOne = {
  id: 'alert-1', severity: 'Severe' as const, title: 'Wind Warning', description: 'Secure equipment.',
  area: 'Field Area', expires: '2026-08-16T10:00:00Z', issued: '2026-08-16T09:00:00Z',
};
const alertTwo = { ...alertOne, id: 'alert-2', title: 'Flood Warning' };

async function flushEffects() {
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  audioMocks.speakNOAAAlert.mockClear();
  audioMocks.speakNOAAAlertFull.mockClear();
  audioMocks.cancelSpeech.mockClear();
  localStorage.clear();
});

describe('WeatherNOAAWidget truth states', () => {
  it('shows unavailable weather without plausible measurements', () => {
    const markup = renderToStaticMarkup(
      <WeatherNOAAWidget
        weather={null}
        weatherStatus="unavailable"
        alerts={[]}
        alertsStatus="live"
        theme="dark_tactical"
        audioEnabled={false}
      />,
    );

    expect(markup).toContain('Weather unavailable');
    expect(markup).not.toContain('78');
    expect(markup).toContain('NOAA ALERTS (0)');
  });

  it('does not describe an unavailable NOAA check as all clear', () => {
    const markup = renderToStaticMarkup(
      <WeatherNOAAWidget
        weather={null}
        weatherStatus="loading"
        alerts={null}
        alertsStatus="unavailable"
        theme="dark_tactical"
        audioEnabled={false}
      />,
    );

    expect(markup).toContain('NOAA UNAVAILABLE');
    expect(markup).not.toContain('ALL CLEAR');
  });

  it('fails closed when a live NOAA status has no alert payload', () => {
    const markup = renderToStaticMarkup(
      <WeatherNOAAWidget
        weather={null}
        weatherStatus="unavailable"
        alerts={null}
        alertsStatus="live"
        theme="dark_tactical"
        audioEnabled={false}
      />,
    );

    expect(markup).toContain('NOAA UNAVAILABLE');
    expect(markup).not.toContain('NOAA ALERTS (0)');
  });
});

describe('WeatherNOAAWidget alert speech behavior', () => {
  const props = {
    weather: null,
    weatherStatus: 'live' as const,
    alertsStatus: 'live' as const,
    theme: 'dark_tactical' as const,
    audioEnabled: true,
  };

  it('announces each new unacknowledged ID once and suppresses acknowledged IDs', async () => {
    const view = render(<WeatherNOAAWidget {...props} alerts={[alertOne]} />);
    await flushEffects();
    expect(audioMocks.speakNOAAAlert).toHaveBeenCalledTimes(1);

    view.rerender(<WeatherNOAAWidget {...props} alerts={[{ ...alertOne }]} />);
    await flushEffects();
    expect(audioMocks.speakNOAAAlert).toHaveBeenCalledTimes(1);

    view.rerender(<WeatherNOAAWidget {...props} alerts={[alertOne, alertTwo]} />);
    await flushEffects();
    expect(audioMocks.speakNOAAAlert).toHaveBeenCalledTimes(2);

    view.unmount();
    localStorage.setItem('fieldops_ack_alerts', JSON.stringify(['alert-1']));
    render(<WeatherNOAAWidget {...props} alerts={[alertOne]} />);
    await flushEffects();
    expect(audioMocks.speakNOAAAlert).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('ACK cancels speech and persists IDs while explicit speak remains available', async () => {
    const view = render(<WeatherNOAAWidget {...props} alerts={[alertOne]} />);
    await flushEffects();
    fireEvent.click(screen.getByRole('button', { name: /ACK \/ SILENCE VOICE/i }));
    expect(audioMocks.cancelSpeech).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('fieldops_ack_alerts') ?? '[]')).toEqual(['alert-1']);

    fireEvent.click(screen.getByRole('button', { name: /NOAA ALERTS/i }));
    fireEvent.click(screen.getByRole('button', { name: /SPEAK TYPE ONLY/i }));
    expect(audioMocks.speakNOAAAlert).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});
