// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppLauncherGrid } from '../AppLauncherGrid';
import { INITIAL_CONFIG } from '../../data/defaultConfig';
import { APP_CATALOG_CATEGORIES } from '../../appCatalog/domain';
import type { AppDiscoveryObservation } from '../../appCatalog/discovery';

const records = INITIAL_CONFIG.appCatalog.records.map(record => ({ ...record, enabled: record.id !== INITIAL_CONFIG.appCatalog.records[0].id }));

describe('catalog launcher grid', () => {
  it.each(['dark_tactical', 'sunlight', 'night_vision'] as const)('applies semantic theme ownership for %s', theme => {
    const { container } = render(<AppLauncherGrid apps={[records[1]]} theme={theme} audioEnabled={false} gridColumns={3} onToggleFavorite={vi.fn()} onEditApp={vi.fn()} onAddNewApp={vi.fn()} launchStates={{}} onLaunchApp={vi.fn()} />);
    expect(container.firstElementChild).toHaveAttribute('data-theme', theme);
    expect(container.querySelector('.fo-surface')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ALL APPS' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows all seven categories and distinguishes disabled from unconfigured', () => {
    render(<AppLauncherGrid apps={records} theme="dark_tactical" audioEnabled={false} gridColumns={3} onToggleFavorite={vi.fn()} onEditApp={vi.fn()} onAddNewApp={vi.fn()} launchStates={{}} onLaunchApp={vi.fn()} />);
    for (const category of APP_CATALOG_CATEGORIES) expect(screen.getByRole('button', { name: category === 'POTA/SOTA' ? category : category.toUpperCase() })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'EXPAND ALL' }));
    expect(screen.getByRole('button', { name: /DIGITAL COMMS.*CLICK TO COLLAPSE/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('DISABLED')).toBeInTheDocument();
    expect(screen.getAllByText('CONFIGURED').length).toBeGreaterThan(0);
  });

  it('does not style unknown runtime evidence as success and keeps touch actions at least 44px high', () => {
    const wsjtx = { ...INITIAL_CONFIG.appCatalog.records.find(record => record.id === 'wsjtx')!, enabled: true };
    const { container } = render(<AppLauncherGrid apps={[wsjtx]} theme="sunlight" audioEnabled={false} gridColumns={3} onToggleFavorite={vi.fn()} onEditApp={vi.fn()} onAddNewApp={vi.fn()} launchStates={{}} onLaunchApp={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'EXPAND ALL' }));
    const runtime = screen.getByText('UNKNOWN', { selector: '.fo-status-neutral' });
    expect(runtime).not.toHaveClass('fo-status-success');
    expect(container.querySelector('#btn-launch-wsjtx')).toHaveClass('min-h-11');
    expect(container.querySelector('#btn-edit-wsjtx')).toHaveClass('min-h-11', 'min-w-11');
  });

  it('does not launch disabled records', () => {
    const onLaunchApp = vi.fn();
    const disabled = { ...records[0], enabled: false };
    render(<AppLauncherGrid apps={[disabled]} theme="dark_tactical" audioEnabled={false} gridColumns={3} onToggleFavorite={vi.fn()} onEditApp={vi.fn()} onAddNewApp={vi.fn()} launchStates={{}} onLaunchApp={onLaunchApp} />);
    fireEvent.click(screen.getByRole('button', { name: 'EXPAND ALL' }));
    const launch = screen.getByRole('button', { name: 'UNAVAILABLE' });
    expect(launch).toBeDisabled();
    fireEvent.click(launch);
    expect(onLaunchApp).not.toHaveBeenCalled();
  });

  it('disables editing protected records', () => {
    const protectedRecord = { ...records[0], policy: { editable: false, disableable: false, deletable: false, restorable: false } };
    render(<AppLauncherGrid apps={[protectedRecord]} theme="dark_tactical" audioEnabled={false} gridColumns={3} onToggleFavorite={vi.fn()} onEditApp={vi.fn()} onAddNewApp={vi.fn()} launchStates={{}} onLaunchApp={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'EXPAND ALL' }));
    expect(screen.getByTitle('This record is protected from editing')).toBeDisabled();
  });

  it('labels capabilities and evidence separately and keeps absent runtime evidence unknown', () => {
    const wsjtx = { ...INITIAL_CONFIG.appCatalog.records.find(record => record.id === 'wsjtx')!, enabled: true };
    const observation = {
      id: 'wsjtx', declaredCapabilities: [], configured: 'yes', enabled: 'yes', detected: 'yes', installed: 'unknown', available: 'yes', launch: 'unknown',
      evidenceSource: 'configured_path', reason: 'found', observedAtUtc: '2026-09-11T00:00:00.000Z', dependencyStates: [],
      fieldOpsEvidence: { kind: 'read-only-evidence', label: 'READ-ONLY EVIDENCE', description: 'Read-only evidence.' },
    } as AppDiscoveryObservation;
    render(<AppLauncherGrid apps={[wsjtx]} theme="dark_tactical" audioEnabled={false} gridColumns={3} onToggleFavorite={vi.fn()} onEditApp={vi.fn()} onAddNewApp={vi.fn()} launchStates={{}} onLaunchApp={vi.fn()} runtimeObservations={{ wsjtx: observation }} />);
    fireEvent.click(screen.getByRole('button', { name: 'EXPAND ALL' }));
    expect(screen.getByText('DECLARED APP CAPABILITIES')).toBeInTheDocument();
    expect(screen.getByText('Digital operation')).toBeInTheDocument();
    expect(screen.getByText('READ-ONLY EVIDENCE')).toBeInTheDocument();
    expect(screen.getByText('RUNTIME STATUS')).toBeInTheDocument();
    expect(screen.getByText('YES')).toBeInTheDocument();
  });
});
