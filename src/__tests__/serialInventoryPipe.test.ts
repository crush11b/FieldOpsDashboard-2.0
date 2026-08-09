import { describe, expect, it } from 'vitest';
import { parseSerialInventoryFrame, SERIAL_INVENTORY_MAX_FRAME } from '../../server/serialInventoryPipe';

const frame = (value: string) => { const body = Buffer.from(value); const output = Buffer.alloc(body.length + 4); output.writeInt32LE(body.length); body.copy(output, 4); return output; };

describe('serial inventory pipe framing', () => {
  it('accepts valid and zero-port responses', () => expect(parseSerialInventoryFrame(frame(JSON.stringify({ observedAtUtc: 'now', status: 'Ok', ports: [], error: null }))).ports).toEqual([]));
  it('rejects negative, zero, oversized, incomplete, trailing, malformed, and invalid shapes', () => {
    for (const length of [-1, 0, SERIAL_INVENTORY_MAX_FRAME + 1]) { const bytes = Buffer.alloc(4); bytes.writeInt32LE(length); expect(parseSerialInventoryFrame(bytes).status).toBe('Error'); }
    expect(parseSerialInventoryFrame(Buffer.from([1, 0, 0, 0])) .status).toBe('Error');
    expect(parseSerialInventoryFrame(Buffer.concat([frame('{}'), Buffer.from([1])])).status).toBe('Error');
    expect(parseSerialInventoryFrame(frame('{bad')).status).toBe('Error');
    expect(parseSerialInventoryFrame(frame(JSON.stringify({ observedAtUtc: 'now', status: 'Bogus', ports: [], error: null }))).status).toBe('Error');
  });
});
