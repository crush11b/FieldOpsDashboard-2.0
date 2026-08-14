using System.Diagnostics;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using FieldOps.Agent.Health;
using FieldOps.Agent.SystemTelemetry;
using Microsoft.Extensions.Logging.Abstractions;

namespace FieldOps.Agent.Tests;

public sealed class SystemTelemetryPipeServerTests
{
    [Fact]
    public void OperatorPolicyGrantsDuplexReadAndWriteAndDeniesUntrustedIdentities()
    {
        var operatorSid = new SecurityIdentifier("S-1-5-21-111111111-222222222-333333333-1001");
        var policy = new NativeHealthAuthorizationPolicy(operatorSid);
        var rules = policy.CreateSecurity().GetAccessRules(true, false, typeof(SecurityIdentifier))
            .Cast<PipeAccessRule>()
            .ToArray();

        var operatorRule = Assert.Single(rules, rule => rule.IdentityReference == operatorSid);
        Assert.Equal(AccessControlType.Allow, operatorRule.AccessControlType);
        Assert.Equal(PipeAccessRights.ReadWrite, operatorRule.PipeAccessRights & PipeAccessRights.ReadWrite);
        Assert.Equal(PipeAccessRights.ReadPermissions, operatorRule.PipeAccessRights & PipeAccessRights.ReadPermissions);
        Assert.Equal(
            AccessControlType.Deny,
            Assert.Single(rules, rule => rule.IdentityReference == new SecurityIdentifier(WellKnownSidType.AnonymousSid, null)).AccessControlType);
        Assert.Equal(
            AccessControlType.Deny,
            Assert.Single(rules, rule => rule.IdentityReference == new SecurityIdentifier(WellKnownSidType.NetworkSid, null)).AccessControlType);
        Assert.Contains(rules, rule => rule.IdentityReference == new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null)
            && rule.AccessControlType == AccessControlType.Allow
            && (rule.PipeAccessRights & PipeAccessRights.FullControl) == PipeAccessRights.FullControl);
        Assert.Contains(rules, rule => rule.IdentityReference == new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null)
            && rule.AccessControlType == AccessControlType.Allow
            && (rule.PipeAccessRights & PipeAccessRights.ReadWrite) == PipeAccessRights.ReadWrite);
    }

    [Fact]
    public async Task ReadOnlyDotNetClientReceivesFullTelemetryJson()
    {
        var pipeName = "FieldOps.SystemTelemetry.Test." + Guid.NewGuid().ToString("N");
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var server = CreateServer(pipeName);
        var run = server.RunAsync(stop.Token);
        using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.In, PipeOptions.Asynchronous);

        await client.ConnectAsync(1000);
        using var document = await JsonDocument.ParseAsync(client, cancellationToken: stop.Token);
        Assert.Equal("Available", document.RootElement.GetProperty("status").GetString());
        Assert.Equal(100, document.RootElement.GetProperty("chargePercent").GetInt32());
        Assert.Equal("AC", document.RootElement.GetProperty("powerSource").GetString());
        Assert.True(document.RootElement.GetProperty("batteryPresent").GetBoolean());

        stop.Cancel();
        await run;
    }

    [Fact]
    public async Task NodeDuplexClientReceivesFullTelemetryJsonWhenNodeIsAvailable()
    {
        var node = ResolveNode();
        if (node is null)
        {
            return;
        }

        var pipeName = "FieldOps.SystemTelemetry.NodeTest." + Guid.NewGuid().ToString("N");
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var server = CreateServer(pipeName);
        var run = server.RunAsync(stop.Token);
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = node,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            },
        };
        process.StartInfo.ArgumentList.Add("-e");
        process.StartInfo.ArgumentList.Add("const s=require('node:net').connect(process.argv[1]);let b='';s.on('data',c=>b+=c);s.on('end',()=>process.stdout.write(b));s.on('error',e=>{console.error(e.code||e.name);process.exitCode=2});");
        process.StartInfo.ArgumentList.Add(@$"\\.\pipe\{pipeName}");

        Assert.True(process.Start());
        await process.WaitForExitAsync(stop.Token);
        var output = await process.StandardOutput.ReadToEndAsync(stop.Token);
        var error = await process.StandardError.ReadToEndAsync(stop.Token);

        Assert.True(process.ExitCode == 0, error);
        using var document = JsonDocument.Parse(output);
        Assert.Equal("Available", document.RootElement.GetProperty("status").GetString());
        Assert.Equal(100, document.RootElement.GetProperty("chargePercent").GetInt32());

        stop.Cancel();
        await run;
    }

    private static SystemTelemetryPipeServer CreateServer(string pipeName) => new(
        new WindowsSystemTelemetryProvider(new FakePowerStatus(new NativePowerStatus(1, 1, 100, 600))),
        new NativeHealthAuthorizationPolicy(null),
        NullLogger<SystemTelemetryPipeServer>.Instance,
        pipeName,
        TestSecurity);

    private static Func<PipeSecurity> TestSecurity => () =>
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(
            WindowsIdentity.GetCurrent().User!,
            PipeAccessRights.ReadWrite | PipeAccessRights.ReadPermissions,
            AccessControlType.Allow));
        return security;
    };

    private static string? ResolveNode()
    {
        var command = OperatingSystem.IsWindows() ? "where.exe" : "which";
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = command,
            ArgumentList = { "node.exe" },
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        });
        if (process is null) return null;
        process.WaitForExit();
        return process.ExitCode == 0
            ? process.StandardOutput.ReadToEnd().Split([Environment.NewLine, "\n"], StringSplitOptions.RemoveEmptyEntries)[0].Trim()
            : null;
    }

    private sealed class FakePowerStatus(NativePowerStatus value) : IWindowsPowerStatus
    {
        public bool TryGet(out NativePowerStatus status)
        {
            status = value;
            return true;
        }
    }
}
