import type { SystemTelemetry } from '../types';

const formatGigabytes = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

export function formatStorageDisplay(storage: SystemTelemetry['storage']): string {
  if (!storage) return 'Unavailable';
  return `${storage.volume} ${formatGigabytes(storage.usedBytes)} GB (${storage.usedPercent}%)`;
}

export function formatNetworkDisplay(network: SystemTelemetry['network']): string {
  if (!network?.available || network.interfaces.length === 0) return 'Unavailable';
  return network.interfaces.map((adapter) => {
    const address = adapter.ipv4Address ? ` ${adapter.ipv4Address}` : '';
    const speed = adapter.linkSpeedBitsPerSecond != null && adapter.linkSpeedBitsPerSecond > 0
      ? ` ${(adapter.linkSpeedBitsPerSecond / 1_000_000).toFixed(0)} Mbps`
      : '';
    return `${adapter.name} (${adapter.type})${address}${speed}`;
  }).join(' | ');
}
