using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FieldOps.TestSupport;

namespace FieldOps.Agent.Tests;

public sealed class HealthEndpointTests : IClassFixture<AgentWebApplicationFactory>
{
    private readonly AgentWebApplicationFactory factory;

    public HealthEndpointTests(AgentWebApplicationFactory factory)
    {
        this.factory = factory;
    }

    [Fact]
    public async Task ValidBearerReturnsHealthWithoutCorsHeaders()
    {
        using var client = factory.CreateClient();
        using var request = AuthenticatedRequest(HttpMethod.Get, "/api/v1/health");
        using var response = await client.SendAsync(request);
        var health = await response.Content.ReadFromJsonAsync<HealthDocument>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull(health);
        Assert.Equal("ok", health.Status);
        Assert.Equal("FieldOpsAgent", health.Service);
        Assert.StartsWith(
            CanonicalProductMetadata.Load().Version,
            health.Version,
            StringComparison.Ordinal);
        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task MissingBearerIsUnauthorized()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/api/v1/health");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task InvalidBearerIsUnauthorized()
    {
        using var client = factory.CreateClient();
        using var request = AuthenticatedRequest(HttpMethod.Get, "/api/v1/health", new string('A', 44));
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("Basic abc")]
    [InlineData("Bearer")]
    [InlineData("Bearer abc def")]
    [InlineData("Bearer short")]
    public async Task MalformedBearerIsUnauthorized(string authorization)
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/health");
        request.Headers.TryAddWithoutValidation("Authorization", authorization);
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task DuplicateAuthorizationHeadersAreUnauthorized()
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/health");
        request.Headers.TryAddWithoutValidation(
            "Authorization",
            new[] { $"Bearer {AgentWebApplicationFactory.Token}", $"Bearer {AgentWebApplicationFactory.Token}" });
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("https://example.invalid")]
    [InlineData("null")]
    public async Task OriginHeaderIsRejected(string origin)
    {
        using var client = factory.CreateClient();
        using var request = AuthenticatedRequest(HttpMethod.Get, "/api/v1/health");
        request.Headers.TryAddWithoutValidation("Origin", origin);
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task AuthenticatedUnknownRouteIsNotFound()
    {
        using var client = factory.CreateClient();
        using var request = AuthenticatedRequest(HttpMethod.Get, "/api/v1/not-found");
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task AuthenticatedPostIsMethodNotAllowed()
    {
        using var client = factory.CreateClient();
        using var request = AuthenticatedRequest(HttpMethod.Post, "/api/v1/health");
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    }

    private static HttpRequestMessage AuthenticatedRequest(
        HttpMethod method,
        string path,
        string token = AgentWebApplicationFactory.Token)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return request;
    }

    private sealed record HealthDocument(string Status, string Service, string Version);
}
