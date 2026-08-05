namespace FieldOps.Agent.Tests;

public sealed class OperatorProvisioningScriptTests
{
    private static readonly string Module = File.ReadAllText(FindScript("FieldOps.OperatorProvisioning.psm1"));
    private static readonly string Installer = File.ReadAllText(FindScript("Install-FieldOpsAgent.ps1"));
    private static readonly string Uninstaller = File.ReadAllText(FindScript("Uninstall-FieldOpsAgent.ps1"));

    [Fact]
    public void InstallerRequiresExplicitOperatorAndElevation()
    {
        Assert.Contains("[Parameter(Mandatory = $true)][string]$OperatorAccount", Installer);
        Assert.Contains("must be run from an elevated PowerShell session", Installer);
        Assert.DoesNotContain("GetCurrent().Name", Installer);
    }

    [Fact]
    public void CanonicalGroupIsLocalAndResolvedToSid()
    {
        Assert.Contains("$script:CanonicalGroupName = 'FieldOps Operators'", Module);
        Assert.Contains("Get-LocalGroup -Name $Name", Module);
        Assert.Contains("PrincipalSource -ne 'Local'", Module);
        Assert.Contains("$groupSid = [string]$group.SID.Value", Module);
        Assert.Contains("Agent__NativeHealth__OperatorSid", Module);
        Assert.Contains("$entryPrefix + $GroupSid", Module);
        Assert.DoesNotContain("$entryPrefix + $script:CanonicalGroupName", Module);
    }

    [Fact]
    public void CanonicalGroupCreationUsesNonEmptyWindowsSafeDescription()
    {
        const string description = "FieldOps native health operators";

        Assert.NotEmpty(description);
        Assert.True(description.Length <= 48);
        Assert.Contains("New-LocalGroup -Name $script:CanonicalGroupName", Module);
        Assert.Contains("-Description 'FieldOps native health operators'", Module);
    }

    [Fact]
    public void OperatorResolutionRejectsUnresolvedAndNonUserIdentities()
    {
        Assert.Contains("IdentityNotMappedException", Module);
        Assert.Contains("AccountSidLookup]::GetAccountType", Module);
        Assert.Contains("$accountType -ne 1", Module);
        Assert.Contains("must resolve to a user account", Module);
        Assert.DoesNotContain("Get-LocalGroupMember -Group 'Users'", Module);
    }

    [Fact]
    public void LocalDotAccountIsNormalizedBeforeSidTranslation()
    {
        Assert.Contains("$Account.StartsWith('.\\', [StringComparison]::Ordinal)", Module);
        Assert.Contains("$Account.Substring(2)", Module);
        Assert.Contains("$env:COMPUTERNAME", Module);
        Assert.Contains("$normalizedAccount", Module);
        Assert.Contains("NTAccount]$normalizedAccount", Module);
    }

    [Fact]
    public void NormalizedEnrollmentRemainsIdempotentAndUsesResolvedSid()
    {
        Assert.Contains("$operator = Resolve-FieldOpsLocalOperatorAccount -Account $OperatorAccount", Module);
        Assert.Contains("if ($existingState", Module);
        Assert.Contains("if (-not $isMember)", Module);
        Assert.Contains("enrolledAccountSid = $operator.Sid", Module);
    }

    [Fact]
    public void EnrollmentIsExplicitAndIdempotent()
    {
        Assert.Contains("Test-FieldOpsLocalGroupMembership", Module);
        Assert.Contains("if (-not (Test-FieldOpsLocalGroupMembership", Module);
        Assert.Contains("Add-LocalGroupMember -Group $script:CanonicalGroupName -Member $operator.Sid", Module);
        Assert.Contains("MembershipAddedThisRun", Module);
        Assert.Contains("sign out and sign in", Installer);
    }

    [Fact]
    public void OwnershipStateDistinguishesCreatedAndAdoptedGroupsAndMemberships()
    {
        Assert.Contains("groupProductOwned = $groupCreatedThisRun", Module);
        Assert.Contains("membershipProductOwned = $false", Module);
        Assert.Contains("membershipProductOwned = $true", Module);
        Assert.Contains("schemaVersion = $script:StateSchemaVersion", Module);
        Assert.Contains("groupSid = $groupSid", Module);
        Assert.Contains("enrolledAccountSid = $operator.Sid", Module);
        Assert.Contains("operator-provisioning.json", Installer);
    }

    [Fact]
    public void RepeatedProvisioningRequiresTheSameResolvedGroupAndOperator()
    {
        Assert.Contains("Existing FieldOps operator ownership state does not match", Module);
        Assert.Contains("[string]$existingState.groupSid -ne $groupSid", Module);
        Assert.Contains("[string]$existingState.enrolledAccountSid -ne $operator.Sid", Module);
        Assert.Contains("its tracked membership is missing", Module);
    }

    [Fact]
    public void RollbackRemovesOnlyStateCreatedByTheCurrentAttempt()
    {
        Assert.Contains("$membershipAddedThisRun -and -not $groupCreatedThisRun", Module);
        Assert.Contains("if ($groupCreatedThisRun)", Module);
        Assert.Contains("$stateWrittenThisRun -and", Module);
        Assert.Contains("$rollbackFailures.Count -eq 0", Module);
        Assert.Contains("Undo-FieldOpsOperatorProvisioningAttempt", Installer);
        Assert.Contains("Remove-FieldOpsOperatorServiceEnvironment", Installer);
        Assert.Contains("$operatorEnvironmentConfigured", Installer);
        Assert.Contains("Rollback incomplete:", Module);
    }

    [Fact]
    public void UninstallDeletesOnlyProvenProductOwnedState()
    {
        Assert.Contains("if ([bool]$state.groupProductOwned)", Module);
        Assert.Contains("elseif ([bool]$state.membershipProductOwned", Module);
        Assert.Contains("[string]$group.SID.Value -ne [string]$state.groupSid", Module);
        Assert.Contains("preserving group and membership state", Module);
        Assert.Contains("Preserved operator ownership state", Uninstaller);
        Assert.Contains("Remove-FieldOpsOperatorProvisioning", Uninstaller);
    }

    [Fact]
    public void UninstallPreservesUnrelatedEnvironmentAndMemberships()
    {
        Assert.Contains("$preserved = @($current | Where-Object", Module);
        Assert.Contains("StartsWith($entryPrefix", Module);
        Assert.DoesNotContain("Get-LocalGroupMember -Group $script:CanonicalGroupName | Remove-LocalGroupMember", Module);
        Assert.Contains("-Member ([string]$state.enrolledAccountSid)", Module);
    }

    [Fact]
    public void InstallerConfiguresServiceAfterCreationAndBeforeStart()
    {
        var create = Installer.IndexOf("$serviceCreated = $true", StringComparison.Ordinal);
        var configure = Installer.IndexOf("Set-FieldOpsOperatorServiceEnvironment", StringComparison.Ordinal);
        var start = Installer.IndexOf("Start-Service -Name $serviceName", StringComparison.Ordinal);

        Assert.True(create >= 0 && configure > create && start > configure);
        Assert.Contains("'obj=', 'NT AUTHORITY\\LocalService'", NormalizeWhitespace(Installer));
    }

    [Fact]
    public void DesktopUpdaterRequiresAndForwardsTheExplicitOperatorAccount()
    {
        var updater = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "UpdateDashboard.ps1"));

        Assert.Contains("[Parameter(Mandatory = $true)][string]$OperatorAccount", updater);
        Assert.Contains("-OperatorAccount $OperatorAccount", updater);
        Assert.Contains("FieldOps.OperatorProvisioning.psm1", updater);
    }

    [Fact]
    public void ProvisioningDoesNotBroadenCredentialsProtocolOrTelemetry()
    {
        Assert.DoesNotContain("health-token.dat", Module);
        Assert.DoesNotContain("Set-Acl", Module);
        Assert.DoesNotContain("BUILTIN\\Users", Module);
        Assert.DoesNotContain("Everyone", Module);
        Assert.DoesNotContain("Anonymous", Module);
        Assert.DoesNotContain("Network", Module);
        Assert.DoesNotContain("TelemetrySenderService", Module);
        Assert.DoesNotContain("HttpTelemetryDestination", Module);
        Assert.DoesNotContain("NativeHealthProtocol", Module);
    }

    private static string NormalizeWhitespace(string value) =>
        System.Text.RegularExpressions.Regex.Replace(value, @"\s+", " ");

    private static string FindScript(string name)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "scripts", name);
            if (File.Exists(candidate))
            {
                return candidate;
            }
            directory = directory.Parent;
        }

        throw new FileNotFoundException($"Could not locate agent/scripts/{name}.");
    }

    private static string GetRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "UpdateDashboard.ps1")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate repository root.");
    }
}
