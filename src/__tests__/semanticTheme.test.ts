import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');

const requiredTokens = [
  'canvas',
  'surface-1',
  'surface-2',
  'surface-raised',
  'text-primary',
  'text-secondary',
  'text-muted',
  'border-subtle',
  'border',
  'border-strong',
  'action-primary',
  'action-primary-hover',
  'action-secondary',
  'action-secondary-hover',
  'focus',
  'selected',
  'disabled',
  'success',
  'caution',
  'danger',
  'info',
  'evidence-live',
  'evidence-cached',
  'evidence-modeled',
  'evidence-manual',
  'evidence-observed',
  'evidence-unknown',
] as const;

function themeBlock(theme: 'dark_tactical' | 'sunlight' | 'night_vision'): string {
  const match = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing semantic theme block: ${theme}`);
  return match[1];
}

describe('V3 semantic theme contract', () => {
  it.each(['dark_tactical', 'sunlight', 'night_vision'] as const)('%s defines every required semantic role', theme => {
    const block = themeBlock(theme);
    for (const token of requiredTokens) expect(block).toContain(`--fo-${token}:`);
  });

  it('keeps theme meanings explicit at the application boundary', () => {
    expect(css).toContain('[data-theme="dark_tactical"]');
    expect(css).toContain('[data-theme="sunlight"]');
    expect(css).toContain('[data-theme="night_vision"]');
    expect(css).toContain('.fo-app-shell { background: var(--fo-canvas); color: var(--fo-text-primary); }');
  });
});
