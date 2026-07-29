using FieldOps.ServiceControlPrototype;

const string serviceName = "FieldOpsAgent";

if (args.Length != 0)
{
    return (int)RestartExitCode.InvalidInvocation;
}

using var restartCoordination = RestartCoordination.TryAcquire();
if (restartCoordination.State == RestartCoordinationState.AlreadyInProgress)
{
    return (int)RestartExitCode.RestartAlreadyInProgress;
}
if (restartCoordination.State != RestartCoordinationState.Acquired)
{
    return (int)RestartExitCode.UnexpectedFailure;
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
    // A Windows mutex is thread-affine. Keep acquisition, the bounded operation,
    // and release on this thread while asynchronous I/O completes underneath it.
    var result = operation.ExecuteAsync(CancellationToken.None).GetAwaiter().GetResult();
    return (int)result.ExitCode;
}
catch
{
    return (int)RestartExitCode.UnexpectedFailure;
}
