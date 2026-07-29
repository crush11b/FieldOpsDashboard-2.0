namespace FieldOps.Agent;

internal sealed class AgentLifecycleService(
    ILogger<AgentLifecycleService> logger,
    ServiceIdentity identity) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        logger.LogInformation(
            "Agent lifecycle event {LifecycleEvent}; Service={ServiceName}; Version={ServiceVersion}; StartedAt={StartedAt}",
            "started",
            ServiceIdentity.Name,
            identity.Version,
            identity.StartedAt);

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        logger.LogInformation(
            "Agent lifecycle event {LifecycleEvent}; Service={ServiceName}; Version={ServiceVersion}; StoppedAt={StoppedAt}",
            "stopped",
            ServiceIdentity.Name,
            identity.Version,
            DateTimeOffset.UtcNow);

        return Task.CompletedTask;
    }
}
