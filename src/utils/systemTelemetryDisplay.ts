import type { SystemTelemetry } from '../types';

const formatGigabytes = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

export function formatStorageDisplay(storage: SystemTelemetry['storage']): string {
  if (!storage) return 'Unavailable';
  return `${storage.volume} ${formatGigabytes(storage.usedBytes)} GB (${storage.usedPercent}%)`;
}

export function formatNetworkDisplay(network: SystemTelemetry['network']): string {
  if (!network) return 'Unavailable';
  if (!network.available || network.interfaces.length === 0) return 'Disconnected';
  return network.interfaces.map((adapter) => {
    const isWifi = adapter.type.toLowerCase() === 'wireless80211';
    const isEthernet = adapter.type.toLowerCase().includes('ethernet');
    const ssid = adapter.ssid?.trim();
    const identity = isWifi
      ? (ssid || 'Wi-Fi')
      : isEthernet
        ? (adapter.name.trim() || 'Ethernet')
        : (adapter.name.trim() || adapter.description?.trim() || 'Connected');
    const address = adapter.ipv4Address ? ` ${adapter.ipv4Address}` : '';
    const speed = adapter.linkSpeedBitsPerSecond != null && adapter.linkSpeedBitsPerSecond > 0
      ? ` ${(adapter.linkSpeedBitsPerSecond / 1_000_000).toFixed(0)} Mbps`
      : '';
    return `${identity}${address}${speed}`;
  }).join(' | ');
}
