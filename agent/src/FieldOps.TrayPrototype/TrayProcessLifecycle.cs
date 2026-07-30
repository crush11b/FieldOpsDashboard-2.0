using System.Diagnostics;
using FieldOps.NativeHealth;

namespace FieldOps.TrayPrototype;

internal enum TrayProcessExitCode
{
    Success = 0,
    DuplicateInstance = 10,
    LifecycleFailure = 20,
}

internal interface ITrayApplicationHost : IDisposable
{
    void Start();

    void Run();
}

internal interface ITrayApplicationHostFactory
{
    ITrayApplicationHost Create();
}

internal interface ITrayLifecycleDiagnostics
{
    void LifecycleFailed();
}

internal sealed class TrayProcessLifecycle(
    ITrayInstanceGate instanceGate,
    ITrayApplicationHostFactory hostFactory,
    ITrayLifecycleDiagnostics diagnostics)
{
    public TrayProcessExitCode Run()
    {
        TrayInstanceAcquisition acquisition;
        try
        {
            acquisition = instanceGate.TryAcquire();
        }
        catch (Exception)
        {
            diagnostics.LifecycleFailed();
            return TrayProcessExitCode.LifecycleFailure;
        }

        if (acquisition.State == TrayInstanceAcquisitionState.Duplicate)
        {
            return TrayProcessExitCode.DuplicateInstance;
        }

        if (acquisition.State != TrayInstanceAcquisitionState.Acquired || acquisition.Lease is null)
        {
            diagnostics.LifecycleFailed();
            acquisition.Lease?.Dispose();
            return TrayProcessExitCode.LifecycleFailure;
        }

        using (acquisition.Lease)
        {
            try
            {
                using var host = hostFactory.Create();
                host.Start();
                host.Run();
                return TrayProcessExitCode.Success;
            }
            catch (Exception)
            {
                diagnostics.LifecycleFailed();
                return TrayProcessExitCode.LifecycleFailure;
            }
        }
    }
}

internal sealed class DefaultTrayApplicationHostFactory : ITrayApplicationHostFactory
{
    public ITrayApplicationHost Create()
    {
        const string serviceName = "FieldOpsAgent";
        ApplicationConfiguration.Initialize();
        var refreshCoordinator = new TrayRefreshCoordinator(
            new WindowsServiceStatusReader(serviceName),
            new NativeAgentHealthClient(new SharedNativeHealthReader(new NativeHealthClient())));
        var context = new TrayApplicationContext(
            refreshCoordinator,
            new ElevatedRestartCoordinator(
                CoLocatedPrototypePaths.GetRestartHelperPath(),
                TimeSpan.FromSeconds(75)));
        return new WindowsFormsTrayApplicationHost(context);
    }
}

internal sealed class WindowsFormsTrayApplicationHost(TrayApplicationContext context)
    : ITrayApplicationHost
{
    public void Start() => context.Start();

    public void Run() => Application.Run(context);

    public void Dispose() => context.Dispose();
}

internal sealed class TraceTrayLifecycleDiagnostics : ITrayLifecycleDiagnostics
{
    public void LifecycleFailed() =>
        Trace.TraceError("FieldOps tray lifecycle failed.");
}
