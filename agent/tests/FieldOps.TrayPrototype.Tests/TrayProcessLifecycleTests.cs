namespace FieldOps.TrayPrototype.Tests;

public sealed class TrayProcessLifecycleTests
{
    [Fact]
    public void Primary_lifecycle_runs_host_once_and_disposes_resources()
    {
        var lease = new TrackingDisposable();
        var host = new FakeHost();
        var factory = new FakeHostFactory(host);
        var diagnostics = new FakeDiagnostics();
        var lifecycle = CreateLifecycle(Acquired(lease), factory, diagnostics);

        var exitCode = lifecycle.Run();

        Assert.Equal(TrayProcessExitCode.Success, exitCode);
        Assert.Equal(1, factory.CreateCount);
        Assert.Equal(1, host.StartCount);
        Assert.Equal(1, host.RunCount);
        Assert.True(host.Disposed);
        Assert.Equal(1, host.DisposeCount);
        Assert.Equal(1, lease.DisposeCount);
        Assert.Equal(0, diagnostics.FailureCount);
    }

    [Fact]
    public void Duplicate_exits_before_constructing_tray_or_refresh_infrastructure()
    {
        var acquisition = new TrayInstanceAcquisition(TrayInstanceAcquisitionState.Duplicate);
        var factory = new FakeHostFactory(new FakeHost());
        var lifecycle = CreateLifecycle(
            acquisition,
            factory,
            new FakeDiagnostics());

        var exitCode = lifecycle.Run();

        Assert.Equal(TrayProcessExitCode.DuplicateInstance, exitCode);
        Assert.Equal(10, (int)exitCode);
        Assert.Equal(0, factory.CreateCount);
        Assert.Null(acquisition.Lease);
    }

    [Fact]
    public void Startup_exception_disposes_host_and_instance_ownership()
    {
        var lease = new TrackingDisposable();
        var host = new FakeHost { StartException = new InvalidOperationException("test") };
        var diagnostics = new FakeDiagnostics();
        var lifecycle = CreateLifecycle(Acquired(lease), new FakeHostFactory(host), diagnostics);

        var exitCode = lifecycle.Run();

        Assert.Equal(TrayProcessExitCode.LifecycleFailure, exitCode);
        Assert.Equal(20, (int)exitCode);
        Assert.True(host.Disposed);
        Assert.Equal(1, host.DisposeCount);
        Assert.False(host.ResourceActive);
        Assert.Equal(1, lease.DisposeCount);
        Assert.Equal(1, diagnostics.FailureCount);
    }

    [Fact]
    public void Factory_exception_releases_instance_without_leaving_a_host()
    {
        var lease = new TrackingDisposable();
        var factory = new FakeHostFactory(new InvalidOperationException("test"));
        var diagnostics = new FakeDiagnostics();
        var lifecycle = CreateLifecycle(Acquired(lease), factory, diagnostics);

        var exitCode = lifecycle.Run();

        Assert.Equal(TrayProcessExitCode.LifecycleFailure, exitCode);
        Assert.Equal(1, lease.DisposeCount);
        Assert.Equal(1, diagnostics.FailureCount);
    }

    [Fact]
    public void Message_loop_failure_disposes_partially_running_host_and_lease()
    {
        var lease = new TrackingDisposable();
        var host = new FakeHost { RunException = new InvalidOperationException("test") };
        var diagnostics = new FakeDiagnostics();
        var lifecycle = CreateLifecycle(Acquired(lease), new FakeHostFactory(host), diagnostics);

        var exitCode = lifecycle.Run();

        Assert.Equal(TrayProcessExitCode.LifecycleFailure, exitCode);
        Assert.True(host.Disposed);
        Assert.Equal(1, host.DisposeCount);
        Assert.False(host.ResourceActive);
        Assert.Equal(1, lease.DisposeCount);
        Assert.Equal(1, diagnostics.FailureCount);
    }

    [Fact]
    public void Acquisition_failure_returns_typed_failure_without_constructing_host()
    {
        var acquisition = new TrayInstanceAcquisition(TrayInstanceAcquisitionState.Failed);
        var factory = new FakeHostFactory(new FakeHost());
        var diagnostics = new FakeDiagnostics();
        var lifecycle = CreateLifecycle(
            acquisition,
            factory,
            diagnostics);

        var exitCode = lifecycle.Run();

        Assert.Equal(TrayProcessExitCode.LifecycleFailure, exitCode);
        Assert.Equal(0, factory.CreateCount);
        Assert.Equal(1, diagnostics.FailureCount);
        Assert.Null(acquisition.Lease);
    }

    private static TrayProcessLifecycle CreateLifecycle(
        TrayInstanceAcquisition acquisition,
        ITrayApplicationHostFactory factory,
        ITrayLifecycleDiagnostics diagnostics) => new(
            new FakeInstanceGate(acquisition),
            factory,
            diagnostics);

    private static TrayInstanceAcquisition Acquired(IDisposable lease) =>
        new(TrayInstanceAcquisitionState.Acquired, lease);

    private sealed class FakeInstanceGate(TrayInstanceAcquisition acquisition) : ITrayInstanceGate
    {
        public TrayInstanceAcquisition TryAcquire() => acquisition;
    }

    private sealed class FakeHostFactory : ITrayApplicationHostFactory
    {
        private readonly FakeHost? host;
        private readonly Exception? exception;

        public FakeHostFactory(FakeHost host) => this.host = host;

        public FakeHostFactory(Exception exception) => this.exception = exception;

        public int CreateCount { get; private set; }

        public ITrayApplicationHost Create()
        {
            CreateCount++;
            if (exception is not null)
            {
                throw exception;
            }

            return host!;
        }
    }

    private sealed class FakeHost : ITrayApplicationHost
    {
        public Exception? StartException { get; init; }

        public Exception? RunException { get; init; }

        public int StartCount { get; private set; }

        public int RunCount { get; private set; }

        public bool ResourceActive { get; private set; } = true;

        public bool Disposed { get; private set; }

        public int DisposeCount { get; private set; }

        public void Start()
        {
            StartCount++;
            if (StartException is not null)
            {
                throw StartException;
            }
        }

        public void Run()
        {
            RunCount++;
            if (RunException is not null)
            {
                throw RunException;
            }
        }

        public void Dispose()
        {
            DisposeCount++;
            Disposed = true;
            ResourceActive = false;
        }
    }

    private sealed class TrackingDisposable : IDisposable
    {
        public int DisposeCount { get; private set; }

        public void Dispose() => DisposeCount++;
    }

    private sealed class FakeDiagnostics : ITrayLifecycleDiagnostics
    {
        public int FailureCount { get; private set; }

        public void LifecycleFailed() => FailureCount++;
    }
}
