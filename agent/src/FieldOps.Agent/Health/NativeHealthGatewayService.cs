using FieldOps.NativeHealth;

namespace FieldOps.Agent.Health;

internal sealed class NativeHealthGatewayService(
    NativeHealthGatewayServer server,
    ILogger<NativeHealthGatewayService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation(
            "Native read-only health gateway listening on the fixed local pipe using protocol version {ProtocolVersion}",
            NativeHealthProtocol.Version);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await server.ServeOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception) when (exception is IOException
                or InvalidDataException
                or UnauthorizedAccessException)
            {
                logger.LogWarning("Native health gateway request failed safely");
                await Task.Delay(TimeSpan.FromMilliseconds(250), stoppingToken);
            }
        }
    }
}
