// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RootErrorBoundary } from '../../RootErrorBoundary';

function BrokenChild() {
  throw new Error('private render detail');
}

describe('RootErrorBoundary', () => {
  it('renders a safe retry surface when a child throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<RootErrorBoundary><BrokenChild /></RootErrorBoundary>);
    expect(screen.getByText('The Dashboard could not finish loading.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    error.mockRestore();
  });

  it('renders children normally when no error occurs', () => {
    render(<RootErrorBoundary><div>Dashboard ready</div></RootErrorBoundary>);
    expect(screen.getByText('Dashboard ready')).toBeInTheDocument();
  });

});
