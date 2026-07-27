import React, { useId, type ReactNode } from 'react';
import { Activity, Clock, Database } from 'lucide-react';
import type { TelemetryEnvelope } from '../telemetry';
import type { UIThemeMode } from '../types';
import { StatusBadge } from './StatusBadge';

export interface TelemetryCardProps<TPayload> {
  envelope: TelemetryEnvelope<TPayload>;
  title: string;
  theme?: UIThemeMode;
  className?: string;
  children?: ReactNode | ((data: TPayload) => ReactNode);
  renderContent?: (data: TPayload) => ReactNode;
}

const formatSourceName = (envelope: TelemetryEnvelope<unknown>): string => {
  return envelope.source.name || envelope.source.type;
};

const formatObservedAt = (observedAt: string): { relative: string; absolute: string } => {
  const observed = new Date(observedAt);
  if (Number.isNaN(observed.getTime())) {
    return { relative: 'Time unavailable', absolute: observedAt };
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - observed.getTime()) / 1000));
  let relative: string;
  if (elapsedSeconds < 5) relative = 'Just now';
  else if (elapsedSeconds < 60) relative = `${elapsedSeconds}s ago`;
  else if (elapsedSeconds < 3600) relative = `${Math.floor(elapsedSeconds / 60)}m ago`;
  else if (elapsedSeconds < 86400) relative = `${Math.floor(elapsedSeconds / 3600)}h ago`;
  else relative = `${Math.floor(elapsedSeconds / 86400)}d ago`;

  return { relative, absolute: observed.toLocaleString() };
};

export function TelemetryCard<TPayload>({
  envelope,
  title,
  theme = 'dark_tactical',
  className = '',
  children,
  renderContent,
}: TelemetryCardProps<TPayload>) {
  const titleId = useId();
  const sourceName = formatSourceName(envelope);
  const observedAt = formatObservedAt(envelope.timestamps.observedAt);
  const data = envelope.data;
  const hasData = data !== undefined;
  const suppressData = envelope.status === 'unavailable';

  const cardStyle = theme === 'night_vision'
    ? 'bg-black border-red-900/90 text-red-500'
    : theme === 'sunlight'
      ? 'bg-white border-amber-400 text-slate-900 shadow-sm'
      : 'bg-zinc-900/50 border-zinc-800 text-zinc-100 shadow-lg';
  const contentStyle = theme === 'night_vision'
    ? 'text-red-400'
    : theme === 'sunlight'
      ? 'text-slate-900'
      : 'text-zinc-100';

  let content: ReactNode;
  if (suppressData) {
    content = <span aria-label="Unavailable">—</span>;
  } else if (hasData) {
    content = renderContent
      ? renderContent(data)
      : typeof children === 'function'
        ? children(data)
        : children;
  } else {
    content = <span aria-label="Telemetry data unavailable">—</span>;
  }

  return (
    <article
      aria-labelledby={titleId}
      className={`rounded-2xl border p-4 sm:p-5 font-mono transition-all space-y-4 ${cardStyle} ${className}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-current/15">
        <div className="flex min-w-0 items-center gap-2">
          <Activity aria-hidden="true" className="w-4 h-4 shrink-0" />
          <h3 id={titleId} className="text-xs font-bold uppercase tracking-widest truncate">
            {title}
          </h3>
        </div>
        <StatusBadge status={envelope.status} />
      </header>

      <div className={`min-h-16 [text-wrap:pretty] ${contentStyle}`}>
        {content ?? <span aria-label="Unavailable">—</span>}
      </div>

      {envelope.status === 'error' && (
        <div role="alert" className="rounded-xl border border-red-500/50 bg-red-950/40 p-3 text-xs text-red-200">
          <span className="font-bold uppercase tracking-wide">Telemetry error:</span>{' '}
          {envelope.error.message}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-3 border-t border-current/15 text-[10px] uppercase tracking-wide opacity-80">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Database aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
          <span className="sr-only">Source:</span>
          <span className="truncate">{sourceName}</span>
        </span>
        <time
          dateTime={envelope.timestamps.observedAt}
          title={`Observed ${observedAt.absolute}`}
          className="inline-flex items-center gap-1.5"
        >
          <Clock aria-hidden="true" className="w-3.5 h-3.5" />
          <span className="sr-only">Observed:</span>
          {observedAt.relative}
        </time>
      </footer>
    </article>
  );
}
