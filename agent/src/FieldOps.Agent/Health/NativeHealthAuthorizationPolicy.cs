using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.Text;

namespace FieldOps.Agent.Health;

internal sealed class NativeHealthAuthorizationPolicy(
    SecurityIdentifier? operatorSid,
    SecurityIdentifier? serverOwnerSid = null)
{
    internal const PipeAccessRights ClientRights =
        PipeAccessRights.ReadWrite | PipeAccessRights.ReadPermissions;
    private static readonly SecurityIdentifier LocalServiceSid =
        new(WellKnownSidType.LocalServiceSid, null);
    private static readonly SecurityIdentifier AdministratorsSid =
        new(WellKnownSidType.BuiltinAdministratorsSid, null);
    private static readonly SecurityIdentifier AnonymousSid =
        new(WellKnownSidType.AnonymousSid, null);
    private static readonly SecurityIdentifier NetworkSid =
        new(WellKnownSidType.NetworkSid, null);

    public SecurityIdentifier? OperatorSid { get; } = operatorSid;
    public SecurityIdentifier ServerOwnerSid { get; } = serverOwnerSid ?? LocalServiceSid;

    public static NativeHealthAuthorizationPolicy FromConfiguration(
        string? configuredOperatorSid,
        ILogger logger,
        ISidAccountTypeResolver? accountTypeResolver = null)
    {
        if (string.IsNullOrWhiteSpace(configuredOperatorSid))
        {
            logger.LogInformation("Native health operator SID is not configured; operator access is disabled");
            return new(null);
        }

        try
        {
            var operatorSid = new SecurityIdentifier(configuredOperatorSid);
            accountTypeResolver ??= WindowsSidAccountTypeResolver.Instance;
            if (operatorSid.AccountDomainSid is null
                || !accountTypeResolver.TryGetAccountType(operatorSid, out var accountType)
                || accountType is not (SidAccountType.Group or SidAccountType.Alias))
            {
                logger.LogWarning(
                    "Native health operator SID configuration does not resolve to an account-domain group; operator access is disabled");
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
        security.SetOwner(ServerOwnerSid);
        AddRule(security, AnonymousSid, PipeAccessRights.FullControl, AccessControlType.Deny);
        AddRule(security, NetworkSid, PipeAccessRights.FullControl, AccessControlType.Deny);
        AddRule(security, LocalServiceSid, PipeAccessRights.FullControl, AccessControlType.Allow);
        AddRule(security, AdministratorsSid, ClientRights, AccessControlType.Allow);

        if (OperatorSid is not null)
        {
            AddRule(
                security,
                OperatorSid,
                ClientRights,
                AccessControlType.Allow);
        }

        return security;
    }

    private static void AddRule(
        PipeSecurity security,
        SecurityIdentifier sid,
        PipeAccessRights rights,
        AccessControlType type) => security.AddAccessRule(new PipeAccessRule(sid, rights, type));
}

internal enum SidAccountType
{
    User = 1,
    Group = 2,
    Domain = 3,
    Alias = 4,
    WellKnownGroup = 5,
    DeletedAccount = 6,
    Invalid = 7,
    Unknown = 8,
    Computer = 9,
    Label = 10,
}

internal interface ISidAccountTypeResolver
{
    bool TryGetAccountType(SecurityIdentifier sid, out SidAccountType accountType);
}

internal sealed class WindowsSidAccountTypeResolver : ISidAccountTypeResolver
{
    private const int ErrorInsufficientBuffer = 122;

    public static WindowsSidAccountTypeResolver Instance { get; } = new();

    public bool TryGetAccountType(SecurityIdentifier sid, out SidAccountType accountType)
    {
        var sidBytes = new byte[sid.BinaryLength];
        sid.GetBinaryForm(sidBytes, 0);
        uint nameLength = 0;
        uint domainLength = 0;
        _ = LookupAccountSid(
            null,
            sidBytes,
            null,
            ref nameLength,
            null,
            ref domainLength,
            out accountType);
        if (Marshal.GetLastWin32Error() != ErrorInsufficientBuffer)
        {
            accountType = SidAccountType.Unknown;
            return false;
        }

        var name = new StringBuilder((int)nameLength);
        var domain = new StringBuilder((int)domainLength);
        return LookupAccountSid(
            null,
            sidBytes,
            name,
            ref nameLength,
            domain,
            ref domainLength,
            out accountType);
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LookupAccountSid(
        string? systemName,
        byte[] sid,
        StringBuilder? name,
        ref uint nameLength,
        StringBuilder? referencedDomainName,
        ref uint referencedDomainNameLength,
        out SidAccountType accountType);
}
