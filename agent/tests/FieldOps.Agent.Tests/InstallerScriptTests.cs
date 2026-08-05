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
        Assert.Contains("FieldOps tray startup registered for the current user", InstallerScript);
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
        Assert.Contains("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", module);
        Assert.Contains("FieldOpsDashboardTray", module);
        Assert.Contains("Resolve-Path -LiteralPath $TrayPath", module);
        Assert.Contains("$command = '\"{0}\"' -f $resolved", module);
        Assert.Contains("Remove-ItemProperty", module);
    }

    [Fact]
    public void DesktopUpdaterUsesCurrentPublishAndProductionInstallPath()
    {
        var updater = File.ReadAllText(Path.Combine(GetRepositoryRoot(), "UpdateDashboard.ps1"));
        Assert.DoesNotContain("feature/E1-telemetry-foundation", updater);
        Assert.Contains("[Parameter(Mandatory = $true)][string]$OperatorAccount", updater);
        Assert.Contains("$Branch = 'fix-2.3-mvp-03-post-restart-native-health'", updater);
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
