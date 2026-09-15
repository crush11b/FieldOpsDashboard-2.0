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

const getStatusClass = (status: TelemetryStatus): string => {
  if (status === 'ok') return 'fo-text-success';
  if (status === 'connecting') return 'fo-text-info';
  if (status === 'cached' || status === 'stale' || status === 'degraded') return 'fo-text-caution';
  if (status === 'error') return 'fo-text-danger';
  return 'fo-text-muted';
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const label = STATUS_LABELS[status];
  const StatusIcon = getStatusIcon(status);

  return (
    <div
      role="status"
      aria-label={`Telemetry status: ${label}`}
      data-status={status}
      className={`fo-surface-subtle min-h-8 px-2.5 py-1 rounded-lg border inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${getStatusClass(status)} ${className}`}
    >
      <StatusIcon
        aria-hidden="true"
        className={`w-3.5 h-3.5 ${status === 'connecting' ? 'animate-spin motion-reduce:animate-none' : ''}`}
      />
      <span>{label}</span>
    </div>
  );
}
