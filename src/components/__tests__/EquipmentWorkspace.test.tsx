/* @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EquipmentWorkspace } from '../EquipmentWorkspace';

afterEach(() => vi.unstubAllGlobals());
function response(body: unknown) { return Promise.resolve({ ok: true, json: async () => body } as Response); }
describe('EquipmentWorkspace', () => {
  it('loads absent local stores without fabricated inventory and saves operator-entered equipment', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ equipment: [] }))
      .mockImplementationOnce(() => response({ loadouts: [] }))
      .mockImplementationOnce(() => response({ status: 'succeeded' }))
      .mockImplementationOnce(() => response({ equipment: [] }))
      .mockImplementationOnce(() => response({ loadouts: [] }));
    vi.stubGlobal('fetch', fetcher);
    render(<EquipmentWorkspace />);
    await screen.findByText('No equipment or loadouts have been entered.');
    fireEvent.change(screen.getByLabelText('Equipment label'), { target: { value: 'IC-705' } });
    fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Icom' } });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE EQUIPMENT' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/equipment', expect.objectContaining({ method: 'POST' })));
    const payload = JSON.parse(fetcher.mock.calls[2][1].body);
    expect(payload).toMatchObject({ kind: 'radio', label: 'IC-705', manufacturer: 'Icom', facts: [], limitations: [] });
  });

  it('uses plain-language, equipment-specific specifications and supplies the unit', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ equipment: [] }))
      .mockImplementationOnce(() => response({ loadouts: [] }))
      .mockImplementationOnce(() => response({ status: 'succeeded' }))
      .mockImplementationOnce(() => response({ equipment: [] }))
      .mockImplementationOnce(() => response({ loadouts: [] }));
    vi.stubGlobal('fetch', fetcher);
    render(<EquipmentWorkspace />);
    await screen.findByText('No equipment or loadouts have been entered.');
    expect(screen.queryByLabelText('Fact key')).not.toBeInTheDocument();
    expect(screen.getByText(/Add only values you know/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Equipment label'), { target: { value: 'IC-705' } });
    fireEvent.change(screen.getByLabelText('Specification'), { target: { value: 'max_output_power_watts' } });
    fireEvent.change(screen.getByLabelText('Specification value'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'ADD SPECIFICATION' }));
    expect(screen.getByText(/Maximum output power:/)).toBeInTheDocument();
    expect(screen.getByText(/Requires an external tuner on 30 m/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'SAVE EQUIPMENT' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/equipment', expect.objectContaining({ method: 'POST' })));
    expect(JSON.parse(fetcher.mock.calls[2][1].body).facts).toEqual([{ key: 'max_output_power_watts', value: 10, unit: 'W', source: 'operator_entered' }]);
  });

  it('offers only active equipment for new loadouts and discloses readiness limitations', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/equipment' ? response({ equipment: [
      { schemaVersion: 1, equipmentId: 'active-radio', kind: 'radio', label: 'Active Radio', facts: [], limitations: [], state: 'active', createdAtUtc: '2026-09-15T18:00:00.000Z', updatedAtUtc: '2026-09-15T18:00:00.000Z' },
      { schemaVersion: 1, equipmentId: 'deleted-radio', kind: 'radio', label: 'Deleted Radio', facts: [], limitations: [], state: 'deleted', createdAtUtc: '2026-09-15T18:00:00.000Z', updatedAtUtc: '2026-09-15T18:00:00.000Z', deletedAtUtc: '2026-09-15T18:00:00.000Z' },
    ] }) : response({ loadouts: [] })));
    render(<EquipmentWorkspace />);
    await screen.findByText('Active Radio');
    expect(screen.queryByText('Deleted Radio')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'SHOW DELETED (1)' }));
    expect(screen.getByText('Deleted Radio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RESTORE' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'HIDE DELETED' }));
    expect(screen.queryByText('Deleted Radio')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /LOADOUTS/ }));
    expect(screen.getByRole('option', { name: 'Active Radio' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Deleted Radio' })).not.toBeInTheDocument();
    expect(screen.getByText(/not proof that equipment is packed/)).toBeInTheDocument();
  });
});
