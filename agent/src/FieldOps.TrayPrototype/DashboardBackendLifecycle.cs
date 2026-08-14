using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FieldOps.TrayPrototype;

internal enum DashboardBackendState
{
    Stopped,
    Starting,
    Ready,
    Conflict,
    Unavailable,
}

internal enum DashboardBackendProbeState
{
    NotListening,
    Compatible,
    Incompatible,
}

internal sealed record DashboardBackendProbeResult(
    DashboardBackendProbeState State,
    string Detail);

internal sealed record DashboardBackendSnapshot(
    DashboardBackendState State,
    string Detail,
    bool OwnedByTray);

internal sealed record DashboardBackendStartInfo(
    string ExecutablePath,
    string ServerPath,
    string WorkingDirectory);

internal interface IDashboardBackendProcess : IDisposable
{
    int Id { get; }

    bool HasExited { get; }

    event EventHandler? Exited;

    void Kill();
}

internal interface IDashboardBackendProcessFactory
{
    IDashboardBackendProcess Start(DashboardBackendStartInfo startInfo);
}

internal interface IDashboardBackendProbe
{
    Task<DashboardBackendProbeResult> ProbeAsync(CancellationToken cancellationToken);
}

internal interface IDashboardBackendDelay
{
    Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken);
}

internal interface IDashboardBackendLifecycle : IAsyncDisposable
{
    DashboardBackendSnapshot Snapshot { get; }

    Task<DashboardBackendSnapshot> EnsureReadyAsync(CancellationToken cancellationToken = default);
}

internal sealed class DashboardBackendLifecycleOptions
{
    internal static readonly TimeSpan DefaultReadinessTimeout = TimeSpan.FromSeconds(60);

    internal TimeSpan ReadinessTimeout { get; init; } = DefaultReadinessTimeout;

    internal TimeSpan ProbeInterval { get; init; } = TimeSpan.FromMilliseconds(250);

    internal int MaximumRecoveryAttempts { get; init; } = 1;
}

internal sealed class DashboardBackendLifecycle(
    IDashboardBackendProbe probe,
    IDashboardBackendProcessFactory processFactory,
    DashboardBackendStartInfo startInfo,
    IDashboardBackendDelay delay,
    DashboardBackendLifecycleOptions? options = null) : IDashboardBackendLifecycle
{
    private readonly DashboardBackendLifecycleOptions options = options ?? new();
    private readonly SemaphoreSlim gate = new(1, 1);
    private IDashboardBackendProcess? ownedProcess;
    private DashboardBackendSnapshot snapshot = new(DashboardBackendState.Stopped, "Dashboard backend is stopped.", false);
    private int recoveryAttempts;
    private bool shutdownStarted;

    public DashboardBackendSnapshot Snapshot => snapshot;

    public async Task<DashboardBackendSnapshot> EnsureReadyAsync(CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (snapshot.State == DashboardBackendState.Ready)
            {
                return snapshot;
            }

            if (shutdownStarted)
            {
                return SetSnapshot(DashboardBackendState.Unavailable, "Dashboard backend lifecycle is shutting down.", owned: false);
            }

            var current = await probe.ProbeAsync(cancellationToken);
            if (current.State == DashboardBackendProbeState.Compatible)
            {
                return SetSnapshot(DashboardBackendState.Ready, "Dashboard backend is ready.", owned: false);
            }

            if (current.State == DashboardBackendProbeState.Incompatible)
            {
                return SetSnapshot(DashboardBackendState.Conflict, current.Detail, owned: false);
            }

            return await StartAndWaitAsync(cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await gate.WaitAsync();
        try
        {
            shutdownStarted = true;
            var process = ownedProcess;
            ownedProcess = null;
            snapshot = new(DashboardBackendState.Stopped, "Dashboard backend is stopped.", false);
            if (process is not null)
            {
                await StopOwnedProcessAsync(process);
            }
        }
        finally
        {
            gate.Release();
            gate.Dispose();
        }
    }

    private async Task<DashboardBackendSnapshot> StartAndWaitAsync(CancellationToken cancellationToken)
    {
        SetSnapshot(DashboardBackendState.Starting, "Starting Dashboard backend.", owned: false);
        IDashboardBackendProcess process;
        try
        {
            process = processFactory.Start(startInfo);
        }
        catch (Exception exception)
        {
            return SetSnapshot(DashboardBackendState.Unavailable, $"Dashboard backend could not start: {exception.Message}", owned: false);
        }

        ownedProcess = process;
        process.Exited += OwnedProcessExited;
        try
        {
            var deadline = DateTime.UtcNow + options.ReadinessTimeout;
            while (DateTime.UtcNow < deadline)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (process.HasExited)
                {
                    ownedProcess = null;
                    process.Exited -= OwnedProcessExited;
                    process.Dispose();
                    return SetSnapshot(DashboardBackendState.Unavailable, "Dashboard backend exited before becoming ready.", owned: false);
                }

                var result = await probe.ProbeAsync(cancellationToken);
                if (result.State == DashboardBackendProbeState.Compatible)
                {
                    return SetSnapshot(DashboardBackendState.Ready, "Dashboard backend is ready.", owned: true);
                }

                if (result.State == DashboardBackendProbeState.Incompatible)
                {
                    await StopOwnedProcessAsync(process);
                    ownedProcess = null;
                    return SetSnapshot(DashboardBackendState.Conflict, result.Detail, owned: false);
                }

                await delay.DelayAsync(options.ProbeInterval, cancellationToken);
            }

            await StopOwnedProcessAsync(process);
            ownedProcess = null;
            return SetSnapshot(DashboardBackendState.Unavailable, "Dashboard backend did not become ready before the bounded startup timeout.", owned: false);
        }
        catch (OperationCanceledException)
        {
            await StopOwnedProcessAsync(process);
            ownedProcess = null;
            return SetSnapshot(DashboardBackendState.Unavailable, "Dashboard backend startup was cancelled.", owned: false);
        }
        catch (Exception exception)
        {
            await StopOwnedProcessAsync(process);
            ownedProcess = null;
            return SetSnapshot(DashboardBackendState.Unavailable, $"Dashboard backend readiness failed: {exception.Message}", owned: false);
        }
    }

    private void OwnedProcessExited(object? sender, EventArgs args)
    {
        _ = RecoverOwnedProcessAsync();
    }

    private async Task RecoverOwnedProcessAsync()
    {
        await gate.WaitAsync();
        try
        {
            if (shutdownStarted || ownedProcess is null || recoveryAttempts >= options.MaximumRecoveryAttempts)
            {
                if (!shutdownStarted && ownedProcess is not null)
                {
                    ownedProcess.Dispose();
                    ownedProcess = null;
                    SetSnapshot(DashboardBackendState.Unavailable, "Dashboard backend stopped and recovery is exhausted.", owned: false);
                }
                return;
            }

            recoveryAttempts++;
            var exitedProcess = ownedProcess;
            ownedProcess = null;
            exitedProcess.Exited -= OwnedProcessExited;
            exitedProcess.Dispose();
            await StartAndWaitAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            SetSnapshot(DashboardBackendState.Unavailable, $"Dashboard backend recovery failed: {exception.Message}", owned: false);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task StopOwnedProcessAsync(IDashboardBackendProcess process)
    {
        process.Exited -= OwnedProcessExited;
        if (!process.HasExited)
        {
            process.Kill();
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(2);
            while (!process.HasExited && DateTime.UtcNow < deadline)
            {
                await delay.DelayAsync(TimeSpan.FromMilliseconds(25), CancellationToken.None);
            }
        }

        process.Dispose();
    }

    private DashboardBackendSnapshot SetSnapshot(DashboardBackendState state, string detail, bool owned) =>
        snapshot = new(state, detail, owned);
}

internal sealed class ProductionDashboardBackendProbe(HttpClient httpClient) : IDashboardBackendProbe
{
    public async Task<DashboardBackendProbeResult> ProbeAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var response = await httpClient.GetAsync("http://127.0.0.1:3000/api/version", cancellationToken);
            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                return new(DashboardBackendProbeState.Incompatible, "Port 3000 is occupied by an incompatible HTTP service.");
            }

            if (!response.IsSuccessStatusCode)
            {
                return new(DashboardBackendProbeState.Incompatible, "Port 3000 responded without a healthy FieldOps Dashboard endpoint.");
            }

            var version = await response.Content.ReadFromJsonAsync<DashboardVersionResponse>(cancellationToken);
            if (version?.SourceRevision is null || !IsCommitSha(version.SourceRevision))
            {
                return new(DashboardBackendProbeState.Incompatible, "Port 3000 responded without a compatible FieldOps Dashboard identity.");
            }

            return new(DashboardBackendProbeState.Compatible, "FieldOps Dashboard backend is responding.");
        }
        catch (HttpRequestException)
        {
            return new(DashboardBackendProbeState.NotListening, "No Dashboard backend is listening on port 3000.");
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new(DashboardBackendProbeState.NotListening, "Dashboard backend probe timed out.");
        }
        catch (JsonException)
        {
            return new(DashboardBackendProbeState.Incompatible, "Port 3000 responded with an incompatible Dashboard identity.");
        }
    }

    private static bool IsCommitSha(string value) => value.Length == 40 && value.All(Uri.IsHexDigit);

    private sealed record DashboardVersionResponse(
        [property: JsonPropertyName("sourceRevision")] string? SourceRevision);
}

internal sealed class ProductionDashboardBackendProcessFactory : IDashboardBackendProcessFactory
{
    public IDashboardBackendProcess Start(DashboardBackendStartInfo startInfo)
    {
        var processStartInfo = new ProcessStartInfo
        {
            FileName = startInfo.ExecutablePath,
            WorkingDirectory = startInfo.WorkingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        processStartInfo.ArgumentList.Add(startInfo.ServerPath);
        var process = Process.Start(processStartInfo);
        if (process is null)
        {
            throw new InvalidOperationException("Windows did not create the Dashboard backend process.");
        }

        process.EnableRaisingEvents = true;
        return new ProductionDashboardBackendProcess(process);
    }

    private sealed class ProductionDashboardBackendProcess(Process process) : IDashboardBackendProcess
    {
        public int Id => process.Id;

        public bool HasExited => process.HasExited;

        public event EventHandler? Exited
        {
            add => process.Exited += value;
            remove => process.Exited -= value;
        }

        public void Kill()
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: false);
            }
        }

        public void Dispose() => process.Dispose();
    }
}

internal sealed class RealDashboardBackendDelay : IDashboardBackendDelay
{
    public Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken) =>
        Task.Delay(delay, cancellationToken);
}

internal interface IDashboardBrowser
{
    void Open(string url);
}

internal sealed class DefaultDashboardBrowser : IDashboardBrowser
{
    public void Open(string url) => Process.Start(new ProcessStartInfo
    {
        FileName = url,
        UseShellExecute = true,
    });
}

internal sealed class DashboardOpenCoordinator(
    IDashboardBackendLifecycle backendLifecycle,
    IDashboardBrowser browser)
{
    internal async Task<DashboardBackendSnapshot> OpenAsync(CancellationToken cancellationToken = default)
    {
        var result = await backendLifecycle.EnsureReadyAsync(cancellationToken);
        if (result.State == DashboardBackendState.Ready)
        {
            browser.Open("http://127.0.0.1:3000");
        }

        return result;
    }
}
