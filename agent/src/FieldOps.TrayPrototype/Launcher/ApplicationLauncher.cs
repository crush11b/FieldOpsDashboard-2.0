using System.Diagnostics;

namespace FieldOps.TrayPrototype.Launcher;

internal interface IApplicationExecutor
{
    void LaunchExecutable(string target, IReadOnlyList<string> arguments, string workingDirectory);
    void OpenUri(string target);
}

internal sealed class ProcessApplicationExecutor : IApplicationExecutor
{
    public void LaunchExecutable(string target, IReadOnlyList<string> arguments, string workingDirectory)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = target,
            UseShellExecute = false,
            WorkingDirectory = workingDirectory,
        };
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);
        Start(startInfo);
    }

    public void OpenUri(string target)
    {
        Start(new ProcessStartInfo
        {
            FileName = target,
            UseShellExecute = true,
        });
    }

    private static void Start(ProcessStartInfo startInfo)
    {
        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Windows did not create the requested process.");
    }
}

internal sealed class ApplicationLauncher(IApplicationExecutor executor)
{
    private readonly SemaphoreSlim operationGate = new(1, 1);

    internal async Task<LaunchResponse> LaunchAsync(LaunchRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Invalid("A launch target is required.");
        }

        if (request.ProtocolVersion == 0)
        {
            return Invalid("The launch request was malformed.");
        }

        if (request.ProtocolVersion != LauncherProtocol.Version)
        {
            return new(LaunchResultCode.ProtocolIncompatible, "The launcher protocol version is unsupported.");
        }

        if (string.IsNullOrWhiteSpace(request.Target))
        {
            return Invalid("A launch target is required.");
        }

        if (!await operationGate.WaitAsync(0, cancellationToken))
        {
            return new(LaunchResultCode.Busy, "Another launch is already in progress.");
        }

        try
        {
            return request.LaunchType switch
            {
                LaunchType.Executable => LaunchExecutable(request),
                LaunchType.Uri => OpenUri(request),
                _ => Invalid("The launch type is unsupported."),
            };
        }
        finally
        {
            operationGate.Release();
        }
    }

    private LaunchResponse LaunchExecutable(LaunchRequest request)
    {
        var target = request.Target;
        if (!IsAbsoluteWindowsExePath(target))
        {
            return Invalid("The executable target must be an absolute .exe path.");
        }

        if (!File.Exists(target))
        {
            return new(LaunchResultCode.ExecutableNotFound, "The configured executable was not found.");
        }

        try
        {
            var arguments = request.Arguments ?? [];
            if (arguments.Length > LauncherProtocol.MaximumArguments || arguments.Any(argument => argument is null || argument.IndexOf('\0') >= 0))
            {
                return Invalid("The executable arguments are invalid.");
            }
            var argumentBytes = System.Text.Encoding.UTF8.GetByteCount(System.Text.Json.JsonSerializer.Serialize(arguments));
            if (argumentBytes > LauncherProtocol.MaximumArgumentBytes)
            {
                return Invalid("The executable arguments exceed the allowed size.");
            }
            var workingDirectory = request.WorkingDirectory ?? Path.GetDirectoryName(target);
            if (workingDirectory is null || !IsAbsoluteLocalDirectoryPath(workingDirectory))
            {
                return new(LaunchResultCode.InvalidWorkingDirectory, "The executable working directory is invalid.");
            }
            if (!Directory.Exists(workingDirectory))
            {
                return new(LaunchResultCode.InvalidWorkingDirectory, "The executable working directory was not found.");
            }
            executor.LaunchExecutable(target, arguments, workingDirectory);
            return new(LaunchResultCode.Launched, "The executable launch was accepted by Windows.");
        }
        catch (Exception)
        {
            return Failed("Executable");
        }
    }

    private LaunchResponse OpenUri(LaunchRequest request)
    {
        var target = request.Target;
        if (request.Arguments is not null || request.WorkingDirectory is not null)
        {
            return Invalid("Web launches cannot include native launch options.");
        }
        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri)
            || uri is null
            || string.IsNullOrWhiteSpace(uri.Host)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return Invalid("The URI must be an absolute HTTP or HTTPS address.");
        }

        try
        {
            executor.OpenUri(target);
            return new(LaunchResultCode.UriOpened, "The URI was handed to the Windows browser association.");
        }
        catch (Exception)
        {
            return Failed("URI");
        }
    }

    private static bool IsAbsoluteWindowsExePath(string target) =>
        target.IndexOf('\0') < 0
        && !target.Contains('"')
        && !target.StartsWith("\\\\", StringComparison.Ordinal)
        && Path.IsPathFullyQualified(target)
        && string.Equals(Path.GetExtension(target), ".exe", StringComparison.OrdinalIgnoreCase);

    private static bool IsAbsoluteLocalDirectoryPath(string path) =>
        path.Length > 0
        && path.Length <= 4096
        && path.IndexOf('\0') < 0
        && !path.Contains('"')
        && !path.StartsWith("\\\\", StringComparison.Ordinal)
        && Path.IsPathFullyQualified(path);

    private static LaunchResponse Invalid(string detail) => new(LaunchResultCode.InvalidRequest, detail);

    private static LaunchResponse Failed(string operation) =>
        new(LaunchResultCode.LaunchFailed, $"{operation} launch failed.");
}