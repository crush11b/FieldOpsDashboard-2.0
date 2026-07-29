import { describe, expect, it } from 'vitest';
import { createAdifExport } from '../adif';

describe('ADIF release metadata', () => {
  it('uses canonical program identity, version, and calculated field lengths', () => {
    const output = createAdifExport([]);

    expect(output).toContain('ADIF Export from FieldOps Dashboard Version 2.2.0');
    expect(output).toContain('<PROGRAMID:17>FieldOpsDashboard');
    expect(output).toContain('<PROGRAMVERSION:5>2.2.0');
    expect(output).not.toContain('v1.1.4');
  });

  it('does not fabricate contacts for an empty log', () => {
    expect(createAdifExport([])).not.toContain('<CALL:');
  });
});
