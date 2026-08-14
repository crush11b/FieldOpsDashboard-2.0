using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.AspNetCore.TestHost;
using FieldOps.Agent;
using FieldOps.Agent.Health;
using FieldOps.Agent.Serial;
using FieldOps.Agent.Location;

namespace FieldOps.Agent.Tests;

public sealed class AgentWebApplicationFactory : WebApplicationFactory<Program>
{
    private readonly string tempDirectory = Path.Combine(
        Path.GetTempPath(),
        $"fieldops-agent-tests-{Guid.NewGuid():N}");

    public const string Token = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

    public AgentWebApplicationFactory()
    {
        Directory.CreateDirectory(tempDirectory);
        CredentialPath = Path.Combine(tempDirectory, "health-token.dat");
        WriteProtectedCredential(CredentialPath, Token);
    }

    public string CredentialPath { get; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Agent:CredentialPath"] = CredentialPath,
            });
        });
        builder.ConfigureLogging(logging => logging.ClearProviders());
        builder.ConfigureTestServices(services =>
        {
            // HTTP endpoint tests must not start machine-bound named-pipe listeners.
            var excluded = new[] { typeof(SerialNmeaLocationProvider), typeof(LocationTelemetryPipeService), typeof(SerialInventoryPipeService), typeof(NativeHealthGatewayService) };
            foreach (var descriptor in services.Where(d =>
                d.ServiceType == typeof(IHostedService) &&
                (excluded.Contains(d.ImplementationType) || d.ImplementationFactory is not null)).ToArray())
            {
                services.Remove(descriptor);
            }
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing && Directory.Exists(tempDirectory))
        {
            Directory.Delete(tempDirectory, recursive: true);
        }
    }

    internal static void WriteProtectedCredential(string path, string value)
    {
        var plaintext = System.Text.Encoding.ASCII.GetBytes(value);
        try
        {
            var protectedCredential = ProtectedData.Protect(
                plaintext,
                optionalEntropy: null,
                DataProtectionScope.LocalMachine);
            File.WriteAllBytes(path, protectedCredential);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }
}
