import type { SystemTelemetry } from '../types';

const formatGigabytes = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

export function formatStorageDisplay(storage: SystemTelemetry['storage']): string {
  if (!storage) return 'Unavailable';
  return `${storage.volume} ${formatGigabytes(storage.usedBytes)} GB (${storage.usedPercent}%)`;
}

export function formatNetworkDisplay(network: SystemTelemetry['network']): string {
  if (network === null) return 'Network telemetry unavailable';
  if (!network.available || network.interfaces.length === 0) return 'Disconnected';
  const wifi = network.interfaces.find((adapter) => isWifi(adapter.type));
  if (wifi) {
    const ssid = safeSsid(wifi.ssid);
    return ssid ?? 'Wi-Fi connected (name unavailable)';
  }
  if (network.interfaces.some((adapter) => isEthernet(adapter.type))) return 'Ethernet connected';
  if (network.interfaces.some((adapter) => isCellular(adapter.type))) return 'Cellular connected';
  return 'Network connected';
}

export function formatNetworkDiagnostics(network: SystemTelemetry['network']): string {
  if (network === null) return 'Network telemetry unavailable';
  if (!network.available || network.interfaces.length === 0) return 'Disconnected';
  return network.interfaces.map((adapter) => {
    const ssid = safeSsid(adapter.ssid);
    const address = adapter.ipv4Address ? ` ${adapter.ipv4Address}` : '';
    const speed = adapter.linkSpeedBitsPerSecond != null && adapter.linkSpeedBitsPerSecond > 0
      ? ` ${(adapter.linkSpeedBitsPerSecond / 1_000_000).toFixed(0)} Mbps`
      : '';
    return `${adapter.name} (${adapter.type})${ssid ? ` SSID ${ssid}` : ''}${address}${speed}`;
  }).join(' | ');
}

function isWifi(type: string): boolean {
  return type.toLowerCase() === 'wireless80211';
}

function isEthernet(type: string): boolean {
  return type.toLowerCase().includes('ethernet');
}

function isCellular(type: string): boolean {
  const normalized = type.toLowerCase();
  return normalized === 'wwanpp' || normalized === 'wwanpp2';
}

function safeSsid(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized !== '' && normalized.length <= 128 && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null;
}
