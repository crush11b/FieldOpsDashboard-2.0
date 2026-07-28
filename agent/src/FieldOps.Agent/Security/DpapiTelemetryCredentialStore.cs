using System.Security.Cryptography;
using System.Text;

namespace FieldOps.Agent.Security;

internal sealed class DpapiTelemetryCredentialStore(
    IConfiguration configuration,
    IHostEnvironment environment,
    ILogger<DpapiTelemetryCredentialStore> logger) : ITelemetryCredentialStore
{
    internal const int TokenByteLength = 32;
    internal const int EncodedTokenLength = 43;

    public async ValueTask<string?> ReadAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        string credentialPath;
        try
        {
            credentialPath = GetCredentialPath();
        }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException or PathTooLongException)
        {
            logger.LogWarning("Telemetry credential storage configuration is invalid");
            return null;
        }
        if (!File.Exists(credentialPath))
        {
            return null;
        }

        byte[] protectedCredential;
        try
        {
            protectedCredential = await File.ReadAllBytesAsync(credentialPath, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning("Telemetry credential could not be read from protected machine storage");
            return null;
        }

        byte[] plaintext;
        try
        {
            plaintext = ProtectedData.Unprotect(
                protectedCredential,
                optionalEntropy: null,
                DataProtectionScope.LocalMachine);
        }
        catch (CryptographicException)
        {
            logger.LogWarning("Telemetry credential could not be decrypted from protected machine storage");
            return null;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(protectedCredential);
        }

        try
        {
            if (plaintext.Length != EncodedTokenLength)
            {
                logger.LogWarning("Telemetry credential in protected machine storage has an invalid format");
                return null;
            }

            var token = Encoding.ASCII.GetString(plaintext);
            if (!TryDecodeToken(token))
            {
                logger.LogWarning("Telemetry credential in protected machine storage has an invalid format");
                return null;
            }

            return token;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    private string GetCredentialPath()
    {
        var configuredPath = configuration["Telemetry:CredentialPath"];
        if (!string.IsNullOrWhiteSpace(configuredPath))
        {
            return Path.GetFullPath(configuredPath, environment.ContentRootPath);
        }

        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        return Path.Combine(programData, "FieldOpsDashboard", "Agent", "telemetry-write-token.dat");
    }

    private static bool TryDecodeToken(string token)
    {
        if (token.Length != EncodedTokenLength
            || token.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not '-' and not '_'))
        {
            return false;
        }

        Span<byte> decoded = stackalloc byte[TokenByteLength];
        var padded = token.Replace('-', '+').Replace('_', '/') + "=";
        return Convert.TryFromBase64String(padded, decoded, out var bytesWritten)
            && bytesWritten == TokenByteLength;
    }
}
