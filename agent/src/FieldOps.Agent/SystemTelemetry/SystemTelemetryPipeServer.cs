using System.IO.Pipes;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FieldOps.Agent.SystemTelemetry;

public sealed class SystemTelemetryPipeServer(WindowsSystemTelemetryProvider provider)
{
    public const string PipeName = "FieldOps.SystemTelemetry.v1";
    private static readonly JsonSerializerOptions JsonOptions = new() { Converters = { new JsonStringEnumConverter() } };
    public async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream(PipeName, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                await pipe.WaitForConnectionAsync(cancellationToken);
                var observation = provider.GetObservation();
                var bytes = JsonSerializer.SerializeToUtf8Bytes(observation, JsonOptions);
                await pipe.WriteAsync(bytes, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch { await Task.Delay(50, cancellationToken); }
        }
    }
}
