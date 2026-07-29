using System.ComponentModel;
using System.ServiceProcess;

namespace FieldOps.ServiceControlPrototype;

public sealed class ServiceRestartOperation(
    IServiceController controller,
    IAgentHealthProbe healthProbe,
    TimeSpan transitionTimeout)
{
    public async Task<RestartResult> ExecuteAsync(CancellationToken cancellationToken)
    {
        try
        {
            _ = controller.Status;
        }
        catch (InvalidOperationException)
        {
            return new(RestartExitCode.ServiceNotInstalled, "FieldOps Agent is not installed.");
        }
        catch (Win32Exception exception) when (exception.NativeErrorCode == 5)
        {
            return new(RestartExitCode.AccessDenied, "Access to FieldOps Agent service control was denied.");
        }

        try
        {
            if (controller.Status != ServiceControllerStatus.Stopped)
            {
                try
                {
                    controller.Stop();
                }
                catch (Win32Exception exception) when (exception.NativeErrorCode == 5)
                {
                    return new(RestartExitCode.AccessDenied, "Access to stop FieldOps Agent was denied.");
                }
                catch (Exception exception) when (exception is InvalidOperationException or Win32Exception)
                {
                    return new(RestartExitCode.StopRejected, "Windows rejected the FieldOps Agent stop request.");
                }

                if (!await controller.WaitForStatusAsync(
                        ServiceControllerStatus.Stopped,
                        transitionTimeout,
                        cancellationToken))
                {
                    return new(RestartExitCode.StopTimeout, "FieldOps Agent did not stop before the timeout.");
                }
            }

            try
            {
                controller.Start();
            }
            catch (Win32Exception exception) when (exception.NativeErrorCode == 5)
            {
                return new(RestartExitCode.AccessDenied, "Access to start FieldOps Agent was denied.");
            }
            catch (Exception exception) when (exception is InvalidOperationException or Win32Exception)
            {
                return new(RestartExitCode.StartRejected, "Windows rejected the FieldOps Agent start request.");
            }

            if (!await controller.WaitForStatusAsync(
                    ServiceControllerStatus.Running,
                    transitionTimeout,
                    cancellationToken))
            {
                return new(RestartExitCode.StartTimeout, "FieldOps Agent did not start before the timeout.");
            }

            var health = await healthProbe.ProbeAsync(cancellationToken);
            return health.State switch
            {
                HealthProbeState.Healthy => new(RestartExitCode.Success, "FieldOps Agent restarted and is healthy."),
                HealthProbeState.Unhealthy => new(RestartExitCode.HealthUnhealthy, health.Detail),
                _ => new(RestartExitCode.HealthUnavailable, health.Detail),
            };
        }
        catch (Win32Exception exception) when (exception.NativeErrorCode == 5)
        {
            return new(RestartExitCode.AccessDenied, "Access to FieldOps Agent service control was denied.");
        }
        catch (OperationCanceledException)
        {
            return new(RestartExitCode.UnexpectedFailure, "The restart operation was canceled.");
        }
    }
}
