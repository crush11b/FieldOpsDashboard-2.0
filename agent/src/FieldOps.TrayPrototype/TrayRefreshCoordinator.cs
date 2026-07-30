using System.ServiceProcess;

namespace FieldOps.TrayPrototype;

public sealed record TrayRefreshResult(
    ServiceStatusResult Service,
    AgentHealthResult Health,
    string ServiceText,
    string HealthText,
    string ToolTipText,
    bool RestartEnabled);

internal sealed class TrayRefreshCoordinator(
    IServiceStatusReader serviceStatus,
    IAgentHealthClient healthClient) : IDisposable
{
    private readonly object sync = new();
    private CancellationTokenSource? activeRefresh;
    private long generation;
    private bool disposed;

    public async Task<TrayRefreshResult?> RefreshAsync(CancellationToken cancellationToken)
    {
        CancellationTokenSource refreshCancellation;
        long refreshGeneration;
        lock (sync)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            activeRefresh?.Cancel();
            activeRefresh = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            refreshCancellation = activeRefresh;
            refreshGeneration = ++generation;
        }

        try
        {
            var serviceTask = serviceStatus.ReadAsync(refreshCancellation.Token);
            var healthTask = healthClient.ReadAsync(refreshCancellation.Token);
            await Task.WhenAll(serviceTask, healthTask);
            var service = await serviceTask;
            var health = await healthTask;

            lock (sync)
            {
                if (disposed || refreshGeneration != generation || refreshCancellation.IsCancellationRequested)
                {
                    return null;
                }

                return CreatePresentation(service, health);
            }
        }
        catch (OperationCanceledException) when (refreshCancellation.IsCancellationRequested)
        {
            return null;
        }
        finally
        {
            lock (sync)
            {
                if (ReferenceEquals(activeRefresh, refreshCancellation))
                {
                    activeRefresh = null;
                }
            }

            refreshCancellation.Dispose();
        }
    }

    public void Dispose()
    {
        lock (sync)
        {
            if (disposed)
            {
                return;
            }

            disposed = true;
            generation++;
            activeRefresh?.Cancel();
            activeRefresh = null;
        }
    }

    internal static TrayRefreshResult CreatePresentation(
        ServiceStatusResult service,
        AgentHealthResult health)
    {
        var serviceText = service.State switch
        {
            ServiceObservationState.NotInstalled => "Service: not installed",
            ServiceObservationState.Unavailable => "Service: unavailable",
            _ => $"Service: {service.Status}",
        };
        var healthText = service.Status switch
        {
            ServiceControllerStatus.Stopped => "Health: Service stopped",
            ServiceControllerStatus.StartPending => "Health: Starting",
            _ => $"Health: {HealthLabel(health.State)}",
        };
        var serviceLabel = service.State == ServiceObservationState.Available
            ? service.Status?.ToString() ?? "Unavailable"
            : service.State == ServiceObservationState.NotInstalled ? "Not installed" : "Unavailable";
        var healthLabel = service.Status switch
        {
            ServiceControllerStatus.Stopped => "Service stopped",
            ServiceControllerStatus.StartPending => "Starting",
            _ => HealthLabel(health.State),
        };

        return new(
            service,
            health,
            serviceText,
            healthText,
            $"FieldOps: {serviceLabel}; {healthLabel}",
            service.Status is not (ServiceControllerStatus.StartPending
                or ServiceControllerStatus.StopPending));
    }

    private static string HealthLabel(AgentHealthState state) => state switch
    {
        AgentHealthState.Healthy => "Healthy",
        AgentHealthState.Unhealthy => "Unavailable",
        AgentHealthState.ProtocolMismatch => "Protocol mismatch",
        AgentHealthState.Rejected => "Response rejected",
        AgentHealthState.Timeout => "Timed out",
        AgentHealthState.AccessDenied => "Access denied",
        AgentHealthState.Canceled => "Canceled",
        _ => "Unavailable",
    };
}
