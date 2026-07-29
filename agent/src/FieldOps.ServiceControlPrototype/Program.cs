using FieldOps.ServiceControlPrototype;

const string serviceName = "FieldOpsAgent";
var mutexName = $"Local\\{serviceName}.RestartPrototype";

if (args.Length != 0)
{
    return (int)RestartExitCode.InvalidInvocation;
}

using var mutex = new Mutex(initiallyOwned: true, mutexName, out var ownsMutex);
if (!ownsMutex)
{
    return (int)RestartExitCode.RestartAlreadyInProgress;
}

try
{
    using var controller = new WindowsServiceController(serviceName);
    using var httpClient = new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(5),
    };
    var operation = new ServiceRestartOperation(
        controller,
        new AgentHealthProbe(httpClient),
        transitionTimeout: TimeSpan.FromSeconds(30));
    var result = await operation.ExecuteAsync(CancellationToken.None);
    return (int)result.ExitCode;
}
catch
{
    return (int)RestartExitCode.UnexpectedFailure;
}
finally
{
    mutex.ReleaseMutex();
}
