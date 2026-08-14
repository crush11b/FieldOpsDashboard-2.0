using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using FieldOps.Agent.Location;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace FieldOps.Agent.Tests;

public sealed class LocationEndpointTests : IClassFixture<AgentWebApplicationFactory>
{
    private readonly AgentWebApplicationFactory factory;

    public LocationEndpointTests(AgentWebApplicationFactory factory)
    {
        this.factory = factory;
    }

    [Fact]
    public async Task EndpointSerializesObservationAsJsonWithHonestNulls()
    {
        var observedAt = new DateTimeOffset(2026, 8, 6, 15, 0, 0, TimeSpan.Zero);
        var observation = new LocationObservation(
            35.1234,
            -80.5678,
            null,
            4.2,
            null,
            null,
            observedAt,
            LocationStatus.Available);
        using var testFactory = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ILocationProvider>();
                services.AddSingleton<ILocationProvider>(new FakeLocationProvider(observation));
            }));
        using var client = testFactory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/location");
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            AgentWebApplicationFactory.Token);

        using var response = await client.SendAsync(request);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(35.1234, root.GetProperty("latitude").GetDouble());
        Assert.Equal(-80.5678, root.GetProperty("longitude").GetDouble());
        Assert.Equal(JsonValueKind.Null, root.GetProperty("altitude").ValueKind);
        Assert.Equal(4.2, root.GetProperty("horizontalAccuracy").GetDouble());
        Assert.Equal(JsonValueKind.Null, root.GetProperty("speed").ValueKind);
        Assert.Equal(JsonValueKind.Null, root.GetProperty("heading").ValueKind);
        Assert.Equal(observedAt, root.GetProperty("timestampUtc").GetDateTimeOffset());
        Assert.Equal("Available", root.GetProperty("status").GetString());
    }

    [Fact]
    public async Task NmeaEndpointRequiresAuthAndSerializesSourceAndNulls()
    {
        var observation = LocationObservation.WithoutTelemetry(LocationStatus.NoFix) with { Source = "SerialNmea" };
        using var testFactory = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<SerialNmeaLocationProvider>();
            services.AddSingleton(new SerialNmeaLocationProvider(
                Microsoft.Extensions.Logging.Abstractions.NullLogger<SerialNmeaLocationProvider>.Instance,
                "COM6", 9600, TimeSpan.FromMilliseconds(1), () => new EndpointReader()));
        }));
        using var client = testFactory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/location/nmea")).StatusCode);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/location/nmea"); request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AgentWebApplicationFactory.Token);
        using var response = await client.SendAsync(request); var root = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("Initializing", root.GetProperty("status").GetString()); Assert.Equal("SerialNmea", root.GetProperty("source").GetString()); Assert.Equal(JsonValueKind.Null, root.GetProperty("latitude").ValueKind); Assert.DoesNotContain("$GP", await response.Content.ReadAsStringAsync());
    }

    private sealed class FakeLocationProvider(LocationObservation observation) : ILocationProvider
    {
        public Task<LocationObservation> GetLocationAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(observation);
        }
    }

    private sealed class EndpointReader : INmeaSerialReader { public void Open() { } public Task<string?> ReadLineAsync(CancellationToken cancellationToken) => Task.FromResult<string?>(null); public void Dispose() { } }
}
