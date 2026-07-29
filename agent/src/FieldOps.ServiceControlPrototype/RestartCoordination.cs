using System.Security.AccessControl;
using System.Security.Principal;

namespace FieldOps.ServiceControlPrototype;

public enum RestartCoordinationState
{
    Acquired,
    AlreadyInProgress,
    AccessDenied,
}

public sealed class RestartCoordination : IDisposable
{
    public const string MutexName = "Global\\FieldOpsAgent.RestartPrototype";

    private readonly Mutex? mutex;
    private readonly int? ownerThreadId;
    private bool ownsMutex;

    private RestartCoordination(
        Mutex? mutex,
        RestartCoordinationState state,
        bool ownsMutex = false,
        int? ownerThreadId = null)
    {
        this.mutex = mutex;
        State = state;
        this.ownsMutex = ownsMutex;
        this.ownerThreadId = ownerThreadId;
    }

    public RestartCoordinationState State { get; }

    public static RestartCoordination TryAcquire()
    {
        Mutex mutex;
        try
        {
            mutex = MutexAcl.Create(
                initiallyOwned: false,
                MutexName,
                out _,
                CreateSecurity());
        }
        catch (UnauthorizedAccessException)
        {
            return new RestartCoordination(null, RestartCoordinationState.AccessDenied);
        }

        try
        {
            try
            {
                if (!mutex.WaitOne(TimeSpan.Zero))
                {
                    return new RestartCoordination(mutex, RestartCoordinationState.AlreadyInProgress);
                }
            }
            catch (AbandonedMutexException)
            {
                // WaitOne grants ownership when reporting an abandoned mutex.
            }

            return new RestartCoordination(
                mutex,
                RestartCoordinationState.Acquired,
                ownsMutex: true,
                ownerThreadId: Environment.CurrentManagedThreadId);
        }
        catch
        {
            mutex.Dispose();
            throw;
        }
    }

    public static MutexSecurity CreateSecurity()
    {
        var administrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
        var localSystem = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        var currentIdentity = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("The restart helper identity does not have a user SID.");
        var security = new MutexSecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        security.SetOwner(currentIdentity);
        security.AddAccessRule(new MutexAccessRule(
            administrators,
            MutexRights.FullControl,
            AccessControlType.Allow));
        security.AddAccessRule(new MutexAccessRule(
            localSystem,
            MutexRights.FullControl,
            AccessControlType.Allow));
        security.AddAccessRule(new MutexAccessRule(
            currentIdentity,
            MutexRights.FullControl,
            AccessControlType.Allow));
        return security;
    }

    public void Dispose()
    {
        if (ownsMutex && ownerThreadId == Environment.CurrentManagedThreadId)
        {
            mutex!.ReleaseMutex();
            ownsMutex = false;
        }

        mutex?.Dispose();
    }
}
