namespace FieldOps.ServiceControlPrototype;

public enum RestartExitCode
{
    Success = 0,
    AccessDenied = 10,
    ServiceNotInstalled = 11,
    StopTimeout = 12,
    StartRejected = 13,
    StartTimeout = 14,
    HealthUnavailable = 15,
    HealthUnhealthy = 16,
    RestartAlreadyInProgress = 17,
    UnexpectedFailure = 18,
    InvalidInvocation = 19,
    StopRejected = 20,
}
