using System.ServiceProcess;

namespace FieldOps.ServiceControlPrototype;

public interface IServiceController : IDisposable
{
    ServiceControllerStatus Status { get; }

    void Refresh();

    void Stop();

    void Start();

    Task<bool> WaitForStatusAsync(
        ServiceControllerStatus desiredStatus,
        TimeSpan timeout,
        CancellationToken cancellationToken);
}

internal sealed class WindowsServiceController(string serviceName) : IServiceController
{
    private readonly ServiceController controller = new(serviceName);

    public ServiceControllerStatus Status
    {
        get
        {
            controller.Refresh();
            return controller.Status;
        }
    }

    public void Refresh() => controller.Refresh();

    public void Stop() => controller.Stop();

    public void Start() => controller.Start();

    public async Task<bool> WaitForStatusAsync(
        ServiceControllerStatus desiredStatus,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            controller.Refresh();
            if (controller.Status == desiredStatus)
            {
                return true;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(250), cancellationToken);
        }

        controller.Refresh();
        return controller.Status == desiredStatus;
    }

    public void Dispose() => controller.Dispose();
}

public interface IAgentHealthProbe
{
    Task<HealthProbeResult> ProbeAsync(CancellationToken cancellationToken);
}

public enum HealthProbeState
{
    Healthy,
    Unhealthy,
    Unavailable,
}

public sealed record HealthProbeResult(HealthProbeState State, string Detail);
