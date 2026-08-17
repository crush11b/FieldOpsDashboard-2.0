using System.Text.RegularExpressions;
using System.Diagnostics;

namespace FieldOps.Agent.Tests;

public sealed class InstallerScriptTests
{
    private static readonly string InstallerScript = File.ReadAllText(GetInstallerPath());

    [Fact]
    public void ServiceCreationPassesOptionsAndValuesAsSeparateArguments()
    {
        AssertArgumentSequence(
            "create",
            "'create'",
            "$serviceName",
            "'binPath='", "$binaryPath",
            "'start='", "'auto'",
            "'obj='", "'NT AUTHORITY\\LocalService'",
            "'DisplayName='", "'FieldOps Local Agent'");

        Assert.Contains("$binaryPath = '\"{0}\"' -f $installedExecutable", InstallerScript);
    }

    [Fact]
    public void ServiceRecoveryPassesOptionsAndValuesAsSeparateArguments()
    {
        AssertArgumentSequence(
            "failure",
            "'failure'",
            "$serviceName",
            "'reset='", "'86400'",
            "'actions='", "'restart/5000/restart/15000/restart/30000'");
    }

    [Fact]
    public void ServiceMetadataMatchesTheInstallationContract()
    {
        Assert.Contains("$serviceName = 'FieldOpsAgent'", InstallerScript);
        Assert.Contains("'start=', 'auto'", NormalizeWhitespace(InstallerScript));
        Assert.Contains("'obj=', 'NT AUTHORITY\\LocalService'", NormalizeWhitespace(InstallerScript));
        Assert.Contains("'DisplayName=', 'FieldOps Local Agent'", NormalizeWhitespace(InstallerScript));
        Assert.Contains(
            "Invoke-ServiceControl -Arguments @('description', $serviceName, 'Trusted local service boundary for FieldOps Dashboard.')",
            InstallerScript);
        Assert.Contains("'actions=', 'restart/5000/restart/15000/restart/30000'", NormalizeWhitespace(InstallerScript));
    }

    [Fact]
    public void FailedCreateRollbackCleansEveryInstallerArtifact()
    {
        Assert.Contains("$serviceCreateAttempted = $true", InstallerScript);
        Assert.Contains("Get-Service -Name $serviceName -ErrorAction SilentlyContinue", InstallerScript);
        Assert.Contains("Invoke-ServiceControl -Arguments @('delete', $serviceName)", InstallerScript);
        Assert.Contains("Remove-EventLog -Source $serviceName", InstallerScript);
        Assert.Contains("Remove-Item -LiteralPath $credentialTempPath", InstallerScript);
        Assert.Contains("Remove-Item -LiteralPath $dataPath -Recurse -Force", InstallerScript);
        Assert.Contains("Remove-Item -LiteralPath $installPath -Recurse -Force", InstallerScript);
        Assert.Contains("Service '$serviceName' still exists after rollback.", InstallerScript);
        Assert.Contains("Event Log source '$serviceName' still exists after rollback.", InstallerScript);
        Assert.Contains("still exists after rollback.", InstallerScript);
        Assert.Contains("Rollback incomplete:", InstallerScript);
    }

    [Fact]
    public void TrayStartupIsPerUserQuotedAndIntegratedWithInstall()
    {
        Assert.Contains("TrayPublishPath", InstallerScript);
        Assert.Contains("FieldOps.Tray.exe", InstallerScript);
        Assert.Contains("Register-FieldOpsTrayStartup", InstallerScript);
        Assert.Contains("FieldOps.TrayStartup.psm1", InstallerScript);
        Assert.Contains("$trayInstallPath", InstallerScript);
        Assert.Contains("-OperatorSid $operatorProvisioning.OperatorSid", InstallerScript);
        Assert.Contains("Remove-FieldOpsLegacyDashboardStartup", InstallerScript);
        Assert.Contains("operator '$($operatorProvisioning.OperatorName)'", InstallerScript);
        Assert.DoesNotContain("registered for the current user", InstallerScript);
    }

    [Fact]
    public void TrayStartupRemovalIsIntegratedWithUninstall()
    {
        var uninstaller = File.ReadAllText(FindScript("Uninstall-FieldOpsAgent.ps1"));
        Assert.Contains("FieldOps.TrayStartup.psm1", uninstaller);
        Assert.Contains("Remove-FieldOpsTrayStartup", uninstaller);
        Assert.Contains("$trayInstallPath", uninstaller);
    }

    [Fact]
    public void TrayStartupModuleUsesCurrentUserRunKeyAndQuotedExecutable()
    {
        var module = File.ReadAllText(FindScript("FieldOps.TrayStartup.psm1"));
        Assert.Contains("Software\\Microsoft\\Windows\\CurrentVersion\\Run", module);
        Assert.DoesNotContain("HKCU:", module);
        Assert.Contains("OperatorSid", module);
        Assert.Contains("RegLoadKey", module);
        Assert.Contains("RegUnLoadKey", module);
        Assert.Contains("LoadedByProduct", module);
        Assert.Contains("FieldOpsDashboardTray", module);
        Assert.Contains("Resolve-Path -LiteralPath $TrayPath", module);
        Assert.Contains("Command = '\"{0}\"' -f $resolved", module);
        Assert.Contains("DeleteValue($script:StartupValueName", module);
        Assert.Contains("FieldOpsDashboard.lnk", module);
    }

    [Fact]
    public void StartupRegistrationIsNotRedirectableThroughAmbientInstallerIdentity()
    {
        var module = File.ReadAllText(FindScript("FieldOps.TrayStartup.psm1"));
        Assert.DoesNotContain("$env:USERNAME", module);
        Assert.DoesNotContain("[Environment]::UserName", module);
        Assert.Contains("Open-FieldOpsOperatorHive -OperatorSid $OperatorSid", module);
        Assert.Contains("$actual -ne $tray.Command", module);
    }

    [Fact]
    public void ProductionInstallAndUpdateDoNotInvokeLegacyDashboardStartup()
    {
        var updater = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "UpdateDashboard.ps1"));
        var uninstaller = File.ReadAllText(FindScript("Uninstall-FieldOpsAgent.ps1"));
        Assert.DoesNotContain("start_background.vbs", InstallerScript);
        Assert.DoesNotContain("start.bat", InstallerScript);
        Assert.DoesNotContain("npm run dev", InstallerScript);
        Assert.DoesNotContain("start_background.vbs", updater);
        Assert.DoesNotContain("start.bat", updater);
        Assert.DoesNotContain("npm run dev", updater);
        Assert.DoesNotContain("start_background.vbs", uninstaller);
        Assert.DoesNotContain("start.bat", uninstaller);
    }

    [Fact]
    public void DesktopUpdaterUsesCurrentPublishAndProductionInstallPath()
    {
        var updater = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "UpdateDashboard.ps1"));
        Assert.DoesNotContain("feature/E1-telemetry-foundation", updater);
        Assert.Contains("[Parameter(Mandatory = $true)][string]$OperatorAccount", updater);
        Assert.Contains("[ValidatePattern('^[0-9a-fA-F]{40}$')][string]$Revision", updater);
        Assert.Contains("Resolve-DeploymentRevision", updater);
        Assert.Contains("archive/$deploymentRevision.tar.gz", updater);
        Assert.Contains("Deployment was not activated", updater);
        Assert.Contains("deployment-manifest.json", updater);
        Assert.Contains("$Branch = 'main'", updater);
        Assert.DoesNotContain("$Branch = 'fix-2.3-mvp-03-post-restart-native-health'", updater);
        Assert.Contains("$Repository = 'crush11b/FieldOpsDashboard-2.0'", updater);
        Assert.Contains(".tar.gz", updater);
        Assert.DoesNotContain("Expand-Archive", updater);
        Assert.Contains("tar.exe", updater);
        Assert.Contains("-OperatorAccount $OperatorAccount", updater);
        Assert.DoesNotContain("agent\\publish\\win-x64", updater);
        Assert.Contains("Publish-FieldOpsArtifacts.ps1", updater);
        Assert.Contains("Install-FieldOpsAgent.ps1", updater);
        Assert.Contains("Provision-FieldOpsTelemetryCredential.ps1", updater);
        Assert.Contains("npm run build", updater);
        Assert.Contains("ArgumentList 'start'", updater);
        Assert.DoesNotContain("npm run dev", updater);
        var batch = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "UpdateDashboard.bat"));
        Assert.Contains("UpdateDashboard.ps1", batch);
        Assert.Contains("C:\\FieldOpsDashboard", updater);
        Assert.Contains("Set-Location -LiteralPath $installParent", updater);
    }

    [Fact]
    public void UpdaterTreatsP533RuntimeAsValidatedNativeArtifactInput()
    {
        var updater = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "UpdateDashboard.ps1"));
        var publisher = File.ReadAllText(FindScript("Publish-FieldOpsArtifacts.ps1"));
        var builder = File.ReadAllText(FindScript("Build-FieldOpsNativePackage.ps1"));
        var packageRequirements = updater.Substring(updater.IndexOf("$requiredPackageFiles", StringComparison.Ordinal), updater.IndexOf("$requiredDeploymentFiles", StringComparison.Ordinal) - updater.IndexOf("$requiredPackageFiles", StringComparison.Ordinal));
        Assert.DoesNotContain("'p533-assets\\runtime\\provenance.json'", packageRequirements);
        Assert.Contains("Assert-P533RuntimeArtifact", updater);
        Assert.Contains("Copy-Item -Path (Join-Path $p533RuntimeRoot '*')", updater);
        Assert.Contains("p533-assets\\runtime\\provenance.json", updater);
        Assert.Contains("name = 'p533'", publisher);
        Assert.Contains("p533-assets\\runtime\\provenance.json", builder);
        Assert.Contains("Join-Path $source 'p533-assets'", builder);
    }

    [Fact]
    public void RejectedCandidateCleanupIsBoundedAndCannotMaskValidationFailure()
    {
        var updater = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "UpdateDashboard.ps1"));
        Assert.Contains("function Remove-TemporaryCandidate", updater);
        Assert.Contains("StartsWith($root + [IO.Path]::DirectorySeparatorChar", updater);
        Assert.Contains("cmd.exe /c rmdir /s /q", updater);
        Assert.Contains("Rejected candidate cleanup was not completed", updater);
        Assert.Contains("No download candidate contained a valid FieldOps Dashboard deployment package.", updater);
        Assert.DoesNotContain("Remove-Item -LiteralPath $extractPath -Recurse -Force\n", updater);
    }

    [Fact]
    public void P533RuntimeStagingPrecedesInstallTreeSwapAndRollback()
    {
        var updater = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "UpdateDashboard.ps1"));
        var staging = updater.IndexOf("Assert-P533RuntimeArtifact", StringComparison.Ordinal);
        var swap = updater.IndexOf("Move-Item -LiteralPath $stagePath -Destination $resolvedInstallPath", StringComparison.Ordinal);
        var activation = updater.IndexOf("$deploymentStarted = $true", StringComparison.Ordinal);
        Assert.True(staging >= 0 && activation >= 0 && swap >= 0);
        Assert.True(staging < activation);
        Assert.True(activation < swap);
        Assert.Contains("Move-Item -LiteralPath $backupPath -Destination $resolvedInstallPath", updater);
    }

    [Fact]
    public void UpdaterExposesRevisionIdentityEndpointContract()
    {
        var server = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "server.ts"));
        Assert.Contains("app.get('/api/version'", server);
        Assert.Contains("sourceRevision", server);
        Assert.Contains("nativeRevision", server);
    }

    [Fact]
    public void UpdaterWritesNonSensitiveAtomicDeploymentIdentity()
    {
        var updater = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "UpdateDashboard.ps1"));
        Assert.Contains("sourceRevision = $deploymentRevision", updater);
        Assert.Contains("nativeRevision = $deploymentRevision", updater);
        Assert.Contains("deployedAtUtc", updater);
        Assert.Contains("deployment-manifest.json", updater);
        Assert.DoesNotContain("latitude", updater, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("longitude", updater, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void UpgradeStopsOnlyFieldOpsLauncherAndTrayProcessesBeforeCopy()
    {
        var updater = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "UpdateDashboard.ps1"));
        var installer = File.ReadAllText(FindScript("Install-FieldOpsAgent.ps1"));
        Assert.Contains("Get-CimInstance Win32_Process -Filter \"Name = 'cmd.exe'\"", updater);
        Assert.Contains("Stop-FieldOpsLauncherWrappers -InstallRoot $resolvedInstallPath", updater);
        Assert.Contains("CommandLine", updater);
        Assert.Contains("Get-CimInstance Win32_Process -Filter \"Name = 'FieldOps.Tray.exe'\"", installer);
        Assert.Contains("ExecutablePath", installer);
        Assert.Contains("Stop-FieldOpsTrayForUpgrade", installer);
        Assert.Contains("did not exit within the bounded upgrade window", installer);
        Assert.Contains("Copy-Item -Path (Join-Path $resolvedTrayPublishPath '*')", installer);
    }

    [Fact]
    public void UpdaterPreservesValidTelemetryCredentialsAndRejectsUnsafeStates()
    {
        var updater = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "UpdateDashboard.ps1"));
        var provisioning = File.ReadAllText(FindScript("Provision-FieldOpsTelemetryCredential.ps1"));
        Assert.Contains("Ensure-FieldOpsTelemetryCredentials", updater);
        Assert.Contains("-ValidateOnly", updater);
        Assert.Contains("Existing telemetry credentials preserved", updater);
        Assert.Contains("$receiverExists -or $agentExists", updater);
        Assert.Contains("repair is required", updater);
        Assert.DoesNotContain("-Rotate", updater);
        Assert.Contains("[switch]$ValidateOnly", provisioning);
        Assert.Contains("Assert-CredentialPair", provisioning);
        Assert.Contains("Telemetry credential pair is incomplete", provisioning);
    }

    [Fact]
    public void DeploymentManifestIsWrittenWithoutBomAndVersionEndpointStripsBom()
    {
        var updater = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "UpdateDashboard.ps1"));
        var server = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "server.ts"));
        Assert.Contains("UTF8Encoding($false)", updater);
        Assert.Contains("replace(/^\\uFEFF/, '')", server);
    }

    [Fact]
    public void AclRightsCalculationRunsUnderWindowsPowerShellSemantics()
    {
        var module = Path.Combine(GetRepositoryRoot(), "agent", "scripts", "FieldOps.Acl.psm1");
        var command = $"Import-Module -Force '{module}'; $d=Get-FieldOpsForbiddenLocalServiceRights -IsDirectory $true; $f=Get-FieldOpsForbiddenLocalServiceRights -IsDirectory $false; if (($d -band [Security.AccessControl.FileSystemRights]::ExecuteFile) -ne 0) {{ exit 1 }}; if (($f -band [Security.AccessControl.FileSystemRights]::ExecuteFile) -eq 0) {{ exit 2 }}; if (($f -band [Security.AccessControl.FileSystemRights]::WriteData) -eq 0) {{ exit 3 }}";
        using var process = Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"{command.Replace("\"", "\\\"")}\"") { UseShellExecute = false, RedirectStandardError = true });
        Assert.NotNull(process);
        process!.WaitForExit();
        Assert.True(process.ExitCode == 0, process.StandardError.ReadToEnd());
    }

    [Fact]
    public void NativePublishRestoresTheWinX64RuntimePacks()
    {
        var publish = File.ReadAllText(FindScript("Publish-FieldOpsArtifacts.ps1"));
        Assert.Contains("'restore', $solutionPath, '--locked-mode', '-r', 'win-x64'", publish);
    }

    [Fact]
    public void NoServiceControlOptionContainsAnEmbeddedValue()
    {
        Assert.DoesNotMatch(new Regex("['\\\"](?:binPath|start|obj|DisplayName|reset|actions)=\\s+[^'\\\"]+['\\\"]"), InstallerScript);
    }

    private static void AssertArgumentSequence(string command, params string[] expectedArguments)
    {
        var match = Regex.Match(
            InstallerScript,
            $@"Invoke-ServiceControl\s+-Arguments\s+@\(\s*'{Regex.Escape(command)}'(?<arguments>.*?)\)",
            RegexOptions.Singleline);

        Assert.True(match.Success, $"Could not find sc.exe {command} invocation.");
        var invocation = $"'{command}'{match.Groups["arguments"].Value}";
        var position = 0;
        foreach (var expectedArgument in expectedArguments)
        {
            var nextPosition = invocation.IndexOf(expectedArgument, position, StringComparison.Ordinal);
            Assert.True(nextPosition >= position, $"Missing or out-of-order argument {expectedArgument} in sc.exe {command} invocation.");
            position = nextPosition + expectedArgument.Length;
        }
    }

    private static string NormalizeWhitespace(string value) => Regex.Replace(value, @"\s+", " ");

    private static string GetInstallerPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "scripts", "Install-FieldOpsAgent.ps1");
            if (File.Exists(candidate))
            {
                return candidate;
            }
            directory = directory.Parent;
        }

        throw new FileNotFoundException("Could not locate agent/scripts/Install-FieldOpsAgent.ps1.");
    }

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
            if (File.Exists(Path.Combine(directory.FullName, "UpdateDashboard.ps1"))) return directory.FullName;
            directory = directory.Parent;
        }
        throw new DirectoryNotFoundException("Could not locate repository root.");
    }
}
