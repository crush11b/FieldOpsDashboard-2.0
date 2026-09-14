import { describe, expect, it } from 'vitest';
import { formatNetworkDisplay, formatStorageDisplay } from '../systemTelemetryDisplay';

describe('system telemetry display', () => {
  it('formats real storage values including zero used bytes', () => {
    expect(formatStorageDisplay({ volume: 'C:\\', totalBytes: 100, availableBytes: 100, usedBytes: 0, usedPercent: 0 })).toBe('C:\\ 0.0 GB (0%)');
  });

  it('clears storage display when telemetry becomes unavailable', () => {
    expect(formatStorageDisplay(null)).toBe('Unavailable');
  });

  it('shows the observed SSID without exposing the technical adapter type', () => {
    expect(formatNetworkDisplay({ available: true, interfaces: [{
      name: 'Wi-Fi', description: 'Intel Wireless Adapter', type: 'Wireless80211',
      ipv4Address: '192.168.1.20', linkSpeedBitsPerSecond: 54_000_000, ssid: 'FieldNet',
    }] })).toBe('FieldNet 192.168.1.20 54 Mbps');
  });

  it('uses a truthful generic Wi-Fi fallback when SSID is unavailable', () => {
    expect(formatNetworkDisplay({ available: true, interfaces: [{
      name: 'Wi-Fi', description: 'Not an SSID', type: 'Wireless80211',
      ipv4Address: null, linkSpeedBitsPerSecond: null, ssid: null,
    }] })).toBe('Wi-Fi');
  });

  it('shows an Ethernet interface label independently of Wi-Fi identity', () => {
    expect(formatNetworkDisplay({ available: true, interfaces: [{
      name: 'Ethernet 2', description: 'Dock adapter', type: 'Ethernet',
      ipv4Address: '10.0.0.2', linkSpeedBitsPerSecond: 1_000_000_000,
    }] })).toBe('Ethernet 2 10.0.0.2 1000 Mbps');
  });

  it('distinguishes disconnected from unavailable telemetry', () => {
    expect(formatNetworkDisplay({ available: false, interfaces: [] })).toBe('Disconnected');
    expect(formatNetworkDisplay(null)).toBe('Unavailable');
  });
});
