import { describe, expect, it } from 'vitest';
import { ensureTerminalPeriod } from '../formatUtc';

describe('ensureTerminalPeriod', () => {
  it.each([
    ['Text.', 'Text.'],
    ['Text..', 'Text.'],
    ['Text?', 'Text?'],
    ['Text!!', 'Text!'],
    ['Text', 'Text.'],
  ])('normalizes %s to %s', (value, expected) => {
    expect(ensureTerminalPeriod(value)).toBe(expected);
  });
});
