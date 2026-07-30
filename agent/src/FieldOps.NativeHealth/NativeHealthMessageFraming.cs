using System.Buffers.Binary;
using System.Text.Json;

namespace FieldOps.NativeHealth;

public static class NativeHealthMessageFraming
{
    public static async Task<T> ReadAsync<T>(Stream stream, CancellationToken cancellationToken)
    {
        var lengthBuffer = new byte[sizeof(int)];
        await stream.ReadExactlyAsync(lengthBuffer, cancellationToken);
        var length = BinaryPrimitives.ReadInt32LittleEndian(lengthBuffer);
        if (length <= 0 || length > NativeHealthProtocol.MaximumMessageBytes)
        {
            throw new InvalidDataException("Native health message length is outside the allowed range.");
        }

        var payload = new byte[length];
        await stream.ReadExactlyAsync(payload, cancellationToken);

        try
        {
            return JsonSerializer.Deserialize<T>(payload)
                ?? throw new InvalidDataException("Native health message was empty or invalid.");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("Native health message was malformed.", exception);
        }
    }

    public static async Task WriteAsync<T>(
        Stream stream,
        T message,
        CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(message);
        if (payload.Length <= 0 || payload.Length > NativeHealthProtocol.MaximumMessageBytes)
        {
            throw new InvalidDataException("Native health message exceeds the allowed size.");
        }

        var lengthBuffer = new byte[sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(lengthBuffer, payload.Length);
        await stream.WriteAsync(lengthBuffer, cancellationToken);
        await stream.WriteAsync(payload, cancellationToken);
        await stream.FlushAsync(cancellationToken);
    }
}
