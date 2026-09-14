import { describe, expect, it } from 'vitest';
import { formatNetworkDiagnostics, formatNetworkDisplay, formatStorageDisplay } from '../systemTelemetryDisplay';

describe('system telemetry display', () => {
  it('formats real storage values including zero used bytes', () => {
    expect(formatStorageDisplay({ volume: 'C:\\', totalBytes: 100, availableBytes: 100, usedBytes: 0, usedPercent: 0 })).toBe('C:\\ 0.0 GB (0%)');
  });

  it('clears storage display when telemetry becomes unavailable', () => {
    expect(formatStorageDisplay(null)).toBe('Unavailable');
  });

  it('shows the connected Wi-Fi SSID without exposing interface details in the normal display', () => {
    const network = { available: true, interfaces: [{ name: 'Wi-Fi', description: 'Field Wi-Fi', type: 'Wireless80211', ipv4Address: '192.168.1.20', linkSpeedBitsPerSecond: 54_000_000, ssid: 'Camp Network' }] };
    expect(formatNetworkDisplay(network)).toBe('Camp Network');
    expect(formatNetworkDiagnostics(network)).toBe('Wi-Fi (Wireless80211) SSID Camp Network 192.168.1.20 54 Mbps');
  });

  it('uses an honest fallback when a connected Wi-Fi SSID is unavailable or unsafe', () => {
    const base = { name: 'Wi-Fi', description: null, type: 'Wireless80211', ipv4Address: null, linkSpeedBitsPerSecond: null };
    expect(formatNetworkDisplay({ available: true, interfaces: [{ ...base, ssid: null }] })).toBe('Wi-Fi connected (name unavailable)');
    expect(formatNetworkDisplay({ available: true, interfaces: [{ ...base, ssid: 'Field\nNetwork' }] })).toBe('Wi-Fi connected (name unavailable)');
  });

  it('distinguishes Ethernet, cellular, disconnected, and unavailable telemetry', () => {
    expect(formatNetworkDisplay({ available: true, interfaces: [{ name: 'Ethernet', description: null, type: 'Ethernet', ipv4Address: null, linkSpeedBitsPerSecond: null }] })).toBe('Ethernet connected');
    expect(formatNetworkDisplay({ available: true, interfaces: [{ name: 'LTE', description: null, type: 'Wwanpp', ipv4Address: null, linkSpeedBitsPerSecond: null }] })).toBe('Cellular connected');
    expect(formatNetworkDisplay({ available: false, interfaces: [] })).toBe('Disconnected');
    expect(formatNetworkDisplay(null)).toBe('Network telemetry unavailable');
  });

  it('prefers a Wi-Fi SSID when more than one connected interface is reported', () => {
    expect(formatNetworkDisplay({ available: true, interfaces: [
      { name: 'Ethernet', description: null, type: 'Ethernet', ipv4Address: null, linkSpeedBitsPerSecond: null },
      { name: 'Wi-Fi', description: null, type: 'Wireless80211', ipv4Address: null, linkSpeedBitsPerSecond: null, ssid: 'Field LAN' },
    ] })).toBe('Field LAN');
  });
});
