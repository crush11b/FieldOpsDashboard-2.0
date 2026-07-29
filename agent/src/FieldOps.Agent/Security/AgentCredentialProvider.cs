using System.Security.Cryptography;

namespace FieldOps.Agent.Security;

internal sealed class AgentCredentialProvider(
    IConfiguration configuration,
    IHostEnvironment environment,
    ILogger<AgentCredentialProvider> logger)
{
    public const int EncodedCredentialLength = 44;

    private byte[]? credentialHash;

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        var configuredPath = configuration["Agent:CredentialPath"];
        var credentialPath = string.IsNullOrWhiteSpace(configuredPath)
            ? GetDefaultCredentialPath()
            : Path.GetFullPath(configuredPath, environment.ContentRootPath);

        if (!File.Exists(credentialPath))
        {
            throw new InvalidOperationException(
                $"Agent credential is not provisioned at '{credentialPath}'. Run the agent installer before startup.");
        }

        var protectedCredential = await File.ReadAllBytesAsync(credentialPath, cancellationToken);
        byte[] credential;

        try
        {
            credential = ProtectedData.Unprotect(
                protectedCredential,
                optionalEntropy: null,
                DataProtectionScope.LocalMachine);
        }
        catch (CryptographicException exception)
        {
            throw new InvalidOperationException("Agent credential could not be decrypted.", exception);
        }

        try
        {
            if (credential.Length != EncodedCredentialLength)
            {
                throw new InvalidOperationException("Agent credential is invalid.");
            }

            var credentialText = System.Text.Encoding.ASCII.GetString(credential);
            var decodedCredential = new byte[32];
            if (!Convert.TryFromBase64String(credentialText, decodedCredential, out var decodedLength)
                || decodedLength != decodedCredential.Length)
            {
                CryptographicOperations.ZeroMemory(decodedCredential);
                throw new InvalidOperationException("Agent credential is invalid.");
            }

            CryptographicOperations.ZeroMemory(decodedCredential);
            credentialHash = SHA256.HashData(credential);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(credential);
        }

        logger.LogInformation("Agent credential loaded from protected machine storage");
    }

    public bool IsValid(string candidate)
    {
        if (credentialHash is null || candidate.Length != EncodedCredentialLength)
        {
            return false;
        }

        var candidateBytes = System.Text.Encoding.UTF8.GetBytes(candidate);
        try
        {
            var candidateHash = SHA256.HashData(candidateBytes);
            return CryptographicOperations.FixedTimeEquals(credentialHash, candidateHash);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(candidateBytes);
        }
    }

    private static string GetDefaultCredentialPath()
    {
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        return Path.Combine(programData, "FieldOpsDashboard", "Agent", "health-token.dat");
    }
}
