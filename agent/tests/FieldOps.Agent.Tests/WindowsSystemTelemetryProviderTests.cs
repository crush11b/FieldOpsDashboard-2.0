using FieldOps.Agent.SystemTelemetry;

namespace FieldOps.Agent.Tests;

public sealed class WindowsSystemTelemetryProviderTests
{
    [Fact]
    public void PreservesZeroChargeAndAuthoritativeRuntime()
    {
        var provider = new WindowsSystemTelemetryProvider(new Fake(new(0, 1, 0, 120)));
        var result = provider.GetObservation();
        Assert.Equal(SystemTelemetryStatus.Available, result.Status);
        Assert.Equal(0, result.ChargePercent);
        Assert.Equal(SystemPowerSource.Battery, result.PowerSource);
        Assert.Equal(120, result.RemainingRuntimeSeconds);
    }

    [Fact]
    public void UnknownBatteryFlagRemainsUnknownWhileIndependentTelemetryIsPreserved()
    {
        var result = new WindowsSystemTelemetryProvider(new Fake(new(1, 255, 55, 123))).GetObservation();
        Assert.Null(result.BatteryPresent);
        Assert.Null(result.Charging);
        Assert.Equal(55, result.ChargePercent);
        Assert.Equal(123, result.RemainingRuntimeSeconds);
        Assert.Equal(SystemPowerSource.AC, result.PowerSource);
    }

    [Fact]
    public void ExplicitNoBatteryFlagReportsAbsentAndUnknownCharging()
    {
        var result = new WindowsSystemTelemetryProvider(new Fake(new(1, 128, 255, uint.MaxValue))).GetObservation();
        Assert.False(result.BatteryPresent);
        Assert.Null(result.Charging);
        Assert.Null(result.ChargePercent);
        Assert.Null(result.RemainingRuntimeSeconds);
    }

    [Fact]
    public void NormalBatteryFlagReportsPresent()
    {
        var result = new WindowsSystemTelemetryProvider(new Fake(new(0, 1, 0, 0))).GetObservation();
        Assert.True(result.BatteryPresent);
        Assert.False(result.Charging);
        Assert.Equal(0, result.ChargePercent);
    }

    [Fact]
    public void PreservesEnumeratedPhysicalBatteriesWithoutUsingAggregatePercentage()
    {
        var physical = new[]
        {
            new PhysicalBatteryObservation("BAT-B", "Keyboard", true, 89, false, "OK", "test", DateTimeOffset.UtcNow),
            new PhysicalBatteryObservation("BAT-A", "Tablet", true, 100, false, "OK", "test", DateTimeOffset.UtcNow),
        };
        var result = new WindowsSystemTelemetryProvider(new Fake(new(0, 1, 94, 11700)), new FakeBatteries(new(PhysicalBatteryCollectionStatus.Available, physical, null))).GetObservation();
        Assert.Equal(94, result.ChargePercent);
        Assert.Equal(new[] { "BAT-B", "BAT-A" }, result.PhysicalBatteries.Select(b => b.DeviceId));
        Assert.Equal(new int?[] { 89, 100 }, result.PhysicalBatteries.Select(b => b.Percentage));
    }

    [Theory]
    [InlineData(2, null)] [InlineData(3, false)] [InlineData(6, true)] [InlineData(7, true)] [InlineData(11, false)] [InlineData(42, null)]
    public void MapsWin32BatteryStatusHonestly(int code, bool? expected) => Assert.Equal(expected, WindowsPhysicalBatteryEnumerator.InterpretCharging(code));

    [Fact]
    public void AggregateRemainsAvailableWhenPhysicalEnumerationFails()
    {
        var result = new WindowsSystemTelemetryProvider(new Fake(new(0, 1, 94, 100)), new ThrowingBatteries()).GetObservation();
        Assert.Equal(SystemTelemetryStatus.Available, result.Status);
        Assert.Equal(PhysicalBatteryCollectionStatus.Error, result.PhysicalBatteryStatus);
        Assert.Empty(result.PhysicalBatteries);
    }

    [Fact]
    public void FailedNativeCallIsUnavailable()
    {
        var result = new WindowsSystemTelemetryProvider(new Fake(null)).GetObservation();
        Assert.Equal(SystemTelemetryStatus.Error, result.Status);
    }

    [Fact]
    public void PreservesNativeCpuAndMemoryValuesIncludingZero()
    {
        var metrics = new FakeMetrics(
            new CpuObservation(0, 8, "Test CPU"),
            new MemoryObservation(16UL * 1024 * 1024 * 1024, 4UL * 1024 * 1024 * 1024, 12UL * 1024 * 1024 * 1024, 75));
        var result = new WindowsSystemTelemetryProvider(new Fake(new(1, 1, 50, 10)), systemMetrics: metrics).GetObservation();
        Assert.Equal(0, result.Cpu?.UsagePercent);
        Assert.Equal(8, result.Cpu?.LogicalProcessorCount);
        Assert.Equal("Test CPU", result.Cpu?.Model);
        Assert.Equal(12UL * 1024 * 1024 * 1024, result.Memory?.UsedBytes);
        Assert.Equal(75, result.Memory?.UsedPercent);
    }

    [Fact]
    public void PreservesZeroAvailableMemoryAndCalculatesFullUtilization()
    {
        var result = new WindowsSystemTelemetryProvider(new Fake(new(1, 1, 50, 10)), systemMetrics: new FakeMetrics(null, new MemoryObservation(100, 0, 100, 100))).GetObservation();
        Assert.Equal(100UL, result.Memory?.TotalBytes);
        Assert.Equal(0UL, result.Memory?.AvailableBytes);
        Assert.Equal(100UL, result.Memory?.UsedBytes);
        Assert.Equal(100, result.Memory?.UsedPercent);
    }

    [Fact]
    public void CalculatesMemoryArithmeticAndUtilizationFromNativeValues()
    {
        var result = new WindowsSystemTelemetryProvider(new Fake(new(1, 1, 50, 10)), systemMetrics: new MemoryMetrics(159000, 81500)).GetObservation();
        Assert.Equal(77500UL, result.Memory?.UsedBytes);
        Assert.Equal(48.7, result.Memory?.UsedPercent);
    }

    [Fact]
    public void MemoryFailureLeavesCpuBatteryAndAvailableStatusIntact()
    {
        var result = new WindowsSystemTelemetryProvider(new Fake(new(1, 1, 50, 10)), systemMetrics: new ThrowingMemoryMetrics(new CpuObservation(12.5, 4, "Test CPU"))).GetObservation();
        Assert.Equal(SystemTelemetryStatus.Available, result.Status);
        Assert.NotNull(result.Cpu);
        Assert.Null(result.Memory);
        Assert.True(result.BatteryPresent);
    }

    [Fact]
    public void LeavesCpuAndMemoryNullWhenNativeMetricsAreUnavailable()
    {
        var result = new WindowsSystemTelemetryProvider(new Fake(new(1, 1, 50, 10)), systemMetrics: new FakeMetrics(null, null)).GetObservation();
        Assert.Equal(SystemTelemetryStatus.Available, result.Status);
        Assert.Null(result.Cpu);
        Assert.Null(result.Memory);
    }

    private sealed class Fake(NativePowerStatus? value) : IWindowsPowerStatus
    {
        public bool TryGet(out NativePowerStatus status) { status = value ?? default; return value.HasValue; }
    }

    private sealed class FakeBatteries(PhysicalBatteryCollection result) : IPhysicalBatteryEnumerator
    {
        public PhysicalBatteryCollection Enumerate(CancellationToken cancellationToken) => result;
    }
    private sealed class ThrowingBatteries : IPhysicalBatteryEnumerator
    {
        public PhysicalBatteryCollection Enumerate(CancellationToken cancellationToken) => throw new InvalidOperationException();
    }

    private sealed class FakeMetrics(CpuObservation? cpu, MemoryObservation? memory) : IWindowsSystemMetrics
    {
        public bool TryGetCpu(out CpuObservation value) { value = cpu!; return cpu is not null; }
        public bool TryGetMemory(out MemoryObservation value) { value = memory!; return memory is not null; }
    }

    private sealed class MemoryMetrics(ulong total, ulong available) : IWindowsSystemMetrics
    {
        public bool TryGetCpu(out CpuObservation value) { value = default!; return false; }
        public bool TryGetMemory(out MemoryObservation value)
        {
            var used = total >= available ? total - available : 0;
            value = new MemoryObservation(total, available, used, Math.Round((double)used / total * 100, 1));
            return true;
        }
    }

    private sealed class ThrowingMemoryMetrics(CpuObservation cpu) : IWindowsSystemMetrics
    {
        public bool TryGetCpu(out CpuObservation value) { value = cpu; return true; }
        public bool TryGetMemory(out MemoryObservation value) => throw new InvalidOperationException();
    }
}
