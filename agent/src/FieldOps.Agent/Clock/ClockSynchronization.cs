using System.ComponentModel;
using System.Runtime.InteropServices;
using FieldOps.Agent.Location;

namespace FieldOps.Agent.Clock;

public enum ClockSynchronizationStatus { Synchronized, NotSynchronized, Unknown, Unavailable, Error }
public enum ClockSynchronizationError { None, ConfirmationRequired, GnssUnavailable, GnssStaleOrMalformed, UnsafeOffset, PrivilegeUnavailable, NativeFailure, UnsupportedPlatform }
public sealed record ClockSynchronizationEvidence(
    ClockSynchronizationStatus Status,
    ClockSynchronizationError Error,
    NmeaTimeEvidence GnssTime,
    DateTimeOffset? LastSuccessfulSynchronizationUtc,
    double? OffsetBeforeSynchronizationSeconds,
    double? CurrentOffsetSeconds,
    string? AttemptMessage);

public interface ISystemClock
{
    DateTimeOffset GetUtcNow();
    bool SetUtc(DateTimeOffset utc, out string? error);
}

public sealed class WindowsSystemClock : ISystemClock
{
    public DateTimeOffset GetUtcNow() => DateTimeOffset.UtcNow;
    public bool SetUtc(DateTimeOffset utc, out string? error)
    {
        error = null;
        if (!OperatingSystem.IsWindows()) { error = "Windows system-time synchronization is unsupported on this platform."; return false; }
        if (!OpenProcessToken(GetCurrentProcess(), TokenAccess.TOKEN_ADJUST_PRIVILEGES | TokenAccess.TOKEN_QUERY, out var token)) { error = LastError(); return false; }
        try
        {
            if (!LookupPrivilegeValue(null, "SeSystemtimePrivilege", out var luid)) { error = LastError(); return false; }
            var privileges = new TOKEN_PRIVILEGES(1, new LUID_AND_ATTRIBUTES(luid, SE_PRIVILEGE_ENABLED));
            if (!AdjustTokenPrivileges(token, false, ref privileges, 0, IntPtr.Zero, IntPtr.Zero) || Marshal.GetLastWin32Error() != 0) { error = LastError(); return false; }
            var value = utc.UtcDateTime;
            var systemTime = new SYSTEMTIME { Year = (ushort)value.Year, Month = (ushort)value.Month, Day = (ushort)value.Day, Hour = (ushort)value.Hour, Minute = (ushort)value.Minute, Second = (ushort)value.Second, Milliseconds = (ushort)value.Millisecond };
            if (!SetSystemTime(ref systemTime)) { error = LastError(); return false; }
            return true;
        }
        finally { CloseHandle(token); }
    }
    private static string LastError() => new Win32Exception(Marshal.GetLastWin32Error()).Message;
    private const uint SE_PRIVILEGE_ENABLED = 2;
    private static class TokenAccess { internal const uint TOKEN_QUERY = 0x0008; internal const uint TOKEN_ADJUST_PRIVILEGES = 0x0020; }
    [StructLayout(LayoutKind.Sequential)] private struct LUID { internal uint LowPart; internal int HighPart; }
    [StructLayout(LayoutKind.Sequential)] private struct LUID_AND_ATTRIBUTES(LUID luid, uint attributes) { internal LUID Luid = luid; internal uint Attributes = attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct TOKEN_PRIVILEGES(uint count, LUID_AND_ATTRIBUTES privilege) { internal uint PrivilegeCount = count; internal LUID_AND_ATTRIBUTES Privileges = privilege; }
    [StructLayout(LayoutKind.Sequential)] private struct SYSTEMTIME { internal ushort Year, Month, DayOfWeek, Day, Hour, Minute, Second, Milliseconds; }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool LookupPrivilegeValue(string? systemName, string name, out LUID luid);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES newState, int bufferLength, IntPtr previousState, IntPtr returnLength);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetSystemTime(ref SYSTEMTIME systemTime);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
}

public sealed class GpsClockSynchronizer(ISerialNmeaLocationService location, ISystemClock clock)
{
    public const double MaximumAutomaticCorrectionSeconds = 300;
    public const double MaximumVerificationOffsetSeconds = 2;
    private readonly object gate = new();
    private DateTimeOffset? lastSuccess;
    private ClockSynchronizationEvidence evidence = new(ClockSynchronizationStatus.Unknown, ClockSynchronizationError.None, new(NmeaTimeStatus.Unavailable, null, "RMC"), null, null, null, null);
    public ClockSynchronizationEvidence GetEvidence() { lock (gate) return evidence; }
    public async Task<ClockSynchronizationEvidence> VerifyAsync(CancellationToken cancellationToken)
    {
        var gnss = await location.AcquireTimeAsync(cancellationToken);
        if (gnss.Status != NmeaTimeStatus.Available || gnss.TimestampUtc is null) return Set(new(ClockSynchronizationStatus.Unknown, gnss.Status == NmeaTimeStatus.Malformed ? ClockSynchronizationError.GnssStaleOrMalformed : ClockSynchronizationError.GnssUnavailable, gnss, lastSuccess, null, null, gnss.Error ?? "Fresh GNSS UTC evidence is unavailable."));
        var offset = (gnss.TimestampUtc.Value - clock.GetUtcNow()).TotalSeconds;
        var synchronized = Math.Abs(offset) <= MaximumVerificationOffsetSeconds;
        return Set(new(synchronized ? ClockSynchronizationStatus.Synchronized : ClockSynchronizationStatus.NotSynchronized, synchronized ? ClockSynchronizationError.None : ClockSynchronizationError.UnsafeOffset, gnss, lastSuccess, null, offset, synchronized ? "Windows time currently agrees with fresh GNSS UTC evidence." : $"Windows time differs from fresh GNSS UTC evidence by {offset:F1} seconds."));
    }
    public async Task<ClockSynchronizationEvidence> SynchronizeAsync(bool confirmed, CancellationToken cancellationToken)
    {
        var gnss = await location.AcquireTimeAsync(cancellationToken);
        var current = clock.GetUtcNow();
        if (!confirmed) return Set(new(ClockSynchronizationStatus.NotSynchronized, ClockSynchronizationError.ConfirmationRequired, gnss, lastSuccess, null, null, "Explicit operator confirmation is required."));
        if (gnss.Status != NmeaTimeStatus.Available || gnss.TimestampUtc is null) return Set(new(ClockSynchronizationStatus.Unknown, gnss.Status == NmeaTimeStatus.Malformed ? ClockSynchronizationError.GnssStaleOrMalformed : ClockSynchronizationError.GnssUnavailable, gnss, lastSuccess, null, null, gnss.Error ?? "Fresh GNSS UTC evidence is unavailable."));
        var offset = (gnss.TimestampUtc.Value - current).TotalSeconds;
        if (Math.Abs(offset) > MaximumAutomaticCorrectionSeconds) return Set(new(ClockSynchronizationStatus.Error, ClockSynchronizationError.UnsafeOffset, gnss, lastSuccess, offset, null, $"The requested correction of {offset:F1} seconds exceeds the {MaximumAutomaticCorrectionSeconds:F0}-second safety limit."));
        if (!clock.SetUtc(gnss.TimestampUtc.Value, out var error)) return Set(new(ClockSynchronizationStatus.Error, error?.Contains("privilege", StringComparison.OrdinalIgnoreCase) == true ? ClockSynchronizationError.PrivilegeUnavailable : ClockSynchronizationError.NativeFailure, gnss, lastSuccess, offset, null, error ?? "Windows rejected the system-time update."));
        lock (gate) lastSuccess = DateTimeOffset.UtcNow;
        return Set(new(ClockSynchronizationStatus.Synchronized, ClockSynchronizationError.None, gnss, lastSuccess, offset, 0, "Windows time was set from fresh GNSS UTC evidence."));
    }
    private ClockSynchronizationEvidence Set(ClockSynchronizationEvidence value) { lock (gate) evidence = value; return value; }
}