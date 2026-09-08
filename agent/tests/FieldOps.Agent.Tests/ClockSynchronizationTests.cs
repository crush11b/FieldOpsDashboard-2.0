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
        Assert.Equal(ClockSynchronizationError.UnsafeOffset, unsafeResult.Error); Assert.Equal(ClockSynchronizationError.GnssUnavailable, unavailableResult.Error); Assert.Equal(0, unsafeResult.AttemptCount); Assert.Equal(0, unavailableResult.AttemptCount); Assert.Null(clock.SetValue);
    }

    [Fact]
    public async Task SetsClockAndRetainsSuccessEvidence()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z")); var target = clock.UtcNow.AddSeconds(3);
        var result = await new GpsClockSynchronizer(new FakeLocation(Coherent(target)), clock).SynchronizeAsync(true, CancellationToken.None);
        Assert.Equal(ClockSynchronizationStatus.Synchronized, result.Status); Assert.Equal(3, result.OffsetBeforeSynchronizationSeconds); Assert.Equal(target, clock.SetValue); Assert.NotNull(result.LastSuccessfulSynchronizationUtc); Assert.Equal(1, result.AttemptCount);
    }

    [Fact]
    public async Task ConfirmedSynchronizationSetsClockEvenWhenClockAlreadyAgrees()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var synchronizer = new GpsClockSynchronizer(new FakeLocation(CoherentWithReceipt(clock.UtcNow.AddSeconds(0.4))), clock);

        var result = await synchronizer.SynchronizeAsync(true, CancellationToken.None);

        Assert.Equal(ClockSynchronizationStatus.Synchronized, result.Status);
        Assert.InRange(result.OffsetBeforeSynchronizationSeconds!.Value, 0.39, 0.41);
        Assert.InRange(result.CurrentOffsetSeconds!.Value, -0.01, 0.01);
        Assert.Equal(1, result.AttemptCount);
        Assert.NotNull(result.WindowsUtcAfterSet);
        Assert.True(result.WindowsSetAttempted);
        Assert.True(result.WindowsSetAccepted);
        Assert.True(result.VerificationPerformed);
        Assert.Equal(1, clock.SetCount);
        Assert.InRange((clock.SetValue!.Value - result.ProjectedTargetUtc!.Value).Duration().TotalMilliseconds, 0, 10);
    }

    [Fact]
    public async Task VerifiesFreshGnssWithinToleranceWithoutSettingClock()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var synchronizer = new GpsClockSynchronizer(new FakeLocation(CoherentWithReceipt(clock.UtcNow.AddSeconds(0.4))), clock);
        var result = await synchronizer.VerifyAsync(CancellationToken.None);
        Assert.Equal(ClockSynchronizationStatus.Synchronized, result.Status);
        Assert.InRange(result.CurrentOffsetSeconds!.Value, 0.39, 0.41);
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
        Assert.Equal(ClockSynchronizationError.None, outsideTolerance.Error);
        Assert.Equal(ClockSynchronizationStatus.Unknown, unavailable.Status);
        Assert.Equal(ClockSynchronizationError.GnssUnavailable, unavailable.Error);
        Assert.Null(unavailable.ProjectedTargetUtc); Assert.Null(unavailable.WindowsUtcBeforeSet); Assert.Null(unavailable.CurrentOffsetSeconds); Assert.Equal(0, unavailable.AttemptCount);
        Assert.Null(clock.SetValue);
    }

    [Theory]
    [InlineData(0.5)]
    [InlineData(0.999)]
    [InlineData(1.0)]
    [InlineData(1.4)]
    [InlineData(2.0)]
    public async Task TrustedOffsetAbovePracticalToleranceAttemptsExactlyOneCorrection(double offsetSeconds)
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var result = await new GpsClockSynchronizer(new FakeLocation(Coherent(clock.UtcNow.AddSeconds(offsetSeconds))), clock).SynchronizeAsync(true, CancellationToken.None);

        Assert.Equal(ClockSynchronizationStatus.Synchronized, result.Status);
        Assert.Equal(1, result.AttemptCount);
        Assert.True(result.RequestAccepted);
        Assert.True(result.CorrectionRequired);
        Assert.True(result.WindowsSetAttempted);
        Assert.True(result.WindowsSetAccepted);
        Assert.True(result.VerificationPerformed);
        Assert.Equal(1, clock.SetCount);
    }

    [Theory]
    [InlineData(0.499, ClockSynchronizationStatus.Synchronized)]
    [InlineData(0.500, ClockSynchronizationStatus.Degraded)]
    [InlineData(0.999, ClockSynchronizationStatus.Degraded)]
    [InlineData(1.000, ClockSynchronizationStatus.NotSynchronized)]
    [InlineData(1.400, ClockSynchronizationStatus.NotSynchronized)]
    [InlineData(2.000, ClockSynchronizationStatus.NotSynchronized)]
    public async Task ClassifiesExactWindowsClockBoundaries(double offsetSeconds, ClockSynchronizationStatus expectedStatus)
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var result = await new GpsClockSynchronizer(new FakeLocation(Coherent(clock.UtcNow.AddSeconds(offsetSeconds))), clock).VerifyAsync(CancellationToken.None);

        Assert.Equal(expectedStatus, result.Status);
        Assert.Equal(0, clock.SetCount);
    }

    [Theory]
    [InlineData(0.499, ClockSynchronizationStatus.Synchronized)]
    [InlineData(0.500, ClockSynchronizationStatus.Degraded)]
    [InlineData(0.999, ClockSynchronizationStatus.Degraded)]
    [InlineData(1.000, ClockSynchronizationStatus.Error)]
    public async Task ClassifiesPostSetVerificationBoundaries(double residualOffsetSeconds, ClockSynchronizationStatus expectedStatus)
    {
        var clock = new ResidualClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"), residualOffsetSeconds);
        var result = await new GpsClockSynchronizer(new FakeLocation(Coherent(clock.UtcNow.AddSeconds(1.4))), clock).SynchronizeAsync(true, CancellationToken.None);

        Assert.Equal(expectedStatus, result.Status);
        Assert.Equal(1, clock.SetCount);
        Assert.True(result.WindowsSetAttempted);
        Assert.True(result.WindowsSetAccepted);
        Assert.True(result.VerificationPerformed);
        if (expectedStatus == ClockSynchronizationStatus.Error) Assert.Equal(ClockSynchronizationError.VerificationFailed, result.Error);
        else Assert.Equal(ClockSynchronizationError.None, result.Error);
    }

    [Fact]
    public async Task VerificationOutsidePracticalToleranceFailsAfterAcceptedSet()
    {
        var clock = new VerificationFailureClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var result = await new GpsClockSynchronizer(new FakeLocation(Coherent(clock.UtcNow.AddSeconds(1.4))), clock).SynchronizeAsync(true, CancellationToken.None);

        Assert.Equal(ClockSynchronizationStatus.Error, result.Status);
        Assert.Equal(ClockSynchronizationError.VerificationFailed, result.Error);
        Assert.True(result.WindowsSetAttempted);
        Assert.True(result.WindowsSetAccepted);
        Assert.True(result.VerificationPerformed);
        Assert.NotNull(result.VerificationOffsetSeconds);
        Assert.Equal(1, clock.SetCount);
    }

    [Fact]
    public async Task PostSetTargetIsProjectedToVerificationInstant()
    {
        var clock = new FakeClock(DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
        var result = await new GpsClockSynchronizer(new FakeLocation(CoherentWithReceipt(clock.UtcNow.AddSeconds(1.4))), clock).SynchronizeAsync(true, CancellationToken.None);

        Assert.Equal(ClockSynchronizationStatus.Synchronized, result.Status);
        Assert.True(result.ProjectedTargetUtc > clock.SetValue);
        Assert.True(result.VerificationPerformed);
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
        var location = new CountingLocation(CoherentWithReceipt(clock.UtcNow.AddSeconds(0.4)));
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
    private sealed class FakeClock(DateTimeOffset utcNow) : ISystemClock { public DateTimeOffset UtcNow { get; private set; } = utcNow; public DateTimeOffset? SetValue { get; private set; } public int SetCount { get; private set; } public DateTimeOffset GetUtcNow() => UtcNow; public bool SetUtc(DateTimeOffset utc, out string? error) { error = null; SetCount++; SetValue = utc; UtcNow = utc; return true; } }
    private sealed class VerificationFailureClock(DateTimeOffset utcNow) : ISystemClock { public DateTimeOffset UtcNow { get; private set; } = utcNow; public int SetCount { get; private set; } public DateTimeOffset GetUtcNow() => UtcNow; public bool SetUtc(DateTimeOffset utc, out string? error) { error = null; SetCount++; UtcNow = utc.AddSeconds(1); return true; } }
    private sealed class ResidualClock(DateTimeOffset utcNow, double residualOffsetSeconds) : ISystemClock { public DateTimeOffset UtcNow { get; private set; } = utcNow; public int SetCount { get; private set; } public DateTimeOffset GetUtcNow() => UtcNow; public bool SetUtc(DateTimeOffset utc, out string? error) { error = null; SetCount++; UtcNow = utc - TimeSpan.FromSeconds(residualOffsetSeconds); return true; } }
    private static NmeaTimeEvidence Coherent(DateTimeOffset timestamp) => new(NmeaTimeStatus.Available, timestamp, "RMC", null, timestamp, 0, "120000.00", "240826", timestamp.AddSeconds(-1), 1, 1, true);
    private static NmeaTimeEvidence CoherentWithReceipt(DateTimeOffset timestamp) => Coherent(timestamp) with { ReceivedAtMonotonicTimestamp = Stopwatch.GetTimestamp() };
}
