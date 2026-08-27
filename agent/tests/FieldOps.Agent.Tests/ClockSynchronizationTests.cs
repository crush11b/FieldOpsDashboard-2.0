using FieldOps.Agent.Clock;
using FieldOps.Agent.Location;

namespace FieldOps.Agent.Tests;

public sealed class ClockSynchronizationTests
{
    [Fact]
    public async Task RequiresExplicitConfirmation()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var synchronizer = new GpsClockSynchronizer(new FakeLocation(new(NmeaTimeStatus.Available, DateTimeOffset.Parse("2026-08-24T12:00:01Z"), "RMC")), clock);
        var result = await synchronizer.SynchronizeAsync(false, CancellationToken.None);
        Assert.Equal(ClockSynchronizationStatus.NotSynchronized, result.Status); Assert.Equal(ClockSynchronizationError.ConfirmationRequired, result.Error); Assert.Null(clock.SetValue);
    }

    [Fact]
    public async Task RejectsUnsafeOffsetAndUnavailableTime()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var unsafeResult = await new GpsClockSynchronizer(new FakeLocation(new(NmeaTimeStatus.Available, clock.UtcNow.AddMinutes(6), "RMC")), clock).SynchronizeAsync(true, CancellationToken.None);
        var unavailableResult = await new GpsClockSynchronizer(new FakeLocation(new(NmeaTimeStatus.Unavailable, null, "RMC")), clock).SynchronizeAsync(true, CancellationToken.None);
        Assert.Equal(ClockSynchronizationError.UnsafeOffset, unsafeResult.Error); Assert.Equal(ClockSynchronizationError.GnssUnavailable, unavailableResult.Error); Assert.Null(clock.SetValue);
    }

    [Fact]
    public async Task SetsClockAndRetainsSuccessEvidence()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z")); var target = clock.UtcNow.AddSeconds(2);
        var result = await new GpsClockSynchronizer(new FakeLocation(new(NmeaTimeStatus.Available, target, "RMC")), clock).SynchronizeAsync(true, CancellationToken.None);
        Assert.Equal(ClockSynchronizationStatus.Synchronized, result.Status); Assert.Equal(2, result.OffsetBeforeSynchronizationSeconds); Assert.Equal(target, clock.SetValue); Assert.NotNull(result.LastSuccessfulSynchronizationUtc);
    }

    [Fact]
    public async Task VerifiesFreshGnssWithinToleranceWithoutSettingClock()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var synchronizer = new GpsClockSynchronizer(new FakeLocation(new(NmeaTimeStatus.Available, clock.UtcNow.AddSeconds(1), "RMC")), clock);
        var result = await synchronizer.VerifyAsync(CancellationToken.None);
        Assert.Equal(ClockSynchronizationStatus.Synchronized, result.Status);
        Assert.Equal(1, result.CurrentOffsetSeconds);
        Assert.Null(clock.SetValue);
    }

    [Fact]
    public async Task ReportsOutsideToleranceAndMissingGnssWithoutSettingClock()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var outsideTolerance = await new GpsClockSynchronizer(new FakeLocation(new(NmeaTimeStatus.Available, clock.UtcNow.AddSeconds(3), "RMC")), clock).VerifyAsync(CancellationToken.None);
        var unavailable = await new GpsClockSynchronizer(new FakeLocation(new(NmeaTimeStatus.Unavailable, null, "RMC")), clock).VerifyAsync(CancellationToken.None);
        Assert.Equal(ClockSynchronizationStatus.NotSynchronized, outsideTolerance.Status);
        Assert.Equal(ClockSynchronizationError.UnsafeOffset, outsideTolerance.Error);
        Assert.Equal(ClockSynchronizationStatus.Unknown, unavailable.Status);
        Assert.Equal(ClockSynchronizationError.GnssUnavailable, unavailable.Error);
        Assert.Null(clock.SetValue);
    }

    private sealed class FakeLocation(NmeaTimeEvidence time) : ISerialNmeaLocationService { public Task<LocationObservation> AcquireAsync(CancellationToken cancellationToken) => throw new NotImplementedException(); public Task<NmeaTimeEvidence> AcquireTimeAsync(CancellationToken cancellationToken) => Task.FromResult(time); }
    private sealed class FakeClock(DateTimeOffset utcNow) : ISystemClock { public DateTimeOffset UtcNow { get; } = utcNow; public DateTimeOffset? SetValue { get; private set; } public DateTimeOffset GetUtcNow() => UtcNow; public bool SetUtc(DateTimeOffset utc, out string? error) { error = null; SetValue = utc; return true; } }
}