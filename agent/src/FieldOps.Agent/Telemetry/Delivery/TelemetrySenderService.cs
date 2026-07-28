using FieldOps.Agent.Telemetry.Transport;

namespace FieldOps.Agent.Telemetry.Delivery;

internal sealed class TelemetrySenderService(
    ITelemetryTransport transport,
    ITelemetryDestination destination,
    ILogger<TelemetrySenderService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (true)
        {
            TelemetryEnvelope envelope;
            try
            {
                envelope = await transport.DequeueAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }

            try
            {
                await destination.SendAsync(envelope, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                logger.LogWarning(
                    "Telemetry delivery interrupted during shutdown; SourceId={SourceId}; SourceType={SourceType}; Status={TelemetryStatus}",
                    envelope.Source.Id,
                    envelope.Source.Type,
                    envelope.Status);
                return;
            }
            catch (Exception exception) when (exception is not OutOfMemoryException and not StackOverflowException and not AccessViolationException)
            {
                logger.LogError(
                    exception,
                    "Telemetry delivery failed; SourceId={SourceId}; SourceType={SourceType}; Status={TelemetryStatus}",
                    envelope.Source.Id,
                    envelope.Source.Type,
                    envelope.Status);
                throw;
            }
        }
    }
}
