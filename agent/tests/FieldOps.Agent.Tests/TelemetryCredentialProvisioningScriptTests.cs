namespace FieldOps.Agent.Tests;

public sealed class TelemetryCredentialProvisioningScriptTests
{
    private static readonly string Script = File.ReadAllText(GetScriptPath());

    [Fact]
    public void GeneratesAndProtectsASeparate256BitCredential()
    {
        Assert.Contains("New-Object byte[] 32", Script);
        Assert.Contains("RandomNumberGenerator]::Create()", Script);
        Assert.Contains("DataProtectionScope]::LocalMachine", Script);
        Assert.Contains("telemetry:write", Script);
        Assert.Contains("tokenDigest", Script);
    }

    [Fact]
    public void RequiresExplicitRotationAndPreservesStableAgentIdentity()
    {
        Assert.Contains("[switch]$Rotate", Script);
        Assert.Contains("Use -Rotate to replace them explicitly", Script);
        Assert.Contains("Rotation cannot change the receiver-owned agent ID", Script);
        Assert.Contains("$AgentId = $previousRecord.agentId", Script);
    }

    [Fact]
    public void StagesVerifiesAndRollsBackBothCredentialFiles()
    {
        Assert.Contains("$receiverTemp", Script);
        Assert.Contains("$agentTemp", Script);
        Assert.Contains("Assert-CredentialPair", Script);
        Assert.Contains("$receiverBackup", Script);
        Assert.Contains("$agentBackup", Script);
        Assert.Contains("$receiverSwapped", Script);
        Assert.Contains("$agentSwapped", Script);
        Assert.Contains("Telemetry credential provisioning failed safely", Script);
    }

    [Fact]
    public void RotationAtomicallyReplacesBothCredentialFiles()
    {
        Assert.Contains("[IO.File]::Replace($agentTemp, $AgentCredentialPath, $agentBackup, $true)", Script);
        Assert.Contains("[IO.File]::Replace($receiverTemp, $ReceiverCredentialPath, $receiverBackup, $true)", Script);
    }

    [Fact]
    public void AppliesExplicitReceiverAndAgentAcls()
    {
        Assert.Contains("SetAccessRuleProtection($true, $false)", Script);
        Assert.Contains("S-1-5-18", Script);
        Assert.Contains("S-1-5-32-544", Script);
        Assert.Contains("S-1-5-19", Script);
        Assert.Contains("$dashboardSid", Script);
        Assert.Contains("Assert-ProtectedAcl", Script);
    }

    [Fact]
    public void SafeOutputNeverPrintsTheTokenOrDigest()
    {
        var writeHostLines = Script
            .Split('\n')
            .Where(line => line.Contains("Write-Host", StringComparison.OrdinalIgnoreCase));

        Assert.DoesNotContain(writeHostLines, line =>
            line.Contains("$token", StringComparison.OrdinalIgnoreCase)
            || line.Contains("$digest", StringComparison.OrdinalIgnoreCase));
        Assert.Contains("Provisioning does not activate telemetry delivery", Script);
    }

    private static string GetScriptPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "scripts", "Provision-FieldOpsTelemetryCredential.ps1");
            if (File.Exists(candidate))
            {
                return candidate;
            }
            directory = directory.Parent;
        }

        throw new FileNotFoundException("Could not locate telemetry credential provisioning script.");
    }
}
