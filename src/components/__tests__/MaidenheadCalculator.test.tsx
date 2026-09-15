/* @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MaidenheadCalculator } from '../MaidenheadCalculator';
import type { OperatingLocation } from '../../location/operatingLocation';

const operatingLocation: OperatingLocation = {
  coordinates: { lat: 37.40787458, lon: -77.45903828 },
  gridSquare: 'FM17gj',
  provenance: 'current',
  status: 'ok',
  source: { id: 'gps:test', type: 'serial_nmea', name: 'Test GNSS' },
};

describe('Maidenhead calculator', () => {
  it('calculates all supported locator precisions without mutating its operating-location input', () => {
    const original = structuredClone(operatingLocation);
    render(<MaidenheadCalculator operatingLocation={operatingLocation} />);

    fireEvent.change(screen.getByLabelText('Maidenhead latitude'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Maidenhead longitude'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'CALCULATE LOCATORS' }));

    expect(screen.getByText('JJ00')).toBeInTheDocument();
    expect(screen.getByText('JJ00aa')).toBeInTheDocument();
    expect(screen.getByText('JJ00aa00')).toBeInTheDocument();
    expect(operatingLocation).toEqual(original);
  });

  it('normalizes a locator, identifies its center, and reports distance from the operating location', () => {
    render(<MaidenheadCalculator operatingLocation={operatingLocation} />);

    fireEvent.change(screen.getByLabelText('Maidenhead locator'), { target: { value: ' jj00AA00 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'CALCULATE CENTER' }));

    expect(screen.getByText('REPRESENTATIVE CELL CENTER')).toBeInTheDocument();
    expect(screen.getByText(/0\.002083°, 0\.004167°/)).toBeInTheDocument();
    expect(screen.getByText(/mi \/ .*km/)).toBeInTheDocument();
  });

  it('truthfully rejects invalid input and handles unavailable operating location', () => {
    render(<MaidenheadCalculator operatingLocation={{ ...operatingLocation, coordinates: null, gridSquare: null, provenance: 'unavailable' }} />);

    fireEvent.change(screen.getByLabelText('Maidenhead locator'), { target: { value: 'not-a-grid' } });
    fireEvent.click(screen.getByRole('button', { name: 'CALCULATE CENTER' }));
    expect(screen.getByRole('status')).toHaveTextContent('ENTER A VALID 4-, 6-, OR 8-CHARACTER');

    fireEvent.change(screen.getByLabelText('Maidenhead latitude'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Maidenhead longitude'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'CALCULATE LOCATORS' }));
    expect(screen.getByText('Unavailable: no valid operating location.')).toBeInTheDocument();
  });

  it('copies calculated values when the clipboard is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<MaidenheadCalculator operatingLocation={operatingLocation} />);
    fireEvent.change(screen.getByLabelText('Maidenhead latitude'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Maidenhead longitude'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'CALCULATE LOCATORS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy JJ00aa' }));
    expect(writeText).toHaveBeenCalledWith('JJ00aa');
  });
});
