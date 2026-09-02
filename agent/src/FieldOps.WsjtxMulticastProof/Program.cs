using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace FieldOps.WsjtxMulticastProof;

internal static class Program
{
    private static async Task<int> Main()
    {
        using var cancellation = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            cancellation.Cancel();
        };

        var group = IPAddress.Parse(ReceiverSettings.MulticastAddress);
        using var receiver = new MulticastReceiver(group, ReceiverSettings.Port);
        Console.WriteLine($"BOUND 0.0.0.0:{ReceiverSettings.Port}");
        Console.WriteLine($"GROUP {group}:{ReceiverSettings.Port}");
        var result = receiver.JoinEligibleInterfaces();
        foreach (var failure in result.Failures) Console.WriteLine($"JOIN FAILED {failure.Address}: {failure.Reason}");
        foreach (var address in result.JoinedAddresses) Console.WriteLine($"JOINED {address}");
        if (result.JoinedAddresses.Count == 0)
        {
            Console.WriteLine("NO MULTICAST MEMBERSHIPS ESTABLISHED");
            return 2;
        }

        Console.WriteLine("LISTENING; press Ctrl+C to stop");
        try
        {
            await receiver.ReceiveAsync(cancellation.Token);
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
        {
        }
        return 0;
    }
}

internal static class ReceiverSettings
{
    internal const string MulticastAddress = "239.255.0.0";
    internal const int Port = 2237;
}

internal sealed record MembershipFailure(IPAddress Address, string Reason);
internal sealed record MembershipResult(IReadOnlyList<IPAddress> JoinedAddresses, IReadOnlyList<MembershipFailure> Failures);

internal static class MulticastInterfaceSelector
{
    internal sealed record InterfaceSnapshot(OperationalStatus Status, NetworkInterfaceType Type, IReadOnlyList<IPAddress> Addresses);

    internal static IReadOnlyList<IPAddress> GetEligibleAddresses(IEnumerable<InterfaceSnapshot> interfaces)
    {
        return interfaces
            .Where(networkInterface => networkInterface.Status == OperationalStatus.Up && networkInterface.Type != NetworkInterfaceType.Tunnel)
            .SelectMany(networkInterface => networkInterface.Addresses)
            .Where(address => address.AddressFamily == AddressFamily.InterNetwork)
            .Distinct()
            .OrderBy(address => address.ToString(), StringComparer.Ordinal)
            .ToArray();
    }
}

internal static class MembershipCoordinator
{
    internal static MembershipResult Establish(IEnumerable<IPAddress> candidates, Func<IPAddress, string?> join)
    {
        var joined = new List<IPAddress>();
        var failures = new List<MembershipFailure>();
        foreach (var address in candidates.Distinct())
        {
            var failure = join(address);
            if (failure is null) joined.Add(address);
            else failures.Add(new MembershipFailure(address, failure));
        }
        return new MembershipResult(joined, failures);
    }
}

internal sealed class MulticastReceiver : IDisposable
{
    private readonly UdpClient client;
    private readonly IPAddress group;
    private readonly int port;
    private readonly List<IPAddress> joinedAddresses = [];

    internal MulticastReceiver(IPAddress group, int port)
    {
        this.group = group;
        this.port = port;
        client = new UdpClient(AddressFamily.InterNetwork);
        client.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
        client.Client.Bind(new IPEndPoint(IPAddress.Any, port));
    }

    internal MembershipResult JoinEligibleInterfaces(IEnumerable<MulticastInterfaceSelector.InterfaceSnapshot>? interfaces = null)
    {
        var snapshots = interfaces ?? NetworkInterface.GetAllNetworkInterfaces().Select(networkInterface =>
            new MulticastInterfaceSelector.InterfaceSnapshot(
                networkInterface.OperationalStatus,
                networkInterface.NetworkInterfaceType,
                networkInterface.GetIPProperties().UnicastAddresses.Select(unicast => unicast.Address).ToArray()));
        var result = MembershipCoordinator.Establish(MulticastInterfaceSelector.GetEligibleAddresses(snapshots), address =>
        {
            try
            {
                client.JoinMulticastGroup(group, address);
                return null;
            }
            catch (Exception error) when (error is SocketException or ArgumentException or InvalidOperationException)
            {
                return error.Message;
            }
        });
        joinedAddresses.AddRange(result.JoinedAddresses);
        return result;
    }

    internal async Task ReceiveAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var packet = await client.ReceiveAsync(cancellationToken);
            Console.WriteLine($"{DateTimeOffset.UtcNow:O} PACKET {packet.Buffer.Length} bytes FROM {packet.RemoteEndPoint.Address}:{packet.RemoteEndPoint.Port}");
        }
    }

    public void Dispose()
    {
        foreach (var address in joinedAddresses)
        {
            try { client.Client.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.DropMembership, new MulticastOption(group, address)); } catch (SocketException) { }
        }
        joinedAddresses.Clear();
        client.Dispose();
    }
}
