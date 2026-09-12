// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfigModal } from '../ConfigModal';
import { INITIAL_CONFIG } from '../../data/defaultConfig';
import type { DashboardConfig } from '../../types';

const catalog = INITIAL_CONFIG.appCatalog;
const nativeRecord = catalog.records.find(record => record.target.kind === 'native')!;
const webRecord = { ...nativeRecord, id: 'web-test', name: 'Web Test', category: 'Web Apps' as const, target: { kind: 'web' as const, url: 'https://example.test' } };

const renderModal = (editingApp = nativeRecord, config: DashboardConfig = { ...INITIAL_CONFIG, appCatalog: { ...catalog, records: [nativeRecord, webRecord] } }) => {
  const onSaveConfig = vi.fn(async (updated: DashboardConfig) => updated);
  const view = render(<ConfigModal config={config} theme={config.theme} audioEnabled={false} isOpen onClose={vi.fn()} onSaveConfig={onSaveConfig} onResetToDefaults={vi.fn()} editingApp={editingApp} initialTab="apps" />);
  return { ...view, onSaveConfig };
};

describe('catalog management modal', () => {
  it('opens Settings on General and Add on a clean Apps Manager form', async () => {
    const { rerender } = render(<ConfigModal config={INITIAL_CONFIG} theme={INITIAL_CONFIG.theme} audioEnabled={false} isOpen onClose={vi.fn()} onSaveConfig={vi.fn(async updated => updated)} onResetToDefaults={vi.fn()} initialTab="general" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'GENERAL & OPERATOR' })).toHaveClass('border-amber-400'));
    rerender(<ConfigModal config={INITIAL_CONFIG} theme={INITIAL_CONFIG.theme} audioEnabled={false} isOpen onClose={vi.fn()} onSaveConfig={vi.fn(async updated => updated)} onResetToDefaults={vi.fn()} initialTab="apps" />);
    await waitFor(() => expect(screen.getByText('ADD APP')).toBeInTheDocument());
    expect(document.getElementById('input-app-form-name')).toHaveValue('');
  });

  it('refreshes modal state for each record and preserves native fields', async () => {
    const { rerender } = renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'APPS MANAGER (2)' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByDisplayValue(nativeRecord.target.kind === 'native' ? nativeRecord.target.executablePath : '')).toBeInTheDocument());

    rerender(<ConfigModal config={{ ...INITIAL_CONFIG, appCatalog: { ...catalog, records: [nativeRecord, webRecord] } }} theme={INITIAL_CONFIG.theme} audioEnabled={false} isOpen onClose={vi.fn()} onSaveConfig={vi.fn(async updated => updated)} onResetToDefaults={vi.fn()} editingApp={webRecord} initialTab="apps" />);
    await waitFor(() => expect(screen.getByDisplayValue('https://example.test')).toBeInTheDocument());
    expect(screen.queryByDisplayValue(nativeRecord.target.kind === 'native' ? nativeRecord.target.executablePath : '')).not.toBeInTheDocument();
  });

  it('edits a web record using the web target and persists the returned catalog', async () => {
    const { onSaveConfig } = renderModal(webRecord);
    await waitFor(() => expect(screen.getByDisplayValue('https://example.test')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('https://example.test'), { target: { value: 'https://changed.example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE APP ITEM' }));
    await waitFor(() => expect(onSaveConfig).toHaveBeenCalled());
    const saved = onSaveConfig.mock.calls.at(-1)?.[0] as DashboardConfig;
    expect(saved.appCatalog.records.find(record => record.id === webRecord.id)?.target).toEqual({ kind: 'web', url: 'https://changed.example.test' });
  });

  it('preserves native arguments and working directory through UI persistence', async () => {
    const record = { ...nativeRecord, target: { kind: 'native' as const, executablePath: 'C:\\Field\\tool.exe', args: '--grid FN31', workingDir: 'C:\\Field' } };
    const onSaveConfig = vi.fn(async (updated: DashboardConfig) => updated);
    render(<ConfigModal config={{ ...INITIAL_CONFIG, appCatalog: { ...catalog, records: [record] } }} theme={INITIAL_CONFIG.theme} audioEnabled={false} isOpen onClose={vi.fn()} onSaveConfig={onSaveConfig} onResetToDefaults={vi.fn()} editingApp={record} initialTab="apps" />);
    await waitFor(() => expect(screen.getByDisplayValue('--grid FN31')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'SAVE APP ITEM' }));
    await waitFor(() => expect(onSaveConfig).toHaveBeenCalled());
    const saved = onSaveConfig.mock.calls.at(-1)?.[0] as DashboardConfig;
    expect(saved.appCatalog.records[0].target).toEqual(record.target);
  });

  it('rejects invalid targets before persistence', async () => {
    const onSaveConfig = vi.fn(async () => null);
    render(<ConfigModal config={INITIAL_CONFIG} theme={INITIAL_CONFIG.theme} audioEnabled={false} isOpen onClose={vi.fn()} onSaveConfig={onSaveConfig} onResetToDefaults={vi.fn()} initialTab="apps" />);
    await waitFor(() => expect(screen.getByText('ADD APP')).toBeInTheDocument());
    fireEvent.change(document.getElementById('input-app-form-name')!, { target: { value: 'Invalid Web' } });
    fireEvent.change(document.getElementById('input-app-form-executable-path')!, { target: { value: 'relative.exe' } });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE APP ITEM' }));
    expect(onSaveConfig).not.toHaveBeenCalled();
  });

  it('keeps the previous catalog visible when persistence fails', async () => {
    const onSaveConfig = vi.fn(async () => null);
    render(<ConfigModal config={{ ...INITIAL_CONFIG, appCatalog: { ...catalog, records: [webRecord] } }} theme={INITIAL_CONFIG.theme} audioEnabled={false} isOpen onClose={vi.fn()} onSaveConfig={onSaveConfig} onResetToDefaults={vi.fn()} editingApp={webRecord} initialTab="apps" />);
    await waitFor(() => expect(screen.getByDisplayValue('https://example.test')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'SAVE APP ITEM' }));
    await waitFor(() => expect(onSaveConfig).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Catalog could not be saved. The previous catalog remains active.')).toBeInTheDocument());
    expect(screen.getByDisplayValue('https://example.test')).toBeInTheDocument();
  });

  it('shows invalid catalog JSON inline', async () => {
    render(<ConfigModal config={INITIAL_CONFIG} theme={INITIAL_CONFIG.theme} audioEnabled={false} isOpen onClose={vi.fn()} onSaveConfig={vi.fn(async updated => updated)} onResetToDefaults={vi.fn()} initialTab="json_editor" />);
    await screen.findByText('APP CATALOG JSON');
    const editor = document.getElementById('textarea-json-editor')!;
    fireEvent.change(editor, { target: { value: '{"records":[]}' } });
    fireEvent.click(screen.getByRole('button', { name: 'APPLY JSON CHANGES' }));
    await waitFor(() => expect(screen.getAllByText(/JSON must be an App Catalog object with records/).length).toBeGreaterThan(0));
  });
});
