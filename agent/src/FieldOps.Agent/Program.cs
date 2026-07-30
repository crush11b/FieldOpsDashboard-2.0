using System.Net;
using FieldOps.Agent;
using FieldOps.Agent.Health;
using FieldOps.Agent.Security;
using FieldOps.Agent.Telemetry.Transport;
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
builder.Services.AddSingleton<INativeHealthSnapshotProvider, NativeHealthSnapshotProvider>();
builder.Services.AddSingleton(sp => NativeHealthAuthorizationPolicy.FromConfiguration(
    builder.Configuration["Agent:NativeHealth:OperatorSid"],
    sp.GetRequiredService<ILogger<NativeHealthAuthorizationPolicy>>()));
builder.Services.AddSingleton(sp => new NativeHealthGatewayServer(
    sp.GetRequiredService<NativeHealthAuthorizationPolicy>(),
    sp.GetRequiredService<INativeHealthSnapshotProvider>(),
    TimeSpan.FromSeconds(5)));
builder.Services.AddTelemetryTransportFoundation();
builder.Services.AddHostedService<AgentLifecycleService>();
builder.Services.AddHostedService<NativeHealthGatewayService>();

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

await app.RunAsync();

public partial class Program;
