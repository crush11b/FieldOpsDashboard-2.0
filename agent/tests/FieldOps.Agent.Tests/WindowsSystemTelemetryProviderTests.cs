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
    public void UnknownRuntimeAndNoBatteryRemainNullable()
    {
        var result = new WindowsSystemTelemetryProvider(new Fake(new(1, 128, 255, uint.MaxValue))).GetObservation();
        Assert.Null(result.ChargePercent);
        Assert.Null(result.RemainingRuntimeSeconds);
        Assert.False(result.BatteryPresent);
        Assert.Equal(SystemPowerSource.AC, result.PowerSource);
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
