import { describe, expect, it, vi } from 'vitest';
import { configureNmea } from '../gnssRecoveryApi';

describe('GNSS configuration API', () => {
  it('sends COM7 and 115200 as ConfigureNmea request data', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ portName: 'COM7', baudRate: 115200, state: 'Opening', transportStatus: 'available' }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);

    await expect(configureNmea('COM7', 115200)).resolves.toMatchObject({ portName: 'COM7', baudRate: 115200 });
    expect(fetcher).toHaveBeenCalledWith('/api/location/configure', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ port: 'COM7', baud: 115200 }),
    }));
    vi.unstubAllGlobals();
  });

  it('rejects unavailable Agent responses so the last valid configuration is retained', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ portName: 'COM8', baudRate: 115200, state: 'Stopped', transportStatus: 'unavailable' }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);

    await expect(configureNmea('COM8', 115200)).rejects.toThrow('previous configuration remains active');
    vi.unstubAllGlobals();
  });
});
