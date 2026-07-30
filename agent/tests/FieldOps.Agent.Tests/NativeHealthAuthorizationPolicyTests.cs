using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using FieldOps.Agent.Health;
using Microsoft.Extensions.Logging.Abstractions;

namespace FieldOps.Agent.Tests;

public sealed class NativeHealthAuthorizationPolicyTests
{
    [Fact]
    public void MissingOperatorSidDisablesOperatorAccessWithoutBroadFallback()
    {
        var policy = NativeHealthAuthorizationPolicy.FromConfiguration(
            null,
            NullLogger.Instance,
            new FixedSidResolver(SidAccountType.Group));

        Assert.Null(policy.OperatorSid);
        Assert.Equal(
            new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null),
            policy.ServerOwnerSid);
        AssertExactRules(policy.CreateSecurity(), expectedOperatorSid: null);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-sid")]
    [InlineData("S-1-5-invalid")]
    [InlineData("S-1-1-0")]
    [InlineData("S-1-5-32-545")]
    [InlineData("S-1-5-11")]
    public void EmptyOrInvalidOperatorSidFailsClosed(string configuredSid)
    {
        var policy = NativeHealthAuthorizationPolicy.FromConfiguration(
            configuredSid,
            NullLogger.Instance,
            new FixedSidResolver(SidAccountType.Group));

        Assert.Null(policy.OperatorSid);
        AssertExactRules(policy.CreateSecurity(), expectedOperatorSid: null);
    }

    [Fact]
    public void ResolvedOperatorGroupReceivesOnlyRequiredClientAccess()
    {
        var operatorSid = new SecurityIdentifier("S-1-5-21-111111111-222222222-333333333-1001");
        var policy = NativeHealthAuthorizationPolicy.FromConfiguration(
            operatorSid.Value,
            NullLogger.Instance,
            new FixedSidResolver(SidAccountType.Alias));

        Assert.Equal(operatorSid, policy.OperatorSid);
        AssertExactRules(policy.CreateSecurity(), operatorSid);
    }

    [Theory]
    [InlineData((int)SidAccountType.User)]
    [InlineData((int)SidAccountType.Computer)]
    [InlineData((int)SidAccountType.Domain)]
    [InlineData((int)SidAccountType.Unknown)]
    public void NonGroupAccountDomainSidFailsClosed(int accountTypeValue)
    {
        var accountType = (SidAccountType)accountTypeValue;
        var policy = NativeHealthAuthorizationPolicy.FromConfiguration(
            "S-1-5-21-111111111-222222222-333333333-1001",
            NullLogger.Instance,
            new FixedSidResolver(accountType));

        Assert.Null(policy.OperatorSid);
        AssertExactRules(policy.CreateSecurity(), expectedOperatorSid: null);
    }

    [Fact]
    public void UnresolvedAccountDomainSidFailsClosed()
    {
        var policy = NativeHealthAuthorizationPolicy.FromConfiguration(
            "S-1-5-21-111111111-222222222-333333333-1001",
            NullLogger.Instance,
            new FixedSidResolver(SidAccountType.Group, resolves: false));

        Assert.Null(policy.OperatorSid);
        AssertExactRules(policy.CreateSecurity(), expectedOperatorSid: null);
    }

    [Fact]
    public void WindowsResolverClassifiesBuiltinAdministratorsAsAlias()
    {
        var sid = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);

        Assert.True(WindowsSidAccountTypeResolver.Instance.TryGetAccountType(sid, out var accountType));
        Assert.Equal(SidAccountType.Alias, accountType);
    }

    private static void AssertExactRules(PipeSecurity security, SecurityIdentifier? expectedOperatorSid)
    {
        Assert.Equal(
            new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null),
            security.GetOwner(typeof(SecurityIdentifier)));
        var rules = security.GetAccessRules(
                includeExplicit: true,
                includeInherited: false,
                targetType: typeof(SecurityIdentifier))
            .Cast<PipeAccessRule>()
            .ToArray();

        AssertRule(rules, WellKnownSidType.AnonymousSid, AccessControlType.Deny, PipeAccessRights.FullControl);
        AssertRule(rules, WellKnownSidType.NetworkSid, AccessControlType.Deny, PipeAccessRights.FullControl);
        AssertRule(rules, WellKnownSidType.LocalServiceSid, AccessControlType.Allow, PipeAccessRights.FullControl);
        AssertClientRule(rules, new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));

        var users = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null);
        var world = new SecurityIdentifier(WellKnownSidType.WorldSid, null);
        Assert.DoesNotContain(rules, rule => rule.IdentityReference == users && rule.AccessControlType == AccessControlType.Allow);
        Assert.DoesNotContain(rules, rule => rule.IdentityReference == world && rule.AccessControlType == AccessControlType.Allow);

        if (expectedOperatorSid is null)
        {
            Assert.Equal(4, rules.Length);
        }
        else
        {
            AssertClientRule(rules, expectedOperatorSid);
            Assert.Equal(5, rules.Length);
        }
    }

    private static void AssertClientRule(PipeAccessRule[] rules, SecurityIdentifier sid)
    {
        var rule = Assert.Single(rules, candidate => candidate.IdentityReference == sid);
        Assert.Equal(AccessControlType.Allow, rule.AccessControlType);
        Assert.Equal(PipeAccessRights.ReadWrite, rule.PipeAccessRights & PipeAccessRights.ReadWrite);
        Assert.Equal(
            PipeAccessRights.ReadPermissions,
            rule.PipeAccessRights & PipeAccessRights.ReadPermissions);
        Assert.Equal((PipeAccessRights)0, rule.PipeAccessRights & PipeAccessRights.ChangePermissions);
        Assert.Equal((PipeAccessRights)0, rule.PipeAccessRights & PipeAccessRights.TakeOwnership);
        Assert.Equal((PipeAccessRights)0, rule.PipeAccessRights & PipeAccessRights.CreateNewInstance);
    }

    private static void AssertRule(
        PipeAccessRule[] rules,
        WellKnownSidType sidType,
        AccessControlType type,
        PipeAccessRights rights)
    {
        var sid = new SecurityIdentifier(sidType, null);
        var rule = Assert.Single(rules, candidate =>
            candidate.IdentityReference == sid && candidate.AccessControlType == type);
        Assert.Equal(rights, rule.PipeAccessRights);
    }

    private sealed class FixedSidResolver(SidAccountType accountType, bool resolves = true)
        : ISidAccountTypeResolver
    {
        public bool TryGetAccountType(SecurityIdentifier sid, out SidAccountType resolvedType)
        {
            resolvedType = accountType;
            return resolves;
        }
    }
}
