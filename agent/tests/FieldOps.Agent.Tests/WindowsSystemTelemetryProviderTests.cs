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
    public void FailedNativeCallIsUnavailable()
    {
        var result = new WindowsSystemTelemetryProvider(new Fake(null)).GetObservation();
        Assert.Equal(SystemTelemetryStatus.Error, result.Status);
    }

    private sealed class Fake(NativePowerStatus? value) : IWindowsPowerStatus
    {
        public bool TryGet(out NativePowerStatus status) { status = value ?? default; return value.HasValue; }
    }
}
