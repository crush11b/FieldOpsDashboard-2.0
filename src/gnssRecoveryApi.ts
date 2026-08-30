import type { GnssRecoveryResult } from '../server/locationTelemetryPipe';

export const recoverGnss = async (signal?: AbortSignal): Promise<GnssRecoveryResult> => {
  const response = await fetch('/api/location/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal });
  if (!response.ok) throw new Error(`GNSS recovery request failed (${response.status}).`);
  return response.json() as Promise<GnssRecoveryResult>;
};