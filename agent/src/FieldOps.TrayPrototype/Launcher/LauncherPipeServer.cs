using System.IO.Pipes;
using System.Security.Principal;
using FieldOps.NativeHealth;

namespace FieldOps.TrayPrototype.Launcher;

internal sealed class LauncherPipeServer(
    ApplicationLauncher launcher,
    LauncherAuthorizationPolicy authorizationPolicy,
    string pipeName = LauncherProtocol.PipeName,
    TimeSpan? operationTimeout = null,
    Func<PipeSecurity>? securityFactory = null)
{
    private readonly TimeSpan timeout = operationTimeout ?? LauncherProtocol.OperationTimeout;

    internal async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            NamedPipeServerStream? pipe = null;
            try
            {
                pipe = CreateServer();
                await pipe.WaitForConnectionAsync(cancellationToken);
                using var requestTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                requestTimeout.CancelAfter(timeout);
                using var disposal = requestTimeout.Token.Register(static state => ((NamedPipeServerStream)state!).Dispose(), pipe);
                LaunchResponse response;
                try
                {
                    var request = await NativeHealthMessageFraming.ReadAsync<LaunchRequest>(pipe, requestTimeout.Token);
                    response = await launcher.LaunchAsync(request, requestTimeout.Token);
                }
                catch (InvalidDataException)
                {
                    response = new(LaunchResultCode.InvalidRequest, "The launch request was malformed.");
                }
                await NativeHealthMessageFraming.WriteAsync(pipe, response, requestTimeout.Token);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception) when (exception is IOException
                or InvalidDataException
                or UnauthorizedAccessException
                or ObjectDisposedException
                or OperationCanceledException)
            {
            }
            finally
            {
                pipe?.Dispose();
            }
        }
    }

    private NamedPipeServerStream CreateServer() => NamedPipeServerStreamAcl.Create(
        pipeName,
        PipeDirection.InOut,
        1,
        PipeTransmissionMode.Message,
        PipeOptions.Asynchronous | PipeOptions.WriteThrough | PipeOptions.FirstPipeInstance,
        LauncherProtocol.MaximumMessageBytes,
        LauncherProtocol.MaximumMessageBytes,
        securityFactory?.Invoke() ?? authorizationPolicy.CreateSecurity());

}