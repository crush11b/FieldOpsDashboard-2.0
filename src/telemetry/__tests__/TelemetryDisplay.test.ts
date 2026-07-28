import { describe, expect, it } from 'vitest';
import {
  getTelemetrySourceLabel,
  TELEMETRY_UNAVAILABLE_LABEL,
  TELEMETRY_UNAVAILABLE_VALUE,
} from '../TelemetryDisplay';

describe('telemetry display utilities', () => {
  it('prefers the operator-facing source name', () => {
    expect(getTelemetrySourceLabel({ name: 'ToughBook GNSS', type: 'local_telemetry_agent' }))
      .toBe('ToughBook GNSS');
  });

  it('falls back to source type when source name is missing', () => {
    expect(getTelemetrySourceLabel({ type: 'local_telemetry_agent' }))
      .toBe('local_telemetry_agent');
  });

  it('provides the canonical unavailable presentation', () => {
    expect(TELEMETRY_UNAVAILABLE_VALUE).toBe('—');
    expect(TELEMETRY_UNAVAILABLE_LABEL).toBe('Unavailable');
  });
});
