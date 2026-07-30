using System.ServiceProcess;

namespace FieldOps.TrayPrototype;

public interface IServiceStatusReader
{
    Task<ServiceStatusResult> ReadAsync(CancellationToken cancellationToken);
}

public enum ServiceObservationState
{
    Available,
    NotInstalled,
    Unavailable,
}

public sealed record ServiceStatusResult(
    ServiceObservationState State,
    ServiceControllerStatus? Status,
    string Detail)
{
    public bool IsInstalled => State == ServiceObservationState.Available;
}

internal sealed class WindowsServiceStatusReader(string serviceName) : IServiceStatusReader
{
    public Task<ServiceStatusResult> ReadAsync(CancellationToken cancellationToken) =>
        Task.Run(Read, cancellationToken);

    private ServiceStatusResult Read()
    {
        try
        {
            using var controller = new ServiceController(serviceName);
            controller.Refresh();
            return new(
                ServiceObservationState.Available,
                controller.Status,
                $"Windows reports service state {controller.Status}.");
        }
        catch (InvalidOperationException)
        {
            return new(ServiceObservationState.NotInstalled, null, "FieldOps Agent is not installed.");
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return new(ServiceObservationState.Unavailable, null, "Windows service state is unavailable.");
        }
    }
}
