using System.Security.AccessControl;
using System.Security.Principal;

namespace FieldOps.TrayPrototype;

internal enum TrayInstanceAcquisitionState
{
    Acquired,
    Duplicate,
    Failed,
}

internal sealed record TrayInstanceAcquisition(
    TrayInstanceAcquisitionState State,
    IDisposable? Lease = null);

internal interface ITrayInstanceGate
{
    TrayInstanceAcquisition TryAcquire();
}

internal sealed class WindowsTrayInstanceGate(
    string mutexName = WindowsTrayInstanceGate.MutexName) : ITrayInstanceGate
{
    public const string MutexName = "Local\\FieldOps.Tray.Instance.v1";

    public TrayInstanceAcquisition TryAcquire()
    {
        Mutex mutex;
        try
        {
            mutex = MutexAcl.Create(
                initiallyOwned: false,
                mutexName,
                out _,
                CreateSecurity());
        }
        catch (Exception exception) when (exception is UnauthorizedAccessException
            or IOException
            or InvalidOperationException)
        {
            return new(TrayInstanceAcquisitionState.Failed);
        }

        try
        {
            var acquired = false;
            try
            {
                acquired = mutex.WaitOne(TimeSpan.Zero);
            }
            catch (AbandonedMutexException)
            {
                acquired = true;
            }

            if (!acquired)
            {
                mutex.Dispose();
                return new(TrayInstanceAcquisitionState.Duplicate);
            }

            return new(
                TrayInstanceAcquisitionState.Acquired,
                new MutexLease(mutex, Environment.CurrentManagedThreadId));
        }
        catch
        {
            mutex.Dispose();
            throw;
        }
    }

    internal static MutexSecurity CreateSecurity()
    {
        var currentUser = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("The tray identity does not have a user SID.");
        var localSystem = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        var security = new MutexSecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        security.SetOwner(currentUser);
        security.AddAccessRule(new MutexAccessRule(
            currentUser,
            MutexRights.FullControl,
            AccessControlType.Allow));
        security.AddAccessRule(new MutexAccessRule(
            localSystem,
            MutexRights.FullControl,
            AccessControlType.Allow));
        return security;
    }

    private sealed class MutexLease(Mutex mutex, int ownerThreadId) : IDisposable
    {
        private bool ownsMutex = true;

        public void Dispose()
        {
            if (ownsMutex && Environment.CurrentManagedThreadId == ownerThreadId)
            {
                mutex.ReleaseMutex();
                ownsMutex = false;
            }

            mutex.Dispose();
        }
    }
}
