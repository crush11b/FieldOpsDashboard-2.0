export function formatUtc(value: string | undefined): string {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

export function formatUtcText(value: string): string {
  return value.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z(?=[^A-Za-z0-9]|$)/g, timestamp => formatUtc(timestamp));
}

export function ensureTerminalPeriod(value: string): string {
  const terminal = value.match(/[.!?]+$/)?.[0];
  if (!terminal) return `${value}.`;
  return `${value.slice(0, -terminal.length)}${terminal[0]}`;
}
