using System.Buffers.Binary;
using System.Reflection;
using System.Text;
using FieldOps.NativeHealth;

namespace FieldOps.Agent.Tests;

public sealed class NativeHealthProtocolTests
{
    [Fact]
    public void ContractIsFixedAndContainsNoCredentialMaterial()
    {
        Assert.Equal(1, NativeHealthProtocol.Version);
        Assert.Equal("FieldOps.Agent.NativeHealth.v1", NativeHealthProtocol.PipeName);
        Assert.Equal(4096, NativeHealthProtocol.MaximumMessageBytes);
        Assert.Equal([NativeHealthRequestType.ReadHealth], Enum.GetValues<NativeHealthRequestType>());

        var names = typeof(NativeHealthRequest).Assembly
            .GetTypes()
            .Where(type => type.Namespace == typeof(NativeHealthProtocol).Namespace)
            .SelectMany(type => type.GetProperties(BindingFlags.Instance | BindingFlags.Public))
            .Select(property => property.Name)
            .ToArray();

        Assert.DoesNotContain(names, name => name.Contains("Credential", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("Token", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("Url", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("Path", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("ServiceName", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task FramingRoundTripsAValidRequest()
    {
        var request = new NativeHealthRequest(
            NativeHealthProtocol.Version,
            Guid.NewGuid(),
            NativeHealthRequestType.ReadHealth);
        await using var stream = new MemoryStream();

        await NativeHealthMessageFraming.WriteAsync(stream, request, CancellationToken.None);
        stream.Position = 0;
        var actual = await NativeHealthMessageFraming.ReadAsync<NativeHealthRequest>(
            stream,
            CancellationToken.None);

        Assert.Equal(request, actual);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(NativeHealthProtocol.MaximumMessageBytes + 1)]
    public async Task FramingRejectsInvalidLengths(int length)
    {
        var header = new byte[sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(header, length);
        await using var stream = new MemoryStream(header);

        await Assert.ThrowsAsync<InvalidDataException>(
            () => NativeHealthMessageFraming.ReadAsync<NativeHealthRequest>(
                stream,
                CancellationToken.None));
    }

    [Fact]
    public async Task FramingRejectsMalformedJson()
    {
        var payload = Encoding.UTF8.GetBytes("{");
        var message = new byte[sizeof(int) + payload.Length];
        BinaryPrimitives.WriteInt32LittleEndian(message, payload.Length);
        payload.CopyTo(message.AsSpan(sizeof(int)));
        await using var stream = new MemoryStream(message);

        await Assert.ThrowsAsync<InvalidDataException>(
            () => NativeHealthMessageFraming.ReadAsync<NativeHealthRequest>(
                stream,
                CancellationToken.None));
    }

    [Fact]
    public async Task FramingRejectsUnknownRequestMembers()
    {
        var correlationId = Guid.NewGuid();
        var payload = Encoding.UTF8.GetBytes(
            $$"""{"ProtocolVersion":1,"CorrelationId":"{{correlationId}}","RequestType":1,"Command":"restart"}""");
        var message = new byte[sizeof(int) + payload.Length];
        BinaryPrimitives.WriteInt32LittleEndian(message, payload.Length);
        payload.CopyTo(message.AsSpan(sizeof(int)));
        await using var stream = new MemoryStream(message);

        await Assert.ThrowsAsync<InvalidDataException>(
            () => NativeHealthMessageFraming.ReadAsync<NativeHealthRequest>(
                stream,
                CancellationToken.None));
    }

    [Fact]
    public async Task FramingRejectsOversizedPayload()
    {
        var payload = new string('x', NativeHealthProtocol.MaximumMessageBytes + 1);
        await using var stream = new MemoryStream();

        await Assert.ThrowsAsync<InvalidDataException>(
            () => NativeHealthMessageFraming.WriteAsync(
                stream,
                payload,
                CancellationToken.None));
    }
}
