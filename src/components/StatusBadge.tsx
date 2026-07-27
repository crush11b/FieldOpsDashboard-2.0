import { Activity, AlertTriangle, Clock, Database, LoaderCircle } from 'lucide-react';
import type { TelemetryStatus } from '../telemetry';

export interface StatusBadgeProps {
  status: TelemetryStatus;
  className?: string;
}

const STATUS_LABELS: Record<TelemetryStatus, string> = {
  connecting: 'Connecting',
  ok: 'Live',
  degraded: 'Degraded',
  cached: 'Cached',
  stale: 'Stale',
  unavailable: 'Unavailable',
  error: 'Error',
};

const getStatusIcon = (status: TelemetryStatus) => {
  if (status === 'connecting') return LoaderCircle;
  if (status === 'cached') return Database;
  if (status === 'stale') return Clock;
  if (status === 'degraded' || status === 'unavailable' || status === 'error') return AlertTriangle;
  return Activity;
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const label = STATUS_LABELS[status];
  const StatusIcon = getStatusIcon(status);

  return (
    <div
      role="status"
      aria-label={`Telemetry status: ${label}`}
      className={`min-h-8 px-2.5 py-1 rounded-lg border border-current/25 bg-black/10 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${className}`}
    >
      <StatusIcon
        aria-hidden="true"
        className={`w-3.5 h-3.5 ${status === 'connecting' ? 'animate-spin motion-reduce:animate-none' : ''}`}
      />
      <span>{label}</span>
    </div>
  );
}
