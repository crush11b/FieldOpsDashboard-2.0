import { describe, expect, it } from 'vitest';
import { formatNetworkDisplay, formatStorageDisplay } from '../systemTelemetryDisplay';

describe('system telemetry display', () => {
  it('formats real storage values including zero used bytes', () => {
    expect(formatStorageDisplay({ volume: 'C:\\', totalBytes: 100, availableBytes: 100, usedBytes: 0, usedPercent: 0 })).toBe('C:\\ 0.0 GB (0%)');
  });

  it('clears storage display when telemetry becomes unavailable', () => {
    expect(formatStorageDisplay(null)).toBe('Unavailable');
  });

  it('formats connected interface identity, type, and IPv4 address', () => {
    expect(formatNetworkDisplay({ available: true, interfaces: [{ name: 'Wi-Fi', description: 'Field Wi-Fi', type: 'Wireless80211', ipv4Address: '192.168.1.20', linkSpeedBitsPerSecond: 54_000_000 }] })).toBe('Wi-Fi (Wireless80211) 192.168.1.20 54 Mbps');
  });

  it('does not fabricate a network value when no usable interface exists', () => {
    expect(formatNetworkDisplay({ available: false, interfaces: [] })).toBe('Unavailable');
    expect(formatNetworkDisplay(null)).toBe('Unavailable');
  });
});