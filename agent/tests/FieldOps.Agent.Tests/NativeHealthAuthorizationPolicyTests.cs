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
            NullLogger.Instance);

        Assert.Null(policy.OperatorSid);
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
            NullLogger.Instance);

        Assert.Null(policy.OperatorSid);
        AssertExactRules(policy.CreateSecurity(), expectedOperatorSid: null);
    }

    [Fact]
    public void ValidOperatorSidReceivesOnlyReadWriteAccess()
    {
        var operatorSid = new SecurityIdentifier("S-1-5-21-111111111-222222222-333333333-1001");
        var policy = NativeHealthAuthorizationPolicy.FromConfiguration(
            operatorSid.Value,
            NullLogger.Instance);

        Assert.Equal(operatorSid, policy.OperatorSid);
        AssertExactRules(policy.CreateSecurity(), operatorSid);
    }

    private static void AssertExactRules(PipeSecurity security, SecurityIdentifier? expectedOperatorSid)
    {
        var rules = security.GetAccessRules(
                includeExplicit: true,
                includeInherited: false,
                targetType: typeof(SecurityIdentifier))
            .Cast<PipeAccessRule>()
            .ToArray();

        AssertRule(rules, WellKnownSidType.AnonymousSid, AccessControlType.Deny, PipeAccessRights.FullControl);
        AssertRule(rules, WellKnownSidType.NetworkSid, AccessControlType.Deny, PipeAccessRights.FullControl);
        AssertRule(rules, WellKnownSidType.LocalServiceSid, AccessControlType.Allow, PipeAccessRights.FullControl);
        AssertRule(
            rules,
            WellKnownSidType.BuiltinAdministratorsSid,
            AccessControlType.Allow,
            PipeAccessRights.FullControl);

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
            var rule = Assert.Single(rules, candidate => candidate.IdentityReference == expectedOperatorSid);
            Assert.Equal(AccessControlType.Allow, rule.AccessControlType);
            Assert.Equal(
                PipeAccessRights.ReadWrite,
                rule.PipeAccessRights & PipeAccessRights.ReadWrite);
            Assert.Equal(
                (PipeAccessRights)0,
                rule.PipeAccessRights & PipeAccessRights.ChangePermissions);
            Assert.Equal(
                (PipeAccessRights)0,
                rule.PipeAccessRights & PipeAccessRights.TakeOwnership);
            Assert.Equal(5, rules.Length);
        }
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
}
