using System.Diagnostics;
using FieldOps.Agent.Clock;
using FieldOps.Agent.Location;

namespace FieldOps.Agent.Tests;

public sealed class ClockSynchronizationTests
{
    [Fact]
    public async Task RequiresExplicitConfirmation()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var synchronizer = new GpsClockSynchronizer(new FakeLocation(Coherent(DateTimeOffset.Parse("2026-08-24T12:00:01Z"))), clock);
        var result = await synchronizer.SynchronizeAsync(false, CancellationToken.None);
        Assert.Equal(ClockSynchronizationStatus.NotSynchronized, result.Status); Assert.Equal(ClockSynchronizationError.ConfirmationRequired, result.Error); Assert.Null(clock.SetValue);
    }

    [Fact]
    public async Task RejectsUnsafeOffsetAndUnavailableTime()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var unsafeResult = await new GpsClockSynchronizer(new FakeLocation(Coherent(clock.UtcNow.AddMinutes(6))), clock).SynchronizeAsync(true, CancellationToken.None);
        var unavailableResult = await new GpsClockSynchronizer(new FakeLocation(new(NmeaTimeStatus.Unavailable, null, "RMC")), clock).SynchronizeAsync(true, CancellationToken.None);
        Assert.Equal(ClockSynchronizationError.UnsafeOffset, unsafeResult.Error); Assert.Equal(ClockSynchronizationError.GnssUnavailable, unavailableResult.Error); Assert.Null(clock.SetValue);
    }

    [Fact]
    public async Task SetsClockAndRetainsSuccessEvidence()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z")); var target = clock.UtcNow.AddSeconds(2);
        var result = await new GpsClockSynchronizer(new FakeLocation(Coherent(target)), clock).SynchronizeAsync(true, CancellationToken.None);
        Assert.Equal(ClockSynchronizationStatus.Synchronized, result.Status); Assert.Equal(2, result.OffsetBeforeSynchronizationSeconds); Assert.Equal(target, clock.SetValue); Assert.NotNull(result.LastSuccessfulSynchronizationUtc);
    }

    [Fact]
    public async Task VerifiesFreshGnssWithinToleranceWithoutSettingClock()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var synchronizer = new GpsClockSynchronizer(new FakeLocation(CoherentWithReceipt(clock.UtcNow.AddSeconds(1))), clock);
        var result = await synchronizer.VerifyAsync(CancellationToken.None);
        Assert.Equal(ClockSynchronizationStatus.Synchronized, result.Status);
        Assert.InRange(result.CurrentOffsetSeconds!.Value, 0.99, 1.01);
        Assert.NotNull(result.ProjectedTargetUtc); Assert.Equal(clock.UtcNow, result.WindowsUtcBeforeSet); Assert.NotNull(result.GnssObservationReceivedAtUtc); Assert.NotNull(result.EvidenceAgeMilliseconds); Assert.NotNull(result.OperationStartedAtUtc); Assert.NotNull(result.OperationDurationMilliseconds); Assert.Equal(0, result.AttemptCount);
        Assert.Null(clock.SetValue);
    }

    [Fact]
    public async Task ReportsOutsideToleranceAndMissingGnssWithoutSettingClock()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var outsideTolerance = await new GpsClockSynchronizer(new FakeLocation(Coherent(clock.UtcNow.AddSeconds(3))), clock).VerifyAsync(CancellationToken.None);
        var unavailable = await new GpsClockSynchronizer(new FakeLocation(new(NmeaTimeStatus.Unavailable, null, "RMC")), clock).VerifyAsync(CancellationToken.None);
        Assert.Equal(ClockSynchronizationStatus.NotSynchronized, outsideTolerance.Status);
        Assert.Equal(ClockSynchronizationError.UnsafeOffset, outsideTolerance.Error);
        Assert.Equal(ClockSynchronizationStatus.Unknown, unavailable.Status);
        Assert.Equal(ClockSynchronizationError.GnssUnavailable, unavailable.Error);
        Assert.Null(unavailable.ProjectedTargetUtc); Assert.Null(unavailable.WindowsUtcBeforeSet); Assert.Null(unavailable.CurrentOffsetSeconds); Assert.Equal(0, unavailable.AttemptCount);
        Assert.Null(clock.SetValue);
    }

    [Fact]
    public async Task ReportsUnknownWhenWindowsComparisonIsUnavailableWithoutSettingClock()
    {
        var result = await new GpsClockSynchronizer(new FakeLocation(Coherent(DateTimeOffset.Parse("2026-08-24T12:00:01Z"))), new ThrowingClock()).VerifyAsync(CancellationToken.None);

        Assert.Equal(ClockSynchronizationStatus.Unknown, result.Status);
        Assert.Equal(ClockSynchronizationError.VerificationFailed, result.Error);
        Assert.Null(result.ProjectedTargetUtc);
        Assert.Null(result.WindowsUtcBeforeSet);
        Assert.Null(result.CurrentOffsetSeconds);
        Assert.Equal(0, result.AttemptCount);
    }

    [Fact]
    public async Task RepeatedPassiveVerificationRetainsTrustedEvidenceWithoutClockMonotonicHook()
    {
        var clock = new MonotonicUnavailableClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var location = new CountingLocation(CoherentWithReceipt(clock.UtcNow.AddSeconds(1)));
        var synchronizer = new GpsClockSynchronizer(location, clock);

        var first = await synchronizer.VerifyAsync(CancellationToken.None);
        var second = await synchronizer.VerifyAsync(CancellationToken.None);

        Assert.Equal(ClockSynchronizationStatus.Synchronized, first.Status);
        Assert.Equal(ClockSynchronizationStatus.Synchronized, second.Status);
        Assert.Equal(2, location.AcquisitionCount);
        Assert.NotNull(second.GnssTime.TimestampUtc);
        Assert.NotNull(second.ProjectedTargetUtc);
        Assert.Equal(0, second.AttemptCount);
        Assert.Null(clock.SetValue);
    }

    [Fact]
    public async Task RejectsDiscontinuousGnssEvidenceAfterRecentGoodClockObservation()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var location = new SequenceLocation(
            Coherent(clock.UtcNow.AddSeconds(0.4)),
            Coherent(clock.UtcNow.AddSeconds(22)));
        var synchronizer = new GpsClockSynchronizer(location, clock);

        Assert.Equal(ClockSynchronizationStatus.Synchronized, (await synchronizer.VerifyAsync(CancellationToken.None)).Status);
        var result = await synchronizer.SynchronizeAsync(true, CancellationToken.None);

        Assert.Equal(ClockSynchronizationError.SuspiciousEvidence, result.Error);
        Assert.Null(clock.SetValue);
        Assert.Contains("was not changed", result.AttemptMessage);
    }

    [Fact]
    public async Task ReturnsBoundedTimeoutFailureWithoutSettingClock()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var synchronizer = new GpsClockSynchronizer(new DelayedLocation(), clock);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(10));

        var result = await synchronizer.SynchronizeAsync(true, cancellation.Token);

        Assert.Equal(ClockSynchronizationError.OperationTimedOut, result.Error);
        Assert.Null(clock.SetValue);
        Assert.Equal(0, result.AttemptCount);
    }

    private sealed class FakeLocation(NmeaTimeEvidence time) : ISerialNmeaLocationService { public Task<LocationObservation> AcquireAsync(CancellationToken cancellationToken) => throw new NotImplementedException(); public Task<NmeaTimeEvidence> AcquireTimeAsync(CancellationToken cancellationToken) => Task.FromResult(time); }
    private sealed class ThrowingClock : ISystemClock { public DateTimeOffset GetUtcNow() => throw new InvalidOperationException("clock unavailable"); public bool SetUtc(DateTimeOffset utc, out string? error) { error = null; return false; } }
    private sealed class MonotonicUnavailableClock(DateTimeOffset utcNow) : ISystemClock { public DateTimeOffset UtcNow { get; } = utcNow; public DateTimeOffset? SetValue { get; private set; } public DateTimeOffset GetUtcNow() => UtcNow; public long GetMonotonicTimestamp() => throw new InvalidOperationException("monotonic clock unavailable"); public bool SetUtc(DateTimeOffset utc, out string? error) { error = null; SetValue = utc; return true; } }
    private sealed class CountingLocation(NmeaTimeEvidence time) : ISerialNmeaLocationService { public int AcquisitionCount { get; private set; } public Task<LocationObservation> AcquireAsync(CancellationToken cancellationToken) => throw new NotImplementedException(); public Task<NmeaTimeEvidence> AcquireTimeAsync(CancellationToken cancellationToken) { AcquisitionCount++; return Task.FromResult(time); } }
    private sealed class SequenceLocation(NmeaTimeEvidence first, NmeaTimeEvidence second) : ISerialNmeaLocationService { private int index; public Task<LocationObservation> AcquireAsync(CancellationToken cancellationToken) => throw new NotImplementedException(); public Task<NmeaTimeEvidence> AcquireTimeAsync(CancellationToken cancellationToken) => Task.FromResult(index++ == 0 ? first : second); }
    private sealed class DelayedLocation : ISerialNmeaLocationService { public Task<LocationObservation> AcquireAsync(CancellationToken cancellationToken) => throw new NotImplementedException(); public async Task<NmeaTimeEvidence> AcquireTimeAsync(CancellationToken cancellationToken) { await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken); return new(NmeaTimeStatus.Unavailable, null, "RMC"); } }
    private sealed class FakeClock(DateTimeOffset utcNow) : ISystemClock { public DateTimeOffset UtcNow { get; } = utcNow; public DateTimeOffset? SetValue { get; private set; } public DateTimeOffset GetUtcNow() => UtcNow; public bool SetUtc(DateTimeOffset utc, out string? error) { error = null; SetValue = utc; return true; } }
    private static NmeaTimeEvidence Coherent(DateTimeOffset timestamp) => new(NmeaTimeStatus.Available, timestamp, "RMC", null, timestamp, 0, "120000.00", "240826", timestamp.AddSeconds(-1), 1, 1, true);
    private static NmeaTimeEvidence CoherentWithReceipt(DateTimeOffset timestamp) => Coherent(timestamp) with { ReceivedAtMonotonicTimestamp = Stopwatch.GetTimestamp() };
}