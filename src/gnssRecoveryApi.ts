import type { GnssRecoveryResult, GnssSerialDiagnostics } from '../server/locationTelemetryPipe';

export const recoverGnss = async (signal?: AbortSignal): Promise<GnssRecoveryResult> => {
  const response = await fetch('/api/location/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal });
  if (!response.ok) throw new Error(`GNSS recovery request failed (${response.status}).`);
  return response.json() as Promise<GnssRecoveryResult>;
};

export const configureNmea = async (port: string, baud: number, signal?: AbortSignal): Promise<GnssSerialDiagnostics> => {
  const response = await fetch('/api/location/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port, baud }), signal });
  if (!response.ok) throw new Error(`GNSS configuration request failed (${response.status}).`);
  const diagnostics = await response.json() as GnssSerialDiagnostics;
  if (diagnostics.transportStatus === 'unavailable') throw new Error('The FieldOps Agent could not apply the GNSS configuration. The previous configuration remains active.');
  return diagnostics;
};