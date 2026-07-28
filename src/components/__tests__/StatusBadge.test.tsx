import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TELEMETRY_STATUSES, type TelemetryStatus } from '../../telemetry';
import { StatusBadge } from '../StatusBadge';

const labels: Record<TelemetryStatus, string> = {
  connecting: 'Connecting',
  ok: 'Live',
  degraded: 'Degraded',
  stale: 'Stale',
  cached: 'Cached',
  unavailable: 'Unavailable',
  error: 'Error',
};

describe('StatusBadge', () => {
  it.each(TELEMETRY_STATUSES)('renders canonical %s status with visible and accessible meaning', (status) => {
    const markup = renderToStaticMarkup(<StatusBadge status={status} />);
    const label = labels[status];

    expect(markup).toContain('role="status"');
    expect(markup).toContain(`aria-label="Telemetry status: ${label}"`);
    expect(markup).toContain(`>${label}</span>`);
    expect(markup).toContain('<svg');
  });

  it('respects reduced-motion preferences for connecting animation', () => {
    const markup = renderToStaticMarkup(<StatusBadge status="connecting" />);

    expect(markup).toContain('animate-spin');
    expect(markup).toContain('motion-reduce:animate-none');
  });

  it('does not animate non-connecting statuses', () => {
    const markup = renderToStaticMarkup(<StatusBadge status="ok" />);

    expect(markup).not.toContain('animate-spin');
  });
});
