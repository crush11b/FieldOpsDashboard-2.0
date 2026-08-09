namespace FieldOps.Agent.SystemTelemetry;
public sealed class SystemTelemetryPipeService(SystemTelemetryPipeServer server) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => server.RunAsync(stoppingToken);
}
