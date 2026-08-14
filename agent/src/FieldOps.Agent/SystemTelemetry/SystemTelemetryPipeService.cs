namespace FieldOps.Agent.SystemTelemetry;
internal sealed class SystemTelemetryPipeService(SystemTelemetryPipeServer server) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => server.RunAsync(stoppingToken);
}
