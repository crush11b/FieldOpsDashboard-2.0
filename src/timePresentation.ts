export type WeatherTimeZoneSelection =
  | { readonly mode: 'device' }
  | { readonly mode: 'utc' }
  | { readonly mode: 'named'; readonly timeZone: string };

export interface ResolvedWeatherTimeZone {
  readonly timeZone: string;
  readonly contextLabel: string;
  readonly fallbackReason?: 'device_timezone_unavailable' | 'invalid_named_timezone';
}

export interface FormattedWeatherHour {
  readonly clock: string;
  readonly zone: string;
  readonly dateTime: string;
}

export function resolveWeatherTimeZone(
  selection: WeatherTimeZoneSelection,
  deviceTimeZone = readDeviceTimeZone(),
): ResolvedWeatherTimeZone {
  if (selection.mode === 'utc') return { timeZone: 'UTC', contextLabel: 'UTC' };
  if (selection.mode === 'named') {
    const timeZone = selection.timeZone.trim();
    return isValidIanaTimeZone(timeZone)
      ? { timeZone, contextLabel: timeZone }
      : { timeZone: 'UTC', contextLabel: 'UTC', fallbackReason: 'invalid_named_timezone' };
  }
  return isValidIanaTimeZone(deviceTimeZone)
    ? { timeZone: deviceTimeZone, contextLabel: 'DEVICE LOCAL' }
    : { timeZone: 'UTC', contextLabel: 'UTC', fallbackReason: 'device_timezone_unavailable' };
}

export function formatWeatherHour(
  startsAtUtc: string,
  timeZone: string,
  locale = 'en-US',
): FormattedWeatherHour | null {
  const instant = new Date(startsAtUtc);
  if (!Number.isFinite(instant.getTime()) || !isValidIanaTimeZone(timeZone)) return null;
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const parts = formatter.formatToParts(instant);
  const zone = parts.find(part => part.type === 'timeZoneName')?.value || timeZone;
  const clock = parts
    .filter(part => part.type !== 'timeZoneName')
    .map(part => part.value)
    .join('')
    .replace(/[\u00a0\u202f]/g, ' ')
    .trim();
  return { clock, zone, dateTime: instant.toISOString() };
}

export function isValidIanaTimeZone(value: string): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function readDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
