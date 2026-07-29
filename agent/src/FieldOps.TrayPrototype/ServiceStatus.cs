using System.ServiceProcess;

namespace FieldOps.TrayPrototype;

public interface IServiceStatusReader
{
    ServiceStatusResult Read();
}

public sealed record ServiceStatusResult(ServiceControllerStatus? Status, string Detail)
{
    public bool IsInstalled => Status is not null;
}

internal sealed class WindowsServiceStatusReader(string serviceName) : IServiceStatusReader
{
    public ServiceStatusResult Read()
    {
        try
        {
            using var controller = new ServiceController(serviceName);
            controller.Refresh();
            return new(controller.Status, $"Windows reports service state {controller.Status}.");
        }
        catch (InvalidOperationException)
        {
            return new(null, "FieldOps Agent is not installed.");
        }
    }
}
