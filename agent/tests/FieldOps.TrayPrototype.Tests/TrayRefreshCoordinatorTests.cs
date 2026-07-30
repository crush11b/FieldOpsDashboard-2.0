using System.ServiceProcess;

namespace FieldOps.TrayPrototype.Tests;

public sealed class TrayRefreshCoordinatorTests
{
    [Fact]
    public async Task Running_service_and_healthy_native_result_are_both_presented()
    {
        using var coordinator = CreateCoordinator(
            Service(ServiceObservationState.Available, ServiceControllerStatus.Running),
            Health(AgentHealthState.Healthy));

        var result = await coordinator.RefreshAsync(CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(ServiceControllerStatus.Running, result.Service.Status);
        Assert.Equal(AgentHealthState.Healthy, result.Health.State);
        Assert.Equal("Service: Running", result.ServiceText);
        Assert.Equal("Health: Healthy", result.HealthText);
    }

    [Fact]
    public async Task Running_service_does_not_become_stopped_when_health_is_unavailable()
    {
        using var coordinator = CreateCoordinator(
            Service(ServiceObservationState.Available, ServiceControllerStatus.Running),
            Health(AgentHealthState.Unavailable));

        var result = await coordinator.RefreshAsync(CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(ServiceControllerStatus.Running, result.Service.Status);
        Assert.Equal("Health: Unavailable", result.HealthText);
    }

    [Fact]
    public async Task Stopped_service_is_presented_without_discarding_native_observation()
    {
        using var coordinator = CreateCoordinator(
            Service(ServiceObservationState.Available, ServiceControllerStatus.Stopped),
            Health(AgentHealthState.Unavailable));

        var result = await coordinator.RefreshAsync(CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("Health: Service stopped", result.HealthText);
        Assert.Equal(AgentHealthState.Unavailable, result.Health.State);
    }

    [Fact]
    public async Task Unavailable_scm_does_not_discard_healthy_native_observation()
    {
        using var coordinator = CreateCoordinator(
            Service(ServiceObservationState.Unavailable, null),
            Health(AgentHealthState.Healthy));

        var result = await coordinator.RefreshAsync(CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("Service: unavailable", result.ServiceText);
        Assert.Equal("Health: Healthy", result.HealthText);
    }

    [Theory]
    [InlineData(AgentHealthState.ProtocolMismatch, "Health: Protocol mismatch")]
    [InlineData(AgentHealthState.Rejected, "Health: Response rejected")]
    [InlineData(AgentHealthState.Timeout, "Health: Timed out")]
    [InlineData(AgentHealthState.AccessDenied, "Health: Access denied")]
    public async Task Running_service_preserves_distinct_native_failure_presentation(
        AgentHealthState healthState,
        string expectedText)
    {
        using var coordinator = CreateCoordinator(
            Service(ServiceObservationState.Available, ServiceControllerStatus.Running),
            Health(healthState));

        var result = await coordinator.RefreshAsync(CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(expectedText, result.HealthText);
        Assert.Equal(ServiceControllerStatus.Running, result.Service.Status);
    }

    [Fact]
    public async Task Cancellation_during_refresh_returns_no_presentation()
    {
        var service = new BlockingServiceReader();
        var health = new BlockingHealthClient();
        using var coordinator = new TrayRefreshCoordinator(service, health);
        using var cancellation = new CancellationTokenSource();

        var refresh = coordinator.RefreshAsync(cancellation.Token);
        cancellation.Cancel();

        Assert.Null(await refresh.WaitAsync(TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public async Task Immediate_shutdown_cancels_active_refresh()
    {
        var service = new BlockingServiceReader();
        var health = new BlockingHealthClient();
        var coordinator = new TrayRefreshCoordinator(service, health);

        var refresh = coordinator.RefreshAsync(CancellationToken.None);
        coordinator.Dispose();

        Assert.Null(await refresh.WaitAsync(TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public async Task New_refresh_supersedes_overlap_and_suppresses_stale_result()
    {
        var firstService = new TaskCompletionSource<ServiceStatusResult>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var firstHealth = new TaskCompletionSource<AgentHealthResult>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var service = new SequencedServiceReader(
            firstService.Task,
            Task.FromResult(Service(ServiceObservationState.Available, ServiceControllerStatus.Running)));
        var health = new SequencedHealthClient(
            firstHealth.Task,
            Task.FromResult(Health(AgentHealthState.Unavailable)));
        using var coordinator = new TrayRefreshCoordinator(service, health);

        var staleRefresh = coordinator.RefreshAsync(CancellationToken.None);
        var currentRefresh = coordinator.RefreshAsync(CancellationToken.None);
        var current = await currentRefresh.WaitAsync(TimeSpan.FromSeconds(1));
        firstService.SetResult(Service(ServiceObservationState.Available, ServiceControllerStatus.Running));
        firstHealth.SetResult(Health(AgentHealthState.Healthy));

        Assert.NotNull(current);
        Assert.Equal(AgentHealthState.Unavailable, current.Health.State);
        Assert.Null(await staleRefresh.WaitAsync(TimeSpan.FromSeconds(1)));
    }

    private static TrayRefreshCoordinator CreateCoordinator(
        ServiceStatusResult service,
        AgentHealthResult health) => new(
            new StaticServiceReader(service),
            new StaticHealthClient(health));

    private static ServiceStatusResult Service(
        ServiceObservationState state,
        ServiceControllerStatus? status) => new(state, status, "sanitized");

    private static AgentHealthResult Health(AgentHealthState state) => new(state, "sanitized");

    private sealed class StaticServiceReader(ServiceStatusResult result) : IServiceStatusReader
    {
        public Task<ServiceStatusResult> ReadAsync(CancellationToken cancellationToken) =>
            Task.FromResult(result);
    }

    private sealed class StaticHealthClient(AgentHealthResult result) : IAgentHealthClient
    {
        public Task<AgentHealthResult> ReadAsync(CancellationToken cancellationToken) =>
            Task.FromResult(result);
    }

    private sealed class BlockingServiceReader : IServiceStatusReader
    {
        public async Task<ServiceStatusResult> ReadAsync(CancellationToken cancellationToken)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            throw new InvalidOperationException();
        }
    }

    private sealed class BlockingHealthClient : IAgentHealthClient
    {
        public async Task<AgentHealthResult> ReadAsync(CancellationToken cancellationToken)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            throw new InvalidOperationException();
        }
    }

    private sealed class SequencedServiceReader(params Task<ServiceStatusResult>[] results)
        : IServiceStatusReader
    {
        private int index;

        public Task<ServiceStatusResult> ReadAsync(CancellationToken cancellationToken) =>
            results[Interlocked.Increment(ref index) - 1];
    }

    private sealed class SequencedHealthClient(params Task<AgentHealthResult>[] results)
        : IAgentHealthClient
    {
        private int index;

        public Task<AgentHealthResult> ReadAsync(CancellationToken cancellationToken) =>
            results[Interlocked.Increment(ref index) - 1];
    }
}
