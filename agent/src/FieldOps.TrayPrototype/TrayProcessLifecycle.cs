using System.Diagnostics;
using FieldOps.NativeHealth;
using FieldOps.TrayPrototype.Location;
using System.Security.Principal;
using FieldOps.TrayPrototype.Launcher;

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
        var locationBroker = new WindowsLocationBroker(
            new WindowsLocationApi(),
            new TraceWindowsLocationDiagnostics());
        var operatorSid = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("The tray operator SID is unavailable.");
        var locationPipeServer = new LocationBrokerPipeServer(
            locationBroker,
            new LocationBrokerAuthorizationPolicy(operatorSid),
            new TraceLocationBrokerDiagnostics());
        var launcherPipeServer = new LauncherPipeServer(
            new ApplicationLauncher(new ProcessApplicationExecutor()),
            new LauncherAuthorizationPolicy(operatorSid));
        var dashboardRoot = @"C:\FieldOpsDashboard";
        var nodePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "nodejs",
            "node.exe");
        var dashboardBackend = new DashboardBackendLifecycle(
            new ProductionDashboardBackendProbe(new HttpClient { Timeout = TimeSpan.FromSeconds(1) }),
            new ProductionDashboardBackendProcessFactory(),
            new DashboardBackendStartInfo(
                nodePath,
                Path.Combine(dashboardRoot, "dist", "server.cjs"),
                dashboardRoot),
            new RealDashboardBackendDelay());
        var context = new TrayApplicationContext(
            refreshCoordinator,
            new ElevatedRestartCoordinator(
                CoLocatedPaths.GetRestartHelperPath(),
                TimeSpan.FromSeconds(75)),
            locationBroker,
            locationPipeServer,
            launcherPipeServer,
            dashboardBackend,
            new DefaultDashboardBrowser());
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
