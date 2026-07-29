using System.Text.RegularExpressions;

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
}
