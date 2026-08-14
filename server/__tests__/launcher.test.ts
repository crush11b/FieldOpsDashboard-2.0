import { describe, expect, it } from 'vitest';
import { isAbsoluteLocalExePath, isPermittedHttpUri, resolveConfiguredLaunch } from '../launcher';
import type { AppLauncherItem } from '../../src/types';

const app = (overrides: Partial<AppLauncherItem> = {}): AppLauncherItem => ({
  id: 'radio-tool',
  name: 'Radio Tool',
  category: 'utilities',
  iconName: 'Radio',
  executablePath: 'C:\\Radio\\tool.exe',
  description: 'Test application',
  installed: false,
  favorite: false,
  ...overrides,
});

describe('Dashboard launcher trust boundary', () => {
  it('resolves only the configured app ID, never a browser target', () => {
    expect(resolveConfiguredLaunch([app()], 'radio-tool')).toEqual({
      LaunchType: 1,
      Target: 'C:\\Radio\\tool.exe',
    });
    expect(resolveConfiguredLaunch([app()], 'C:\\Users\\attacker\\evil.exe')).toMatchObject({ status: 'InvalidRequest' });
  });

  it('rejects duplicate IDs instead of guessing', () => {
    expect(resolveConfiguredLaunch([app(), app({ name: 'Other' })], 'radio-tool')).toMatchObject({
      status: 'InvalidRequest',
    });
  });

  it('allows only HTTP and HTTPS configured URIs', () => {
    expect(isPermittedHttpUri('https://field.example/app')).toBe(true);
    expect(isPermittedHttpUri('file:///Windows/System32/calc.exe')).toBe(false);
    expect(resolveConfiguredLaunch([app({ uri: 'powershell://evil' })], 'radio-tool')).toMatchObject({ status: 'InvalidRequest' });
  });

  it('requires an absolute local executable ending in exe', () => {
    expect(isAbsoluteLocalExePath('C:\\Radio\\tool.exe')).toBe(true);
    expect(isAbsoluteLocalExePath('\\\\server\\share\\tool.exe')).toBe(false);
    expect(isAbsoluteLocalExePath('C:\\Radio\\tool.bat')).toBe(false);
  });
});