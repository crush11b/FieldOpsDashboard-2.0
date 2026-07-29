using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace FieldOps.ServiceControlPrototype;

internal sealed class AgentHealthProbe(HttpClient httpClient) : IAgentHealthProbe
{
    internal static readonly Uri HealthEndpoint = new("http://127.0.0.1:43120/api/v1/health");

    public async Task<HealthProbeResult> ProbeAsync(CancellationToken cancellationToken)
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
            return new(HealthProbeState.Unavailable, "The protected health credential could not be read.");
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, HealthEndpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential);

        try
        {
            using var response = await httpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return new(
                    HealthProbeState.Unavailable,
                    $"The health endpoint returned HTTP {(int)response.StatusCode}.");
            }

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            if (!document.RootElement.TryGetProperty("status", out var status)
                || !string.Equals(status.GetString(), "ok", StringComparison.OrdinalIgnoreCase))
            {
                return new(HealthProbeState.Unhealthy, "The health endpoint did not report status 'ok'.");
            }

            return new(HealthProbeState.Healthy, "Authenticated health check passed.");
        }
        catch (Exception exception) when (exception is HttpRequestException
            or TaskCanceledException
            or JsonException)
        {
            return new(HealthProbeState.Unavailable, "The authenticated health endpoint was unavailable.");
        }
    }

    private static async Task<string> ReadCredentialAsync(CancellationToken cancellationToken)
    {
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        var path = Path.Combine(programData, "FieldOpsDashboard", "Agent", "health-token.dat");
        var protectedCredential = await File.ReadAllBytesAsync(path, cancellationToken);
        var credential = ProtectedData.Unprotect(
            protectedCredential,
            optionalEntropy: null,
            DataProtectionScope.LocalMachine);

        try
        {
            return Encoding.ASCII.GetString(credential);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(credential);
        }
    }
}
