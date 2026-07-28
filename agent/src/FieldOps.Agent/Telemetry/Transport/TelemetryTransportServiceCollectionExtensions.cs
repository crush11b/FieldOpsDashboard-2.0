namespace FieldOps.Agent.Telemetry.Transport;

internal static class TelemetryTransportServiceCollectionExtensions
{
    public static IServiceCollection AddTelemetryTransportFoundation(this IServiceCollection services)
    {
        services.AddSingleton<ITelemetryTransport, InMemoryTelemetryTransport>();
        return services;
    }
}
