export function resolveOperatorTimeZone(): string {
  const candidate = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isSupportedTimeZone(candidate) ? candidate : 'UTC';
}

export function isSupportedTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function formatWeatherHour(
  utcTimestamp: string,
  timeZone: string = resolveOperatorTimeZone(),
  locale = 'en-US',
): string {
  const date = new Date(utcTimestamp);
  if (Number.isNaN(date.getTime()) || !isSupportedTimeZone(timeZone)) return utcTimestamp;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
