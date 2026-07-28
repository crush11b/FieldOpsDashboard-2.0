using FieldOps.Agent.Telemetry.Delivery;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace FieldOps.Agent.Tests;

public sealed class TelemetrySenderRegistrationTests : IClassFixture<AgentWebApplicationFactory>
{
    private readonly AgentWebApplicationFactory factory;

    public TelemetrySenderRegistrationTests(AgentWebApplicationFactory factory)
    {
        this.factory = factory;
    }

    [Fact]
    public void ProductionHostKeepsTelemetrySenderDormant()
    {
        var hostedServices = factory.Services.GetServices<IHostedService>().ToArray();

        Assert.Contains(hostedServices, service => service is AgentLifecycleService);
        Assert.DoesNotContain(hostedServices, service => service is TelemetrySenderService);
        Assert.Empty(factory.Services.GetServices<ITelemetryDestination>());
    }
}
