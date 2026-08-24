using System.Net;
using System.Net.Http;
using System.Text;

namespace FieldOps.TrayPrototype.Tests;

public sealed class ProductionDashboardBackendProbeTests
{
    [Fact]
    public async Task Invalid_version_identity_does_not_open_dashboard()
    {
        var browser = new FakeBrowser();
        await using var lifecycle = CreateLifecycle([Json(HttpStatusCode.OK, "{\"sourceRevision\":\"wrong\"}")]);
        var result = await new DashboardOpenCoordinator(lifecycle, browser).OpenAsync();

        Assert.Equal(DashboardBackendState.Conflict, result.State);
        Assert.Null(browser.LastUrl);
    }

    [Fact]
    public async Task Version_identity_without_readiness_does_not_open_dashboard()
    {
        var browser = new FakeBrowser();
        await using var lifecycle = CreateLifecycle([
            Json(HttpStatusCode.OK, "{\"sourceRevision\":\"0123456789abcdef0123456789abcdef01234567\"}"),
            Json(HttpStatusCode.ServiceUnavailable, "{\"status\":\"unavailable\"}")]);
        var result = await new DashboardOpenCoordinator(lifecycle, browser).OpenAsync();

        Assert.NotEqual(DashboardBackendState.Ready, result.State);
        Assert.Null(browser.LastUrl);
    }

    [Fact]
    public async Task Valid_identity_and_readiness_open_dashboard()
    {
        var browser = new FakeBrowser();
        await using var lifecycle = CreateLifecycle([
            Json(HttpStatusCode.OK, "{\"sourceRevision\":\"0123456789abcdef0123456789abcdef01234567\"}"),
            Json(HttpStatusCode.OK, "{\"status\":\"ready\"}")]);
        var result = await new DashboardOpenCoordinator(lifecycle, browser).OpenAsync();

        Assert.Equal(DashboardBackendState.Ready, result.State);
        Assert.Equal("http://127.0.0.1:3000", browser.LastUrl);
    }

    [Fact]
    public async Task Readiness_503_is_retryable_and_bounded()
    {
        var handler = new QueueHandler([
            Json(HttpStatusCode.OK, "{\"sourceRevision\":\"0123456789abcdef0123456789abcdef01234567\"}"),
            Json(HttpStatusCode.ServiceUnavailable, "{\"status\":\"unavailable\"}")]);
        var probe = new ProductionDashboardBackendProbe(new HttpClient(handler));

        var result = await probe.ProbeAsync(CancellationToken.None);

        Assert.Equal(DashboardBackendProbeState.NotListening, result.State);
        Assert.Equal(2, handler.RequestCount);
    }

    private static DashboardBackendLifecycle CreateLifecycle(HttpResponseMessage[] responses) => new(
        new ProductionDashboardBackendProbe(new HttpClient(new QueueHandler(responses))),
        new EmptyProcessFactory(),
        new DashboardBackendStartInfo("node.exe", "server.cjs", "C:\\FieldOpsDashboard"),
        new NoOpDelay(),
        new DashboardBackendLifecycleOptions { ReadinessTimeout = TimeSpan.FromMilliseconds(10) });

    private static HttpResponseMessage Json(HttpStatusCode status, string body) => new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private sealed class QueueHandler(HttpResponseMessage[] responses) : HttpMessageHandler
    {
        private int index;
        public int RequestCount { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            return Task.FromResult(responses[Math.Min(index++, responses.Length - 1)]);
        }
    }

    private sealed class EmptyProcessFactory : IDashboardBackendProcessFactory
    {
        public IDashboardBackendProcess Start(DashboardBackendStartInfo startInfo) => throw new InvalidOperationException();
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