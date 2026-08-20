import { describe, expect, it } from 'vitest';
import { normalizeActivationTargetRequest } from '../activationTargetResolver';

describe('activation target request boundary', () => {
  it('normalizes provider and reference without selecting a provider', () => {
    expect(normalizeActivationTargetRequest({ program: ' sota ', reference: ' W4V/SH-001 ' })).toEqual({ program: 'SOTA', reference: 'W4V/SH-001' });
  });

  it.each([null, undefined, {}, { program: 'SOTA' }, { reference: 'W4V/SH-001' }, { program: 'SOTA', reference: ' ' }])('rejects incomplete target requests: %j', input => {
    expect(normalizeActivationTargetRequest(input)).toBeNull();
  });
});