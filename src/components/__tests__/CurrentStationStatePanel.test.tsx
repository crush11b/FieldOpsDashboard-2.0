/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CurrentStationStatePanel } from '../CurrentStationStatePanel';
import type { CurrentStationState } from '../../currentStationState';

const activation = { status: 'active' } as any;
const state: CurrentStationState = { band: '20m', frequencyMHz: 14.074, mode: 'FT8', source: 'manual', operatorUpdatedAtUtc: '2026-08-27T12:00:00.000Z', freshness: 'operator_set', status: 'available', limitation: 'Operator-entered operating context; not radio, CAT, WSJT-X, or RF confirmation.' };

describe('CurrentStationStatePanel', () => {
  it('presents manual current station context without claiming hardware truth', () => {
    render(<CurrentStationStatePanel activation={activation} state={state} />);
    expect(screen.getByText('20m · FT8')).toBeInTheDocument();
    expect(screen.getByText('14.074 MHz')).toBeInTheDocument();
    expect(screen.getByText(/Source: Manual operating context · Status: Current/)).toBeInTheDocument();
    expect(screen.getByText(/not radio, CAT, WSJT-X, or RF confirmation/)).toBeInTheDocument();
  });

  it('states honestly when frequency or current state is unavailable', () => {
    render(<CurrentStationStatePanel activation={activation} state={{ ...state, frequencyMHz: null }} />);
    expect(screen.getByText('Frequency not set')).toBeInTheDocument();
    const view = render(<CurrentStationStatePanel activation={{ status: 'completed' } as any} state={state} />);
    expect(view.getByText('Current station state unavailable.')).toBeInTheDocument();
  });
});