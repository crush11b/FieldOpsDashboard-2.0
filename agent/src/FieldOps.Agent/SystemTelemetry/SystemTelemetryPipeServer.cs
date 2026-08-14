using System.IO.Pipes;
using System.Security.AccessControl;
using System.Text.Json;
using System.Text.Json.Serialization;
using FieldOps.Agent.Health;

namespace FieldOps.Agent.SystemTelemetry;

internal sealed class SystemTelemetryPipeServer(
    WindowsSystemTelemetryProvider provider,
    NativeHealthAuthorizationPolicy authorizationPolicy,
    ILogger<SystemTelemetryPipeServer> logger,
    string pipeName = "FieldOps.SystemTelemetry.v1",
    Func<PipeSecurity>? securityFactory = null)
{
    public const string PipeName = "FieldOps.SystemTelemetry.v1";
    private static readonly JsonSerializerOptions JsonOptions = new() { Converters = { new JsonStringEnumConverter() } };
    public async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await using var pipe = NamedPipeServerStreamAcl.Create(
                    pipeName,
                    PipeDirection.InOut,
                    NamedPipeServerStream.MaxAllowedServerInstances,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous,
                    0,
                    0,
                    securityFactory?.Invoke() ?? authorizationPolicy.CreateSecurity());
                await pipe.WaitForConnectionAsync(cancellationToken);
                var observation = provider.GetObservation();
                var bytes = JsonSerializer.SerializeToUtf8Bytes(observation, JsonOptions);
                await pipe.WriteAsync(bytes, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (Exception exception)
            {
                logger.LogWarning(
                    exception,
                    "System telemetry pipe transport/provider operation failed ({ExceptionType}): {Message}",
                    exception.GetType().Name,
                    exception.Message);
                await Task.Delay(50, cancellationToken);
            }
        }
    }
}
