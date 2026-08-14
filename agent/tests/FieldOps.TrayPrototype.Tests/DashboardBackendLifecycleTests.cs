namespace FieldOps.TrayPrototype.Tests;

public sealed class DashboardBackendLifecycleTests
{
    [Fact]
    public async Task No_backend_starts_exactly_one_process_and_reaches_ready()
    {
        var probe = new FakeProbe(DashboardBackendProbeState.NotListening, DashboardBackendProbeState.Compatible);
        var factory = new FakeProcessFactory();
        await using var lifecycle = CreateLifecycle(probe, factory);

        var result = await lifecycle.EnsureReadyAsync();

        Assert.Equal(DashboardBackendState.Ready, result.State);
        Assert.True(result.OwnedByTray);
        Assert.Single(factory.Processes);
    }

    [Fact]
    public async Task Healthy_compatible_backend_is_adopted_without_starting()
    {
        var factory = new FakeProcessFactory();
        await using var lifecycle = CreateLifecycle(new FakeProbe(DashboardBackendProbeState.Compatible), factory);

        var result = await lifecycle.EnsureReadyAsync();

        Assert.Equal(DashboardBackendState.Ready, result.State);
        Assert.False(result.OwnedByTray);
        Assert.Empty(factory.Processes);
    }

    [Fact]
    public async Task Adopted_backend_is_not_terminated_on_dispose()
    {
        var factory = new FakeProcessFactory();
        await using (var lifecycle = CreateLifecycle(new FakeProbe(DashboardBackendProbeState.Compatible), factory))
        {
            await lifecycle.EnsureReadyAsync();
        }

        Assert.Empty(factory.Processes);
    }

    [Fact]
    public async Task Duplicate_ensure_calls_do_not_create_duplicate_processes()
    {
        var probe = new FakeProbe(DashboardBackendProbeState.NotListening, DashboardBackendProbeState.Compatible);
        var factory = new FakeProcessFactory();
        await using var lifecycle = CreateLifecycle(probe, factory);

        await Task.WhenAll(lifecycle.EnsureReadyAsync(), lifecycle.EnsureReadyAsync());

        Assert.Single(factory.Processes);
    }

    [Fact]
    public async Task Incompatible_responder_reports_conflict_without_starting_or_killing()
    {
        var factory = new FakeProcessFactory();
        await using var lifecycle = CreateLifecycle(
            new FakeProbe(DashboardBackendProbeState.Incompatible, "Port 3000 is occupied."),
            factory);

        var result = await lifecycle.EnsureReadyAsync();

        Assert.Equal(DashboardBackendState.Conflict, result.State);
        Assert.Empty(factory.Processes);
    }

    [Fact]
    public async Task Process_exit_before_readiness_reports_failure_and_cleans_up()
    {
        var process = new FakeProcess { HasExited = true };
        var factory = new FakeProcessFactory(process);
        await using var lifecycle = CreateLifecycle(new FakeProbe(DashboardBackendProbeState.NotListening), factory);

        var result = await lifecycle.EnsureReadyAsync();

        Assert.Equal(DashboardBackendState.Unavailable, result.State);
        Assert.True(process.Disposed);
    }

    [Fact]
    public async Task Readiness_timeout_reports_failure_and_terminates_owned_process()
    {
        var process = new FakeProcess();
        var factory = new FakeProcessFactory(process);
        await using var lifecycle = CreateLifecycle(
            new FakeProbe(DashboardBackendProbeState.NotListening),
            factory,
            new DashboardBackendLifecycleOptions { ReadinessTimeout = TimeSpan.FromMilliseconds(1) });

        var result = await lifecycle.EnsureReadyAsync();

        Assert.Equal(DashboardBackendState.Unavailable, result.State);
        Assert.True(process.Killed);
        Assert.True(process.Disposed);
    }

    [Fact]
    public async Task Owned_backend_exit_is_recovered_once()
    {
        var probe = new FakeProbe(
            DashboardBackendProbeState.NotListening,
            DashboardBackendProbeState.Compatible,
            DashboardBackendProbeState.Compatible);
        var first = new FakeProcess();
        var second = new FakeProcess();
        var factory = new FakeProcessFactory(first, second);
        await using var lifecycle = CreateLifecycle(probe, factory);
        await lifecycle.EnsureReadyAsync();

        first.RaiseExited();
        await EventuallyAsync(() => factory.Processes.Count == 2 && lifecycle.Snapshot.OwnedByTray);

        Assert.Equal(DashboardBackendState.Ready, lifecycle.Snapshot.State);
        Assert.Equal(2, factory.Processes.Count);
        Assert.True(first.Disposed);
    }

    [Fact]
    public async Task Recovery_exhaustion_reports_unavailable()
    {
        var probe = new FakeProbe(
            DashboardBackendProbeState.NotListening,
            DashboardBackendProbeState.Compatible,
            DashboardBackendProbeState.Compatible);
        var first = new FakeProcess();
        var second = new FakeProcess();
        var factory = new FakeProcessFactory(first, second);
        await using var lifecycle = CreateLifecycle(probe, factory);
        await lifecycle.EnsureReadyAsync();

        first.RaiseExited();
        await EventuallyAsync(() => factory.Processes.Count == 2 && lifecycle.Snapshot.OwnedByTray);
        second.RaiseExited();
        await EventuallyAsync(() => lifecycle.Snapshot.State == DashboardBackendState.Unavailable);

        Assert.Equal(DashboardBackendState.Unavailable, lifecycle.Snapshot.State);
        Assert.False(lifecycle.Snapshot.OwnedByTray);
    }

    [Fact]
    public async Task Open_dashboard_opens_only_after_ready()
    {
        var browser = new FakeBrowser();
        var process = new FakeProcess();
        await using var lifecycle = CreateLifecycle(
            new FakeProbe(DashboardBackendProbeState.NotListening, DashboardBackendProbeState.Compatible),
            new FakeProcessFactory(process));
        var opener = new DashboardOpenCoordinator(lifecycle, browser);

        var result = await opener.OpenAsync();

        Assert.Equal(DashboardBackendState.Ready, result.State);
        Assert.Equal("http://127.0.0.1:3000", browser.LastUrl);
    }

    [Fact]
    public async Task Open_dashboard_does_not_open_after_conflict_or_failure()
    {
        var browser = new FakeBrowser();
        await using var lifecycle = CreateLifecycle(
            new FakeProbe(DashboardBackendProbeState.Incompatible, "Conflict"),
            new FakeProcessFactory());
        var opener = new DashboardOpenCoordinator(lifecycle, browser);

        var result = await opener.OpenAsync();

        Assert.Equal(DashboardBackendState.Conflict, result.State);
        Assert.Null(browser.LastUrl);
    }

    [Fact]
    public async Task Dispose_terminates_only_owned_backend()
    {
        var process = new FakeProcess();
        await using (var lifecycle = CreateLifecycle(
            new FakeProbe(DashboardBackendProbeState.NotListening, DashboardBackendProbeState.Compatible),
            new FakeProcessFactory(process)))
        {
            await lifecycle.EnsureReadyAsync();
        }

        Assert.True(process.Killed);
        Assert.True(process.Disposed);
    }

    [Fact]
    public async Task Open_dashboard_does_not_open_when_startup_fails()
    {
        var browser = new FakeBrowser();
        var process = new FakeProcess { HasExited = true };
        await using var lifecycle = CreateLifecycle(
            new FakeProbe(DashboardBackendProbeState.NotListening),
            new FakeProcessFactory(process));
        var opener = new DashboardOpenCoordinator(lifecycle, browser);

        var result = await opener.OpenAsync();

        Assert.Equal(DashboardBackendState.Unavailable, result.State);
        Assert.Null(browser.LastUrl);
    }

    private static DashboardBackendLifecycle CreateLifecycle(
        FakeProbe probe,
        FakeProcessFactory factory,
        DashboardBackendLifecycleOptions? options = null) => new(
            probe,
            factory,
            new DashboardBackendStartInfo("node.exe", "server.cjs", "C:\\FieldOpsDashboard"),
            new NoOpDelay(),
            options ?? new DashboardBackendLifecycleOptions { ReadinessTimeout = TimeSpan.FromSeconds(1) });

    private static async Task EventuallyAsync(Func<bool> condition)
    {
        for (var attempt = 0; attempt < 100; attempt++)
        {
            if (condition()) return;
            await Task.Delay(1);
        }

        Assert.Fail("Condition did not become true within the test timeout.");
    }

    private sealed class FakeProbe(params DashboardBackendProbeState[] states) : IDashboardBackendProbe
    {
        private int index;

        public FakeProbe(DashboardBackendProbeState state, string detail)
            : this(state)
        {
            this.detail = detail;
        }

        private string? detail;

        public Task<DashboardBackendProbeResult> ProbeAsync(CancellationToken cancellationToken)
        {
            var state = states[Math.Min(index++, states.Length - 1)];
            return Task.FromResult(new DashboardBackendProbeResult(
                state,
                detail ?? (state == DashboardBackendProbeState.Incompatible ? "Port 3000 is occupied." : state.ToString())));
        }
    }

    private sealed class FakeProcessFactory(params FakeProcess[] configuredProcesses) : IDashboardBackendProcessFactory
    {
        private readonly Queue<FakeProcess> configured = new(configuredProcesses);

        public List<FakeProcess> Processes { get; } = [];

        public IDashboardBackendProcess Start(DashboardBackendStartInfo startInfo)
        {
            var process = configured.Count > 0 ? configured.Dequeue() : new FakeProcess();
            Processes.Add(process);
            return process;
        }
    }

    private sealed class FakeProcess : IDashboardBackendProcess
    {
        public bool HasExited { get; set; }

        public bool Killed { get; private set; }

        public bool Disposed { get; private set; }

        public int Id { get; } = Random.Shared.Next(1, int.MaxValue);

        public event EventHandler? Exited;

        public void Kill() => Killed = true;

        public void Dispose() => Disposed = true;

        public void RaiseExited()
        {
            HasExited = true;
            Exited?.Invoke(this, EventArgs.Empty);
        }
    }

    private sealed class NoOpDelay : IDashboardBackendDelay
    {
        public Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class FakeBrowser : IDashboardBrowser
    {
        public string? LastUrl { get; private set; }

        public void Open(string url) => LastUrl = url;
    }
}