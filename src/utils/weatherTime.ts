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

export function formatWeatherDateTime(
  utcTimestamp: string,
  timeZone: string = resolveOperatorTimeZone(),
  locale = 'en-US',
): string {
  const date = new Date(utcTimestamp);
  if (Number.isNaN(date.getTime()) || !isSupportedTimeZone(timeZone)) return utcTimestamp;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}


export function weatherConditionLabel(code: number): string {
  if (!Number.isInteger(code)) return 'Unknown';
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code === 51 || code === 53 || code === 55) return 'Drizzle';
  if (code === 56 || code === 57) return 'Freezing drizzle';
  if (code === 61 || code === 63 || code === 65) return 'Rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code === 71 || code === 73 || code === 75) return 'Snow';
  if (code === 77) return 'Snow grains';
  if (code === 80 || code === 81 || code === 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorms';
  if (code === 96 || code === 99) return 'Thunderstorms / hail';
  return 'Unknown';
}
