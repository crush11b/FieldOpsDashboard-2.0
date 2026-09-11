using FieldOps.TrayPrototype.Launcher;

namespace FieldOps.TrayPrototype.Tests;

public sealed class ApplicationLauncherTests
{
    [Fact]
    public async Task Existing_absolute_exe_is_passed_exactly_to_executor()
    {
        var target = CreateExecutable();
        var executor = new FakeExecutor();
        try
        {
            var result = await new ApplicationLauncher(executor).LaunchAsync(
                new(LauncherProtocol.Version, LaunchType.Executable, target),
                CancellationToken.None);

            Assert.Equal(LaunchResultCode.Launched, result.Result);
            Assert.Equal(target, executor.ExecutableTarget);
            Assert.Equal(1, executor.ExecutableLaunchCount);
        }
        finally
        {
            File.Delete(target);
        }
    }

    [Fact]
    public async Task Missing_executable_returns_not_found_without_execution()
    {
        var executor = new FakeExecutor();
        var result = await new ApplicationLauncher(executor).LaunchAsync(
            new(LauncherProtocol.Version, LaunchType.Executable, Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid():N}.exe")),
            CancellationToken.None);

        Assert.Equal(LaunchResultCode.ExecutableNotFound, result.Result);
        Assert.Equal(0, executor.ExecutableLaunchCount);
    }

    [Fact]
    public async Task Arguments_and_explicit_working_directory_are_preserved_without_shell_execution()
    {
        var target = CreateExecutable();
        var workingDirectory = Path.GetDirectoryName(target)!;
        var executor = new FakeExecutor();
        try
        {
            var result = await new ApplicationLauncher(executor).LaunchAsync(
                new(LauncherProtocol.Version, LaunchType.Executable, target, ["two words", "&", "quoted\"value"], workingDirectory),
                CancellationToken.None);

            Assert.Equal(LaunchResultCode.Launched, result.Result);
            Assert.Equal(["two words", "&", "quoted\"value"], executor.ExecutableArguments);
            Assert.Equal(workingDirectory, executor.ExecutableWorkingDirectory);
        }
        finally
        {
            File.Delete(target);
        }
    }

    [Fact]
    public async Task Mismatched_protocol_is_rejected_without_execution()
    {
        var executor = new FakeExecutor();
        var result = await new ApplicationLauncher(executor).LaunchAsync(
            new(1, LaunchType.Executable, "C:\\Tools\\launcher.exe"),
            CancellationToken.None);

        Assert.Equal(LaunchResultCode.ProtocolIncompatible, result.Result);
        Assert.Equal(0, executor.ExecutableLaunchCount);
    }

    [Theory]
    [InlineData("relative")]
    [InlineData("\\\\server\\share")]
    [InlineData("C:\\missing-directory")]
    public async Task Invalid_working_directories_are_rejected(string workingDirectory)
    {
        var target = CreateExecutable();
        try
        {
            var result = await new ApplicationLauncher(new FakeExecutor()).LaunchAsync(
                new(LauncherProtocol.Version, LaunchType.Executable, target, [], workingDirectory),
                CancellationToken.None);

            Assert.Equal(LaunchResultCode.InvalidWorkingDirectory, result.Result);
        }
        finally
        {
            File.Delete(target);
        }
    }

    [Fact]
    public async Task Uri_with_native_options_is_rejected()
    {
        var executor = new FakeExecutor();
        var result = await new ApplicationLauncher(executor).LaunchAsync(
            new(LauncherProtocol.Version, LaunchType.Uri, "https://example.test", ["argument"], null),
            CancellationToken.None);

        Assert.Equal(LaunchResultCode.InvalidRequest, result.Result);
        Assert.Equal(0, executor.UriOpenCount);
    }

    [Theory]
    [InlineData("relative.exe")]
    [InlineData("\\\\server\\share\\launcher.exe")]
    [InlineData("C:\\Tools\\launcher.txt")]
    [InlineData("C:\\Tools\\launcher.exe & whoami")]
    [InlineData("C:\\Tools\\launcher.exe\"")]
    public async Task Invalid_executable_targets_are_rejected(string target)
    {
        var executor = new FakeExecutor();
        var result = await new ApplicationLauncher(executor).LaunchAsync(
            new(LauncherProtocol.Version, LaunchType.Executable, target),
            CancellationToken.None);

        Assert.Equal(LaunchResultCode.InvalidRequest, result.Result);
        Assert.Equal(0, executor.ExecutableLaunchCount);
    }

    [Fact]
    public async Task Execution_exception_returns_launch_failed()
    {
        var target = CreateExecutable();
        var executor = new FakeExecutor { ExecutableException = new InvalidOperationException() };
        try
        {
            var result = await new ApplicationLauncher(executor).LaunchAsync(
                new(LauncherProtocol.Version, LaunchType.Executable, target),
                CancellationToken.None);

            Assert.Equal(LaunchResultCode.LaunchFailed, result.Result);
            Assert.Equal("Executable launch failed.", result.Detail);
        }
        finally
        {
            File.Delete(target);
        }
    }

    [Theory]
    [InlineData("http://example.test")]
    [InlineData("https://example.test/path?q=1")]
    public async Task Http_and_https_uris_are_opened(string target)
    {
        var executor = new FakeExecutor();
        var result = await new ApplicationLauncher(executor).LaunchAsync(
            new(LauncherProtocol.Version, LaunchType.Uri, target),
            CancellationToken.None);

        Assert.Equal(LaunchResultCode.UriOpened, result.Result);
        Assert.Equal(target, executor.UriTarget);
        Assert.Equal(1, executor.UriOpenCount);
    }

    [Theory]
    [InlineData("file:///C:/Windows/notepad.exe")]
    [InlineData("ms-settings:privacy")]
    [InlineData("not a uri")]
    [InlineData("http:///missing-host")]
    public async Task Unsupported_or_malformed_uris_are_rejected(string target)
    {
        var executor = new FakeExecutor();
        var result = await new ApplicationLauncher(executor).LaunchAsync(
            new(LauncherProtocol.Version, LaunchType.Uri, target),
            CancellationToken.None);

        Assert.Equal(LaunchResultCode.InvalidRequest, result.Result);
        Assert.Equal(0, executor.UriOpenCount);
    }

    [Fact]
    public async Task Uri_exception_returns_launch_failed()
    {
        var executor = new FakeExecutor { UriException = new InvalidOperationException() };
        var result = await new ApplicationLauncher(executor).LaunchAsync(
            new(LauncherProtocol.Version, LaunchType.Uri, "https://example.test"),
            CancellationToken.None);

        Assert.Equal(LaunchResultCode.LaunchFailed, result.Result);
        Assert.Equal(1, executor.UriOpenCount);
    }

    [Fact]
    public async Task Concurrent_launch_returns_busy()
    {
        var target = CreateExecutable();
        var executor = new BlockingExecutor();
        var launcher = new ApplicationLauncher(executor);
        try
        {
            var first = Task.Run(() => launcher.LaunchAsync(new(LauncherProtocol.Version, LaunchType.Executable, target), CancellationToken.None));
            Assert.True(executor.Entered.Wait(TimeSpan.FromSeconds(5)));

            var second = await launcher.LaunchAsync(new(LauncherProtocol.Version, LaunchType.Uri, "https://example.test"), CancellationToken.None);
            Assert.Equal(LaunchResultCode.Busy, second.Result);

            executor.Release.Set();
            Assert.Equal(LaunchResultCode.Launched, (await first).Result);
        }
        finally
        {
            executor.Release.Set();
            File.Delete(target);
        }
    }

    private static string CreateExecutable()
    {
        var path = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid():N}.exe");
        File.WriteAllBytes(path, []);
        return path;
    }

    private class FakeExecutor : IApplicationExecutor
    {
        public string? ExecutableTarget { get; private set; }
        public IReadOnlyList<string>? ExecutableArguments { get; private set; }
        public string? ExecutableWorkingDirectory { get; private set; }
        public string? UriTarget { get; private set; }
        public int ExecutableLaunchCount { get; private set; }
        public int UriOpenCount { get; private set; }
        public Exception? ExecutableException { get; init; }
        public Exception? UriException { get; init; }

        public virtual void LaunchExecutable(string target, IReadOnlyList<string> arguments, string workingDirectory)
        {
            ExecutableTarget = target;
            ExecutableArguments = arguments;
            ExecutableWorkingDirectory = workingDirectory;
            ExecutableLaunchCount++;
            if (ExecutableException is not null) throw ExecutableException;
        }

        public virtual void OpenUri(string target)
        {
            UriTarget = target;
            UriOpenCount++;
            if (UriException is not null) throw UriException;
        }
    }

    private sealed class BlockingExecutor : FakeExecutor
    {
        public ManualResetEventSlim Entered { get; } = new();
        public ManualResetEventSlim Release { get; } = new();

        public override void LaunchExecutable(string target, IReadOnlyList<string> arguments, string workingDirectory)
        {
            Entered.Set();
            Release.Wait();
            base.LaunchExecutable(target, arguments, workingDirectory);
        }
    }
}