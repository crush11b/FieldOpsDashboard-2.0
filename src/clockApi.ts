import type { ClockSynchronizationEvidence, GnssTimeEvidence } from '../server/locationTelemetryPipe';

export const getClockStatus = async (signal?: AbortSignal): Promise<ClockSynchronizationEvidence> => {
  const response = await fetch('/api/clock/status', { signal });
  if (!response.ok) throw new Error(`Clock status request failed (${response.status}).`);
  return response.json() as Promise<ClockSynchronizationEvidence>;
};

export const getGnssTime = async (signal?: AbortSignal): Promise<GnssTimeEvidence> => {
  const response = await fetch('/api/clock/gnss', { signal });
  if (!response.ok) throw new Error(`GNSS time request failed (${response.status}).`);
  return response.json() as Promise<GnssTimeEvidence>;
};

export const synchronizeClock = async (confirmed: boolean, signal?: AbortSignal): Promise<ClockSynchronizationEvidence> => {
  const response = await fetch('/api/clock/synchronize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed }), signal });
  if (!response.ok) throw new Error(`Clock synchronization request failed (${response.status}).`);
  return response.json() as Promise<ClockSynchronizationEvidence>;
};