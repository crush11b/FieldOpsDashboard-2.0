using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;

namespace FieldOps.TrayPrototype.Launcher;

internal static class LauncherProtocol
{
    internal const int Version = 1;
    internal const int MaximumMessageBytes = 4096;
    internal const string PipeName = "FieldOps.Tray.Launcher.v1";
    internal static readonly TimeSpan OperationTimeout = TimeSpan.FromSeconds(5);
}

internal enum LaunchType
{
    Executable = 1,
    Uri = 2,
}

internal sealed record LaunchRequest(LaunchType LaunchType, string Target);

internal enum LaunchResultCode
{
    Launched = 1,
    UriOpened = 2,
    ExecutableNotFound = 3,
    InvalidRequest = 4,
    LaunchFailed = 5,
    Busy = 6,
}

internal sealed record LaunchResponse(LaunchResultCode Result, string Detail);

internal sealed class LauncherAuthorizationPolicy(SecurityIdentifier operatorSid)
{
    private static readonly SecurityIdentifier AdministratorsSid = new(WellKnownSidType.BuiltinAdministratorsSid, null);
    private static readonly SecurityIdentifier AnonymousSid = new(WellKnownSidType.AnonymousSid, null);
    private static readonly SecurityIdentifier NetworkSid = new(WellKnownSidType.NetworkSid, null);

    internal SecurityIdentifier OperatorSid { get; } = operatorSid;

    internal PipeSecurity CreateSecurity()
    {
        var security = new PipeSecurity();
        security.SetOwner(OperatorSid);
        AddRule(security, AnonymousSid, PipeAccessRights.FullControl, AccessControlType.Deny);
        AddRule(security, NetworkSid, PipeAccessRights.FullControl, AccessControlType.Deny);
        AddRule(security, OperatorSid, PipeAccessRights.FullControl, AccessControlType.Allow);
        AddRule(security, AdministratorsSid, PipeAccessRights.ReadWrite | PipeAccessRights.ReadPermissions, AccessControlType.Allow);
        return security;
    }

    private static void AddRule(
        PipeSecurity security,
        SecurityIdentifier sid,
        PipeAccessRights rights,
        AccessControlType type) => security.AddAccessRule(new PipeAccessRule(sid, rights, type));
}