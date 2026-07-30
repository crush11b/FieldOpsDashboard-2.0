using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;

namespace FieldOps.Agent.Health;

internal sealed class NativeHealthAuthorizationPolicy(SecurityIdentifier? operatorSid)
{
    private static readonly SecurityIdentifier LocalServiceSid =
        new(WellKnownSidType.LocalServiceSid, null);
    private static readonly SecurityIdentifier AdministratorsSid =
        new(WellKnownSidType.BuiltinAdministratorsSid, null);
    private static readonly SecurityIdentifier AnonymousSid =
        new(WellKnownSidType.AnonymousSid, null);
    private static readonly SecurityIdentifier NetworkSid =
        new(WellKnownSidType.NetworkSid, null);

    public SecurityIdentifier? OperatorSid { get; } = operatorSid;

    public static NativeHealthAuthorizationPolicy FromConfiguration(
        string? configuredOperatorSid,
        ILogger logger)
    {
        if (string.IsNullOrWhiteSpace(configuredOperatorSid))
        {
            logger.LogInformation("Native health operator SID is not configured; operator access is disabled");
            return new(null);
        }

        try
        {
            var operatorSid = new SecurityIdentifier(configuredOperatorSid);
            if (operatorSid.AccountDomainSid is null)
            {
                logger.LogWarning(
                    "Native health operator SID configuration is not an account-domain SID; operator access is disabled");
                return new(null);
            }

            return new(operatorSid);
        }
        catch (ArgumentException)
        {
            logger.LogWarning("Native health operator SID configuration is invalid; operator access is disabled");
            return new(null);
        }
    }

    public PipeSecurity CreateSecurity()
    {
        var security = new PipeSecurity();
        AddRule(security, AnonymousSid, PipeAccessRights.FullControl, AccessControlType.Deny);
        AddRule(security, NetworkSid, PipeAccessRights.FullControl, AccessControlType.Deny);
        AddRule(security, LocalServiceSid, PipeAccessRights.FullControl, AccessControlType.Allow);
        AddRule(security, AdministratorsSid, PipeAccessRights.FullControl, AccessControlType.Allow);

        if (OperatorSid is not null)
        {
            AddRule(security, OperatorSid, PipeAccessRights.ReadWrite, AccessControlType.Allow);
        }

        return security;
    }

    private static void AddRule(
        PipeSecurity security,
        SecurityIdentifier sid,
        PipeAccessRights rights,
        AccessControlType type) => security.AddAccessRule(new PipeAccessRule(sid, rights, type));
}
