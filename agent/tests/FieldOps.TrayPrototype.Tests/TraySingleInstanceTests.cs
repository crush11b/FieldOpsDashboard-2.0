using System.Collections.Concurrent;
using System.Security.AccessControl;
using System.Security.Principal;

namespace FieldOps.TrayPrototype.Tests;

public sealed class TraySingleInstanceTests
{
    [Fact]
    public void Production_mutex_uses_fixed_local_session_namespace()
    {
        Assert.Equal("Local\\FieldOps.Tray.Instance.v1", WindowsTrayInstanceGate.MutexName);
    }

    [Fact]
    public void Production_mutex_applies_protected_acl_to_named_kernel_object()
    {
        var mutexName = $"Local\\FieldOps.Tray.Tests.{Guid.NewGuid():N}";
        var currentUser = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("Current identity has no SID.");
        var localSystem = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        var world = new SecurityIdentifier(WellKnownSidType.WorldSid, null);
        var builtinUsers = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null);
        var builtinAdministrators = new SecurityIdentifier(
            WellKnownSidType.BuiltinAdministratorsSid,
            null);
        var acquisition = new WindowsTrayInstanceGate(mutexName).TryAcquire();

        Assert.Equal(TrayInstanceAcquisitionState.Acquired, acquisition.State);
        using var lease = Assert.IsAssignableFrom<IDisposable>(acquisition.Lease);

        using var openedMutex = MutexAcl.OpenExisting(
            mutexName,
            MutexRights.ReadPermissions | MutexRights.Synchronize | MutexRights.Modify);
        var appliedSecurity = openedMutex.GetAccessControl();
        var rules = appliedSecurity
            .GetAccessRules(includeExplicit: true, includeInherited: false, typeof(SecurityIdentifier))
            .Cast<MutexAccessRule>()
            .ToArray();
        var inheritedRules = appliedSecurity
            .GetAccessRules(includeExplicit: false, includeInherited: true, typeof(SecurityIdentifier))
            .Cast<MutexAccessRule>()
            .ToArray();

        Assert.True(appliedSecurity.AreAccessRulesProtected);
        Assert.Equal(currentUser, appliedSecurity.GetOwner(typeof(SecurityIdentifier)));
        Assert.Equal(2, rules.Length);
        Assert.Empty(inheritedRules);
        Assert.All(rules, rule => Assert.Equal(AccessControlType.Allow, rule.AccessControlType));
        Assert.All(rules, rule => Assert.Equal(MutexRights.FullControl, rule.MutexRights));
        Assert.Contains(rules, rule => currentUser.Equals(rule.IdentityReference));
        Assert.Contains(rules, rule => localSystem.Equals(rule.IdentityReference));
        Assert.DoesNotContain(rules, rule => world.Equals(rule.IdentityReference));
        Assert.DoesNotContain(rules, rule => builtinUsers.Equals(rule.IdentityReference));
        Assert.DoesNotContain(rules, rule => builtinAdministrators.Equals(rule.IdentityReference));
    }

    [Fact]
    public void First_acquisition_succeeds_and_release_permits_later_acquisition()
    {
        var gate = CreateGate();
        var first = gate.TryAcquire();

        Assert.Equal(TrayInstanceAcquisitionState.Acquired, first.State);
        Assert.NotNull(first.Lease);
        first.Lease.Dispose();

        var later = gate.TryAcquire();
        Assert.Equal(TrayInstanceAcquisitionState.Acquired, later.State);
        later.Lease!.Dispose();
    }

    [Fact]
    public void Second_acquisition_in_same_session_is_duplicate()
    {
        var gate = CreateGate();
        var primary = gate.TryAcquire();

        var duplicate = AcquireOnDedicatedThread(gate);

        Assert.Equal(TrayInstanceAcquisitionState.Acquired, primary.State);
        Assert.Equal(TrayInstanceAcquisitionState.Duplicate, duplicate);
        primary.Lease!.Dispose();
    }

    [Fact]
    public void Two_concurrent_attempts_produce_exactly_one_owner()
    {
        var gate = CreateGate();
        using var start = new Barrier(3);
        using var attemptsFinished = new CountdownEvent(2);
        using var releaseOwner = new ManualResetEventSlim();
        var states = new ConcurrentBag<TrayInstanceAcquisitionState>();
        var threads = Enumerable.Range(0, 2).Select(_ => new Thread(() =>
        {
            start.SignalAndWait();
            var result = gate.TryAcquire();
            states.Add(result.State);
            attemptsFinished.Signal();
            if (result.State == TrayInstanceAcquisitionState.Acquired)
            {
                releaseOwner.Wait(TimeSpan.FromSeconds(5));
                result.Lease!.Dispose();
            }
        })).ToArray();

        foreach (var thread in threads)
        {
            thread.Start();
        }

        start.SignalAndWait();
        Assert.True(attemptsFinished.Wait(TimeSpan.FromSeconds(5)));
        Assert.Single(states, state => state == TrayInstanceAcquisitionState.Acquired);
        Assert.Single(states, state => state == TrayInstanceAcquisitionState.Duplicate);
        releaseOwner.Set();
        Assert.All(threads, thread => Assert.True(thread.Join(TimeSpan.FromSeconds(5))));
    }

    [Fact]
    public void Abandoned_owner_does_not_permanently_block_later_acquisition()
    {
        var gate = CreateGate();
        var ownerAcquired = new ManualResetEventSlim();
        TrayInstanceAcquisition? abandoned = null;
        var owner = new Thread(() =>
        {
            abandoned = gate.TryAcquire();
            if (abandoned.State == TrayInstanceAcquisitionState.Acquired)
            {
                ownerAcquired.Set();
            }
        });
        owner.Start();
        Assert.True(owner.Join(TimeSpan.FromSeconds(5)));
        Assert.Equal(TrayInstanceAcquisitionState.Acquired, abandoned!.State);
        Assert.True(ownerAcquired.IsSet);

        var recoveryDeadline = DateTime.UtcNow + TimeSpan.FromSeconds(2);
        TrayInstanceAcquisition? recovered = null;
        while (DateTime.UtcNow < recoveryDeadline)
        {
            var attempt = gate.TryAcquire();
            if (attempt.State == TrayInstanceAcquisitionState.Acquired)
            {
                recovered = attempt;
                break;
            }

            Assert.Equal(TrayInstanceAcquisitionState.Duplicate, attempt.State);
            Thread.Sleep(10);
        }

        Assert.True(
            recovered is not null,
            "The abandoned mutex was not recoverable before the bounded deadline.");
        recovered.Lease!.Dispose();
        abandoned.Lease!.Dispose();
    }

    private static WindowsTrayInstanceGate CreateGate() =>
        new($"Local\\FieldOps.Tray.Tests.{Guid.NewGuid():N}");

    private static TrayInstanceAcquisitionState AcquireOnDedicatedThread(ITrayInstanceGate gate)
    {
        var state = TrayInstanceAcquisitionState.Failed;
        var thread = new Thread(() =>
        {
            var result = gate.TryAcquire();
            state = result.State;
            result.Lease?.Dispose();
        });
        thread.Start();
        Assert.True(thread.Join(TimeSpan.FromSeconds(5)));
        return state;
    }
}
