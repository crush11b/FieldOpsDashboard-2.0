// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryEnvelope } from '../../telemetry';
import {
  createErrorEnvelope,
  createLiveEnvelope,
  createRetainedEnvelope,
  createTelemetrySource,
  createTelemetryTimestamps,
  createUnavailableEnvelope,
  TEST_NOW,
} from '../../test/telemetryFactory';
import { TelemetryCard } from '../TelemetryCard';

describe('TelemetryCard lifecycle presentation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('presents live, cached, stale, then unavailable without fabricating a value', () => {
    const live = createLiveEnvelope({ value: 0 });
    const { rerender } = renderCard(live);

    expect(screen.getByRole('status')).toHaveTextContent('Live');
    expect(screen.getByText('Reading: 0')).toBeVisible();

    rerender(card(createRetainedEnvelope('cached', { value: 0 })));
    expect(screen.getByRole('status')).toHaveTextContent('Cached');
    expect(screen.getByText('Reading: 0')).toBeVisible();

    rerender(card(createRetainedEnvelope('stale', { value: 0 })));
    expect(screen.getByRole('status')).toHaveTextContent('Stale');
    expect(screen.getByText('Reading: 0')).toBeVisible();

    rerender(card(createUnavailableEnvelope()));
    expect(screen.getByRole('status')).toHaveTextContent('Unavailable');
    expect(screen.getByLabelText('Unavailable')).toHaveTextContent('—');
    expect(screen.queryByText(/Reading:/)).not.toBeInTheDocument();
  });

  it('shows a structured validation failure while retaining the last payload', () => {
    renderCard(createErrorEnvelope(
      { code: 'VALIDATION_FAILED', message: 'Coordinate payload is invalid', retryable: false },
      { value: 0 },
    ));

    expect(screen.getByRole('status')).toHaveTextContent('Error');
    expect(screen.getByRole('alert')).toHaveTextContent('Coordinate payload is invalid');
    expect(screen.getByText('Reading: 0')).toBeVisible();
  });

  it.each([
    ['Manual Location', 'manual_location'],
    ['Modeled Propagation', 'modeled_propagation'],
  ])('keeps degraded lifecycle status separate from %s provenance', (name, type) => {
    renderCard(createLiveEnvelope(
      { value: 0 },
      { status: 'degraded', source: createTelemetrySource({ name, type }) },
    ));

    expect(screen.getByRole('status')).toHaveTextContent('Degraded');
    expect(screen.getByText(name)).toBeVisible();
  });

  it('shows source-name precedence and deterministic observed age', () => {
    renderCard(createLiveEnvelope(
      { value: 0 },
      {
        source: createTelemetrySource({ name: 'Current Browser GPS', type: 'browser_geolocation' }),
        timestamps: createTelemetryTimestamps({
          observedAt: new Date(TEST_NOW.getTime() - 60_000).toISOString(),
        }),
      },
    ));

    expect(screen.getByText('Current Browser GPS')).toBeVisible();
    expect(screen.queryByText('browser_geolocation')).not.toBeInTheDocument();
    expect(screen.getByText('1m ago')).toBeVisible();
  });
});

interface TestPayload {
  readonly value: number;
}

function renderCard(envelope: TelemetryEnvelope<TestPayload>) {
  return render(card(envelope));
}

function card(envelope: TelemetryEnvelope<TestPayload>) {
  return (
    <TelemetryCard envelope={envelope} title="Test Telemetry">
      {(data) => <span>Reading: {data.value}</span>}
    </TelemetryCard>
  );
}
