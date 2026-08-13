using System.Diagnostics;

namespace FieldOps.TrayPrototype.Launcher;

internal interface IApplicationExecutor
{
    void LaunchExecutable(string target);
    void OpenUri(string target);
}

internal sealed class ProcessApplicationExecutor : IApplicationExecutor
{
    public void LaunchExecutable(string target)
    {
        Start(new ProcessStartInfo
        {
            FileName = target,
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(target) ?? string.Empty,
        });
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
        if (request is null || string.IsNullOrWhiteSpace(request.Target))
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
                LaunchType.Executable => LaunchExecutable(request.Target),
                LaunchType.Uri => OpenUri(request.Target),
                _ => Invalid("The launch type is unsupported."),
            };
        }
        finally
        {
            operationGate.Release();
        }
    }

    private LaunchResponse LaunchExecutable(string target)
    {
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
            executor.LaunchExecutable(target);
            return new(LaunchResultCode.Launched, "The executable launch was accepted by Windows.");
        }
        catch (Exception exception)
        {
            return Failed("Executable", exception);
        }
    }

    private LaunchResponse OpenUri(string target)
    {
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
        catch (Exception exception)
        {
            return Failed("URI", exception);
        }
    }

    private static bool IsAbsoluteWindowsExePath(string target) =>
        target.IndexOf('\0') < 0
        && !target.Contains('"')
        && !target.StartsWith("\\\\", StringComparison.Ordinal)
        && Path.IsPathFullyQualified(target)
        && string.Equals(Path.GetExtension(target), ".exe", StringComparison.OrdinalIgnoreCase);

    private static LaunchResponse Invalid(string detail) => new(LaunchResultCode.InvalidRequest, detail);

    private static LaunchResponse Failed(string operation, Exception exception) =>
        new(LaunchResultCode.LaunchFailed, $"{operation} launch failed: {exception.GetType().Name}.");
}