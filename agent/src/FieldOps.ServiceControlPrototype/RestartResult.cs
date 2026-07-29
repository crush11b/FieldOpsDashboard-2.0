namespace FieldOps.ServiceControlPrototype;

public sealed record RestartResult(RestartExitCode ExitCode, string Message)
{
    public bool Succeeded => ExitCode == RestartExitCode.Success;
}
