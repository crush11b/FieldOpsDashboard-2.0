import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverSource = readFileSync(fileURLToPath(new URL('../../server.ts', import.meta.url)), 'utf8');

describe('legacy installer removal', () => {
  it('contains no active installer routes or script-generation contract', () => {
    for (const route of ['/install.ps1', '/install.sh', '/install_mac.sh', '/api/apps/install-script']) {
      expect(serverSource).not.toContain(route);
    }

    for (const marker of ['auto_install_ham_apps', 'APP_PACKAGES', 'scriptContent', 'copyCommand', 'directWinUrl']) {
      expect(serverSource).not.toContain(marker);
    }
  });
});