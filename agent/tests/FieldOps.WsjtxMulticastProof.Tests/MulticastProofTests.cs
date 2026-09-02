using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using FieldOps.WsjtxMulticastProof;

namespace FieldOps.WsjtxMulticastProof.Tests;

public sealed class MulticastProofTests
{
    [Fact]
    public void Selects_unique_operational_ipv4_addresses_and_retains_loopback()
    {
        var snapshots = new[]
        {
            new MulticastInterfaceSelector.InterfaceSnapshot(OperationalStatus.Up, NetworkInterfaceType.Wireless80211, new[] { IPAddress.Parse("192.168.0.94"), IPAddress.Parse("2001:db8::1") }),
            new MulticastInterfaceSelector.InterfaceSnapshot(OperationalStatus.Up, NetworkInterfaceType.Loopback, new[] { IPAddress.Loopback, IPAddress.Parse("192.168.0.94") }),
            new MulticastInterfaceSelector.InterfaceSnapshot(OperationalStatus.Up, NetworkInterfaceType.Tunnel, new[] { IPAddress.Parse("10.0.0.2") }),
            new MulticastInterfaceSelector.InterfaceSnapshot(OperationalStatus.Down, NetworkInterfaceType.Ethernet, new[] { IPAddress.Parse("10.0.0.3") }),
        };

        Assert.Equal(new[] { "127.0.0.1", "192.168.0.94" }, MulticastInterfaceSelector.GetEligibleAddresses(snapshots).Select(address => address.ToString()));
    }

    [Fact]
    public void Reports_partial_membership_failure_without_hiding_success()
    {
        var result = MembershipCoordinator.Establish(
            new[] { IPAddress.Parse("127.0.0.1"), IPAddress.Parse("192.168.0.94") },
            address => address.ToString() == "127.0.0.1" ? "membership denied" : null);

        Assert.Equal(new[] { "192.168.0.94" }, result.JoinedAddresses.Select(address => address.ToString()));
        Assert.Single(result.Failures);
        Assert.Equal("membership denied", result.Failures[0].Reason);
    }

    [Fact]
    public void Reports_no_memberships_when_candidates_are_empty_or_all_fail()
    {
        var empty = MembershipCoordinator.Establish(Array.Empty<IPAddress>(), _ => null);
        var denied = MembershipCoordinator.Establish(new[] { IPAddress.Loopback }, _ => "membership denied");

        Assert.Empty(empty.JoinedAddresses);
        Assert.Empty(empty.Failures);
        Assert.Empty(denied.JoinedAddresses);
        Assert.Single(denied.Failures);
    }
}
