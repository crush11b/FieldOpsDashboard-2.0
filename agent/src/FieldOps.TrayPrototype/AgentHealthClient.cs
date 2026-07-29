using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace FieldOps.TrayPrototype;

public interface IAgentHealthClient
{
    Task<AgentHealthResult> ReadAsync(CancellationToken cancellationToken);
}

public enum AgentHealthState
{
    Healthy,
    Unhealthy,
    Unavailable,
}

public sealed record AgentHealthResult(AgentHealthState State, string Detail);

internal sealed class LoopbackAgentHealthClient(HttpClient httpClient) : IAgentHealthClient
{
    private static readonly Uri Endpoint = new("http://127.0.0.1:43120/api/v1/health");

    public async Task<AgentHealthResult> ReadAsync(CancellationToken cancellationToken)
    {
        string credential;
        try
        {
            credential = await ReadCredentialAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is IOException
            or UnauthorizedAccessException
            or CryptographicException)
        {
            return new(AgentHealthState.Unavailable, "Protected health credential is unavailable to this user.");
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, Endpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential);

        try
        {
            using var response = await httpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return new(AgentHealthState.Unavailable, $"Health request returned HTTP {(int)response.StatusCode}.");
            }

            await using var body = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(body, cancellationToken: cancellationToken);
            var healthy = document.RootElement.TryGetProperty("status", out var status)
                && string.Equals(status.GetString(), "ok", StringComparison.OrdinalIgnoreCase);
            return healthy
                ? new(AgentHealthState.Healthy, "Authenticated health check passed.")
                : new(AgentHealthState.Unhealthy, "Agent responded without healthy status.");
        }
        catch (Exception exception) when (exception is HttpRequestException
            or TaskCanceledException
            or JsonException)
        {
            return new(AgentHealthState.Unavailable, "Authenticated health endpoint is unavailable.");
        }
    }

    private static async Task<string> ReadCredentialAsync(CancellationToken cancellationToken)
    {
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        var path = Path.Combine(programData, "FieldOpsDashboard", "Agent", "health-token.dat");
        var protectedBytes = await File.ReadAllBytesAsync(path, cancellationToken);
        var bytes = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.LocalMachine);
        try
        {
            return Encoding.ASCII.GetString(bytes);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
        }
    }
}
