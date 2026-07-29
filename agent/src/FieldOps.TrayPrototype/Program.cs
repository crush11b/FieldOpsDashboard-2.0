namespace FieldOps.TrayPrototype;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        const string serviceName = "FieldOpsAgent";
        ApplicationConfiguration.Initialize();

        using var httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        var context = new TrayApplicationContext(
            new WindowsServiceStatusReader(serviceName),
            new LoopbackAgentHealthClient(httpClient),
            new ElevatedRestartCoordinator(
                CoLocatedPrototypePaths.GetRestartHelperPath(),
                TimeSpan.FromSeconds(75)));
        context.Start();
        Application.Run(context);
    }
}
