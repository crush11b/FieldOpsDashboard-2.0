namespace FieldOps.TrayPrototype;

internal static class Program
{
    [STAThread]
    private static int Main() => (int)new TrayProcessLifecycle(
        new WindowsTrayInstanceGate(),
        new DefaultTrayApplicationHostFactory(),
        new TraceTrayLifecycleDiagnostics()).Run();
}
