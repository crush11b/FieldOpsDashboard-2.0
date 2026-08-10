using System.Net;
using FieldOps.Agent;
using FieldOps.Agent.Health;
using FieldOps.Agent.Security;
using FieldOps.Agent.Telemetry.Transport;
using FieldOps.Agent.Serial;
using FieldOps.Agent.Location;
using FieldOps.Agent.SystemTelemetry;
using System.Text.Json.Serialization;
using FieldOps.NativeHealth;
using Microsoft.Extensions.Logging.EventLog;

const string serviceName = "FieldOpsAgent";
const int servicePort = 43120;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseWindowsService(options => options.ServiceName = serviceName);

builder.Logging.AddEventLog(new EventLogSettings
{
    SourceName = serviceName,
    LogName = "Application",
});

builder.WebHost.ConfigureKestrel(options =>
{
    options.AddServerHeader = false;
    options.Listen(IPAddress.Loopback, servicePort);
});

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<ServiceIdentity>();
builder.Services.AddSingleton<AgentCredentialProvider>();
builder.Services.AddSingleton<ISerialMetadataProvider, WmiSerialMetadataProvider>();
builder.Services.AddSingleton<ISerialPortEnumerator, WindowsSerialPortEnumerator>();
builder.Services.AddSingleton<SerialInventoryPipeServer>();
builder.Services.AddSingleton<ILocationProvider, WindowsSensorLocationProvider>();
builder.Services.AddSingleton<SerialNmeaLocationProvider>();
builder.Services.AddSingleton<ISerialNmeaLocationService, SerialNmeaLocationService>();
builder.Services.AddSingleton<LocationTelemetryPipeServer>();
builder.Services.AddSingleton<IPhysicalBatteryEnumerator, WindowsPhysicalBatteryEnumerator>();
builder.Services.AddSingleton<WindowsSystemTelemetryProvider>(sp => new WindowsSystemTelemetryProvider(new WindowsPowerStatus(), sp.GetRequiredService<IPhysicalBatteryEnumerator>()));
builder.Services.AddSingleton<SystemTelemetryPipeServer>();
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddSingleton<INativeHealthSnapshotProvider, NativeHealthSnapshotProvider>();
builder.Services.AddSingleton(sp => NativeHealthAuthorizationPolicy.FromConfiguration(
    builder.Configuration["Agent:NativeHealth:OperatorSid"],
    sp.GetRequiredService<ILogger<NativeHealthAuthorizationPolicy>>()));
builder.Services.AddSingleton(sp => new NativeHealthGatewayServer(
    sp.GetRequiredService<NativeHealthAuthorizationPolicy>(),
    sp.GetRequiredService<INativeHealthSnapshotProvider>(),
    NativeHealthProtocol.ServerClientProcessingTimeout,
    sp.GetRequiredService<ILogger<NativeHealthGatewayServer>>()));
builder.Services.AddTelemetryTransportFoundation();
builder.Services.AddHostedService<AgentLifecycleService>();
builder.Services.AddHostedService<NativeHealthGatewayService>();
builder.Services.AddHostedService<SerialInventoryPipeService>();
builder.Services.AddHostedService<LocationTelemetryPipeService>();
builder.Services.AddHostedService<SystemTelemetryPipeService>();

var app = builder.Build();
var credentialProvider = app.Services.GetRequiredService<AgentCredentialProvider>();
await credentialProvider.InitializeAsync(app.Lifetime.ApplicationStopping);

app.UseMiddleware<HealthAuthenticationMiddleware>();

app.MapGet("/api/v1/health", (ServiceIdentity identity, TimeProvider timeProvider) =>
{
    var checkedAt = timeProvider.GetUtcNow();

    return Results.Ok(new HealthResponse(
        Status: "ok",
        Service: serviceName,
        Version: identity.Version,
        StartedAt: identity.StartedAt,
        CheckedAt: checkedAt,
        UptimeSeconds: Math.Max(0, (long)(checkedAt - identity.StartedAt).TotalSeconds)));
});

app.MapGet("/api/v1/serial-ports", (ISerialPortEnumerator enumerator, CancellationToken cancellationToken) =>
    Results.Ok(enumerator.Enumerate(cancellationToken)));

app.MapGet("/api/v1/location", async (ILocationProvider provider, CancellationToken cancellationToken) =>
    Results.Ok(await provider.GetLocationAsync(cancellationToken)));

app.MapGet("/api/v1/location/nmea", async (ISerialNmeaLocationService service, CancellationToken cancellationToken) =>
    Results.Ok(await service.AcquireAsync(cancellationToken)));

app.MapGet("/api/v1/system", (WindowsSystemTelemetryProvider provider) => Results.Ok(provider.GetObservation()));

await app.RunAsync();

public partial class Program;
