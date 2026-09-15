import React, { useId, type ReactNode } from 'react';
import { Activity, Clock, Database } from 'lucide-react';
import {
  getTelemetryFreshness,
  getTelemetrySourceLabel,
  TELEMETRY_UNAVAILABLE_LABEL,
  TELEMETRY_UNAVAILABLE_VALUE,
  type TelemetryEnvelope,
} from '../telemetry';
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

export function TelemetryCard<TPayload>({
  envelope,
  title,
  theme = 'dark_tactical',
  className = '',
  children,
  renderContent,
}: TelemetryCardProps<TPayload>) {
  const titleId = useId();
  const sourceName = getTelemetrySourceLabel(envelope.source);
  const freshness = getTelemetryFreshness(envelope.timestamps);
  const data = envelope.data;
  const hasData = data !== undefined;
  const suppressData = envelope.status === 'unavailable';

  let content: ReactNode;
  if (suppressData) {
    content = <span aria-label={TELEMETRY_UNAVAILABLE_LABEL}>{TELEMETRY_UNAVAILABLE_VALUE}</span>;
  } else if (hasData) {
    content = renderContent
      ? renderContent(data)
      : typeof children === 'function'
        ? children(data)
        : children;
  } else {
    content = <span aria-label={TELEMETRY_UNAVAILABLE_LABEL}>{TELEMETRY_UNAVAILABLE_VALUE}</span>;
  }

  return (
    <article
      aria-labelledby={titleId}
      data-theme={theme}
      className={`fo-surface rounded-2xl border p-4 sm:p-5 font-mono transition-all space-y-4 ${className}`}
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

      <div className="fo-text-primary min-h-16 [text-wrap:pretty]">
        {content ?? (
          <span aria-label={TELEMETRY_UNAVAILABLE_LABEL}>{TELEMETRY_UNAVAILABLE_VALUE}</span>
        )}
      </div>

      {envelope.status === 'error' && (
        <div role="alert" className="fo-status-danger rounded-xl border p-3 text-xs">
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
          title={`Observed ${freshness.observedAtLabel}`}
          className="inline-flex items-center gap-1.5"
        >
          <Clock aria-hidden="true" className="w-3.5 h-3.5" />
          <span className="sr-only">Observed:</span>
          {freshness.relativeAge}
        </time>
      </footer>
    </article>
  );
}
