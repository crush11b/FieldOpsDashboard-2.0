using System.ComponentModel;
using System.ServiceProcess;
using FieldOps.ServiceControlPrototype;

namespace FieldOps.TrayPrototype.Tests;

public sealed class RestartOperationTests
{
    [Fact]
    public async Task Restart_requires_stopped_running_and_healthy_transitions()
    {
        var controller = new FakeController(ServiceControllerStatus.Running);
        var operation = new ServiceRestartOperation(
            controller,
            new FakeHealthProbe(HealthProbeState.Healthy),
            TimeSpan.FromSeconds(1));

        var result = await operation.ExecuteAsync(CancellationToken.None);

        Assert.Equal(RestartExitCode.Success, result.ExitCode);
        Assert.True(controller.StopCalled);
        Assert.True(controller.StartCalled);
        Assert.Equal(
            [ServiceControllerStatus.Stopped, ServiceControllerStatus.Running],
            controller.WaitedFor);
    }

    [Theory]
    [InlineData(HealthProbeState.Unavailable, RestartExitCode.HealthUnavailable)]
    [InlineData(HealthProbeState.Unhealthy, RestartExitCode.HealthUnhealthy)]
    public async Task Running_service_does_not_hide_health_failure(
        HealthProbeState healthState,
        RestartExitCode expected)
    {
        var operation = new ServiceRestartOperation(
            new FakeController(ServiceControllerStatus.Running),
            new FakeHealthProbe(healthState),
            TimeSpan.FromSeconds(1));

        var result = await operation.ExecuteAsync(CancellationToken.None);

        Assert.Equal(expected, result.ExitCode);
    }

    [Fact]
    public async Task Stop_timeout_is_distinct()
    {
        var controller = new FakeController(ServiceControllerStatus.Running)
        {
            StopTransitionSucceeds = false,
        };
        var operation = new ServiceRestartOperation(
            controller,
            new FakeHealthProbe(HealthProbeState.Healthy),
            TimeSpan.FromMilliseconds(1));

        var result = await operation.ExecuteAsync(CancellationToken.None);

        Assert.Equal(RestartExitCode.StopTimeout, result.ExitCode);
        Assert.False(controller.StartCalled);
    }

    [Fact]
    public async Task Start_rejection_is_distinct()
    {
        var controller = new FakeController(ServiceControllerStatus.Running)
        {
            StartException = new InvalidOperationException(),
        };
        var operation = new ServiceRestartOperation(
            controller,
            new FakeHealthProbe(HealthProbeState.Healthy),
            TimeSpan.FromSeconds(1));

        var result = await operation.ExecuteAsync(CancellationToken.None);

        Assert.Equal(RestartExitCode.StartRejected, result.ExitCode);
    }

    [Fact]
    public async Task Stop_rejection_is_distinct()
    {
        var controller = new FakeController(ServiceControllerStatus.Running)
        {
            StopException = new InvalidOperationException(),
        };
        var operation = new ServiceRestartOperation(
            controller,
            new FakeHealthProbe(HealthProbeState.Healthy),
            TimeSpan.FromSeconds(1));

        var result = await operation.ExecuteAsync(CancellationToken.None);

        Assert.Equal(RestartExitCode.StopRejected, result.ExitCode);
    }

    [Fact]
    public async Task Start_timeout_is_distinct()
    {
        var controller = new FakeController(ServiceControllerStatus.Running)
        {
            StartTransitionSucceeds = false,
        };
        var operation = new ServiceRestartOperation(
            controller,
            new FakeHealthProbe(HealthProbeState.Healthy),
            TimeSpan.FromMilliseconds(1));

        var result = await operation.ExecuteAsync(CancellationToken.None);

        Assert.Equal(RestartExitCode.StartTimeout, result.ExitCode);
    }

    [Fact]
    public async Task Missing_service_is_distinct()
    {
        var controller = new FakeController(ServiceControllerStatus.Stopped)
        {
            StatusException = new InvalidOperationException(),
        };
        var operation = new ServiceRestartOperation(
            controller,
            new FakeHealthProbe(HealthProbeState.Healthy),
            TimeSpan.FromSeconds(1));

        var result = await operation.ExecuteAsync(CancellationToken.None);

        Assert.Equal(RestartExitCode.ServiceNotInstalled, result.ExitCode);
    }

    [Fact]
    public async Task Access_denial_is_distinct()
    {
        var controller = new FakeController(ServiceControllerStatus.Running)
        {
            StatusException = new Win32Exception(5),
        };
        var operation = new ServiceRestartOperation(
            controller,
            new FakeHealthProbe(HealthProbeState.Healthy),
            TimeSpan.FromSeconds(1));

        var result = await operation.ExecuteAsync(CancellationToken.None);

        Assert.Equal(RestartExitCode.AccessDenied, result.ExitCode);
    }

    private sealed class FakeController(ServiceControllerStatus status) : IServiceController
    {
        private ServiceControllerStatus status = status;

        public bool StopCalled { get; private set; }
        public bool StartCalled { get; private set; }
        public bool StopTransitionSucceeds { get; init; } = true;
        public bool StartTransitionSucceeds { get; init; } = true;
        public Exception? StartException { get; init; }
        public Exception? StopException { get; init; }
        public Exception? StatusException { get; init; }
        public List<ServiceControllerStatus> WaitedFor { get; } = [];

        public ServiceControllerStatus Status
        {
            get
            {
                if (StatusException is not null)
                {
                    throw StatusException;
                }

                return status;
            }
        }

        public void Refresh()
        {
        }

        public void Stop()
        {
            if (StopException is not null)
            {
                throw StopException;
            }

            StopCalled = true;
        }

        public void Start()
        {
            if (StartException is not null)
            {
                throw StartException;
            }

            StartCalled = true;
        }

        public Task<bool> WaitForStatusAsync(
            ServiceControllerStatus desiredStatus,
            TimeSpan timeout,
            CancellationToken cancellationToken)
        {
            WaitedFor.Add(desiredStatus);
            if (desiredStatus == ServiceControllerStatus.Stopped && !StopTransitionSucceeds)
            {
                return Task.FromResult(false);
            }

            if (desiredStatus == ServiceControllerStatus.Running && !StartTransitionSucceeds)
            {
                return Task.FromResult(false);
            }

            status = desiredStatus;
            return Task.FromResult(true);
        }

        public void Dispose()
        {
        }
    }

    private sealed class FakeHealthProbe(HealthProbeState state) : IAgentHealthProbe
    {
        public Task<HealthProbeResult> ProbeAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new HealthProbeResult(state, state.ToString()));
    }
}
