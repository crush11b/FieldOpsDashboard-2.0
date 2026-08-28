import { describe, expect, it } from 'vitest';
import { normalizeClockPayload } from '../locationTelemetryPipe';

describe('clock evidence payload normalization', () => {
  it('preserves Agent diagnostic fields without fabricating missing values', () => {
    const result = normalizeClockPayload({
      Status: 'Unknown', Error: 'GnssStaleOrMalformed',
      GnssTime: { Status: 'Available', RawUtcField: '123519.00', RawDateField: '230394', TemporalCoherent: false, RejectionReason: 'replayed' },
      OperationStartedAtUtc: '2026-08-28T12:00:00.000Z', OperationDurationMilliseconds: 120,
      GnssObservationReceivedAtUtc: '2026-08-28T11:59:59.900Z', EvidenceAgeMilliseconds: 100,
      ProjectedTargetUtc: '2026-08-28T12:00:00.100Z', WindowsUtcBeforeSet: '2026-08-28T12:00:32.800Z',
      WindowsUtcAfterSet: null, VerificationOffsetSeconds: null, AttemptCount: 0,
    });
    expect(result).toMatchObject({ status: 'Unknown', operationStartedAtUtc: '2026-08-28T12:00:00.000Z', operationDurationMilliseconds: 120, gnssObservationReceivedAtUtc: '2026-08-28T11:59:59.900Z', evidenceAgeMilliseconds: 100, projectedTargetUtc: '2026-08-28T12:00:00.100Z', windowsUtcBeforeSet: '2026-08-28T12:00:32.800Z', windowsUtcAfterSet: null, verificationOffsetSeconds: null, attemptCount: 0, gnssTime: { rawUtcField: '123519.00', rawDateField: '230394', temporalCoherent: false, rejectionReason: 'replayed' } });
    expect(result.offsetBeforeSynchronizationSeconds).toBeNull();
  });
});