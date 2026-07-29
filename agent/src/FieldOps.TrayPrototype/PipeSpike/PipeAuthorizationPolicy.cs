using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;

namespace FieldOps.TrayPrototype.PipeSpike;

public sealed class PipeAuthorizationPolicy(SecurityIdentifier operatorSid)
{
    private static readonly SecurityIdentifier LocalServiceSid = new(WellKnownSidType.LocalServiceSid, null);
    private static readonly SecurityIdentifier AdministratorsSid = new(WellKnownSidType.BuiltinAdministratorsSid, null);
    private static readonly SecurityIdentifier AnonymousSid = new(WellKnownSidType.AnonymousSid, null);
    private static readonly SecurityIdentifier NetworkSid = new(WellKnownSidType.NetworkSid, null);

    public SecurityIdentifier OperatorSid { get; } = operatorSid;

    public bool IsAuthorized(SecurityIdentifier sid) => sid == OperatorSid
        || sid == LocalServiceSid
        || sid == AdministratorsSid;

    public PipeSecurity CreateSecurity()
    {
        var security = new PipeSecurity();
        AddRule(security, AnonymousSid, PipeAccessRights.FullControl, AccessControlType.Deny);
        AddRule(security, NetworkSid, PipeAccessRights.FullControl, AccessControlType.Deny);
        AddAllowRule(security, LocalServiceSid, PipeAccessRights.FullControl);
        AddAllowRule(security, AdministratorsSid, PipeAccessRights.FullControl);
        AddAllowRule(security, OperatorSid, PipeAccessRights.ReadWrite);
        return security;
    }

    private static void AddAllowRule(
        PipeSecurity security,
        SecurityIdentifier sid,
        PipeAccessRights rights) => AddRule(security, sid, rights, AccessControlType.Allow);

    private static void AddRule(
        PipeSecurity security,
        SecurityIdentifier sid,
        PipeAccessRights rights,
        AccessControlType type) => security.AddAccessRule(new PipeAccessRule(sid, rights, type));
}
