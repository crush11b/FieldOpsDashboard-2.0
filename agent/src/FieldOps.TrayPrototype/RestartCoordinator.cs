using System.ComponentModel;
using System.Diagnostics;
using FieldOps.ServiceControlPrototype;

namespace FieldOps.TrayPrototype;

public interface IRestartCoordinator
{
    Task<TrayRestartResult> RestartAsync(CancellationToken cancellationToken);
}

public enum TrayRestartState
{
    Success,
    UacCanceled,
    AccessDenied,
    ServiceNotInstalled,
    StopTimeout,
    StartRejected,
    StartTimeout,
    HealthUnavailable,
    HealthUnhealthy,
    RestartAlreadyInProgress,
    HelperUnavailable,
    InvalidHelperInvocation,
    StopRejected,
    UnexpectedFailure,
}

public sealed record TrayRestartResult(TrayRestartState State, string Detail)
{
    public bool Succeeded => State == TrayRestartState.Success;
}

internal sealed class ElevatedRestartCoordinator(
    string helperPath,
    TimeSpan helperTimeout) : IRestartCoordinator
{
    public async Task<TrayRestartResult> RestartAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(helperPath))
        {
            return new(TrayRestartState.HelperUnavailable, "The fixed FieldOps restart helper was not found.");
        }

        Process? process;
        try
        {
            process = Process.Start(new ProcessStartInfo
            {
                FileName = helperPath,
                UseShellExecute = true,
                Verb = "runas",
                Arguments = string.Empty,
                WorkingDirectory = Path.GetDirectoryName(helperPath),
            });
        }
        catch (Win32Exception exception) when (exception.NativeErrorCode == 1223)
        {
            return new(TrayRestartState.UacCanceled, "Windows elevation was canceled.");
        }
        catch (Win32Exception exception) when (exception.NativeErrorCode == 5)
        {
            return new(TrayRestartState.AccessDenied, "Windows denied elevation for service restart.");
        }

        if (process is null)
        {
            return new(TrayRestartState.HelperUnavailable, "Windows did not start the restart helper.");
        }

        using (process)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(helperTimeout);
            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                return new(TrayRestartState.UnexpectedFailure, "The restart helper exceeded its bounded timeout.");
            }

            return MapExitCode(process.ExitCode);
        }
    }

    public static TrayRestartResult MapExitCode(int exitCode) => (RestartExitCode)exitCode switch
    {
        RestartExitCode.Success => new(TrayRestartState.Success, "FieldOps Agent restarted and authenticated health passed."),
        RestartExitCode.AccessDenied => new(TrayRestartState.AccessDenied, "Service-control access was denied."),
        RestartExitCode.ServiceNotInstalled => new(TrayRestartState.ServiceNotInstalled, "FieldOps Agent is not installed."),
        RestartExitCode.StopTimeout => new(TrayRestartState.StopTimeout, "FieldOps Agent did not stop in time."),
        RestartExitCode.StartRejected => new(TrayRestartState.StartRejected, "Windows rejected the start request."),
        RestartExitCode.StartTimeout => new(TrayRestartState.StartTimeout, "FieldOps Agent did not start in time."),
        RestartExitCode.HealthUnavailable => new(TrayRestartState.HealthUnavailable, "Service is running but authenticated health is unavailable."),
        RestartExitCode.HealthUnhealthy => new(TrayRestartState.HealthUnhealthy, "Service is running but reported unhealthy."),
        RestartExitCode.RestartAlreadyInProgress => new(TrayRestartState.RestartAlreadyInProgress, "A FieldOps Agent restart is already in progress."),
        RestartExitCode.InvalidInvocation => new(TrayRestartState.InvalidHelperInvocation, "The fixed restart helper rejected its invocation."),
        RestartExitCode.StopRejected => new(TrayRestartState.StopRejected, "Windows rejected the stop request."),
        _ => new(TrayRestartState.UnexpectedFailure, "The restart helper reported an unexpected failure."),
    };
}
