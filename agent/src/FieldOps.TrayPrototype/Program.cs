namespace FieldOps.TrayPrototype;

using FieldOps.NativeHealth;

internal static class Program
{
    [STAThread]
    private static void Main()
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
        context.Start();
        Application.Run(context);
    }
}
