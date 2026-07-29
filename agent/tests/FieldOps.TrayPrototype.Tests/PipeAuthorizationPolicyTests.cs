using System.Security.Principal;
using FieldOps.TrayPrototype.PipeSpike;

namespace FieldOps.TrayPrototype.Tests;

public sealed class PipeAuthorizationPolicyTests
{
    private static readonly SecurityIdentifier OperatorSid = new("S-1-5-21-100-200-300-1001");
    private readonly PipeAuthorizationPolicy policy = new(OperatorSid);

    [Fact]
    public void Explicit_operator_is_authorized() => Assert.True(policy.IsAuthorized(OperatorSid));

    [Theory]
    [InlineData(WellKnownSidType.LocalServiceSid, true)]
    [InlineData(WellKnownSidType.BuiltinAdministratorsSid, true)]
    [InlineData(WellKnownSidType.BuiltinUsersSid, false)]
    [InlineData(WellKnownSidType.AnonymousSid, false)]
    [InlineData(WellKnownSidType.NetworkSid, false)]
    [InlineData(WellKnownSidType.WorldSid, false)]
    public void Well_known_identities_follow_narrow_policy(WellKnownSidType sidType, bool expected)
    {
        var sid = new SecurityIdentifier(sidType, null);

        Assert.Equal(expected, policy.IsAuthorized(sid));
    }

    [Fact]
    public void Another_standard_local_user_is_not_authorized()
    {
        var otherUser = new SecurityIdentifier("S-1-5-21-100-200-300-1002");

        Assert.False(policy.IsAuthorized(otherUser));
    }

    [Fact]
    public void Pipe_acl_allows_only_explicit_operator_service_and_administrators()
    {
        var rules = policy.CreateSecurity()
            .GetAccessRules(includeExplicit: true, includeInherited: false, typeof(SecurityIdentifier))
            .Cast<System.IO.Pipes.PipeAccessRule>()
            .Where(rule => rule.AccessControlType == System.Security.AccessControl.AccessControlType.Allow)
            .Select(rule => (SecurityIdentifier)rule.IdentityReference)
            .ToHashSet();

        Assert.Equal(3, rules.Count);
        Assert.Contains(OperatorSid, rules);
        Assert.Contains(new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null), rules);
        Assert.Contains(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), rules);
    }

    [Fact]
    public void Pipe_acl_explicitly_denies_anonymous_and_network_tokens()
    {
        var denied = policy.CreateSecurity()
            .GetAccessRules(includeExplicit: true, includeInherited: false, typeof(SecurityIdentifier))
            .Cast<System.IO.Pipes.PipeAccessRule>()
            .Where(rule => rule.AccessControlType == System.Security.AccessControl.AccessControlType.Deny)
            .Select(rule => (SecurityIdentifier)rule.IdentityReference)
            .ToHashSet();

        Assert.Equal(2, denied.Count);
        Assert.Contains(new SecurityIdentifier(WellKnownSidType.AnonymousSid, null), denied);
        Assert.Contains(new SecurityIdentifier(WellKnownSidType.NetworkSid, null), denied);
    }

    [Fact]
    public void Prototype_does_not_assign_pipe_owner_to_an_unrelated_identity()
    {
        var owner = policy.CreateSecurity().GetOwner(typeof(SecurityIdentifier));

        Assert.Null(owner);
    }
}
