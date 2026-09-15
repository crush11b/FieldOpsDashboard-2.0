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
  'accent-text',
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

function token(block: string, name: string): string {
  const match = block.match(new RegExp(`--fo-${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!match) throw new Error(`Missing hexadecimal token: ${name}`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)?.map(value => Number.parseInt(value, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error(`Invalid color: ${hex}`);
  const [red, green, blue] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
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

  it.each(['dark_tactical', 'sunlight', 'night_vision'] as const)('%s meets AA contrast for semantic text and status roles', theme => {
    const block = themeBlock(theme);
    const surface = token(block, 'surface-1');
    for (const foreground of ['text-primary', 'text-secondary', 'text-muted', 'success', 'caution', 'danger', 'info']) {
      expect(contrast(token(block, foreground), surface), `${theme} ${foreground}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const action of ['action-primary', 'action-primary-hover']) {
      expect(contrast(token(block, action), '#fffaf2'), `${theme} ${action}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
