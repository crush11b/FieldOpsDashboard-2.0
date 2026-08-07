using System.IO.Pipes;
using System.Diagnostics;
using System.Security.AccessControl;
using System.Security.Principal;
using FieldOps.NativeHealth;

namespace FieldOps.TrayPrototype.Location;

internal sealed class LocationBrokerAuthorizationPolicy(SecurityIdentifier ownerSid)
{
    internal const PipeAccessRights ClientRights =
        PipeAccessRights.ReadWrite | PipeAccessRights.ReadPermissions;
    private static readonly SecurityIdentifier LocalServiceSid =
        new(WellKnownSidType.LocalServiceSid, null);
    private static readonly SecurityIdentifier AdministratorsSid =
        new(WellKnownSidType.BuiltinAdministratorsSid, null);
    private static readonly SecurityIdentifier AnonymousSid =
        new(WellKnownSidType.AnonymousSid, null);
    private static readonly SecurityIdentifier NetworkSid =
        new(WellKnownSidType.NetworkSid, null);

    public PipeSecurity CreateSecurity()
    {
        var security = new PipeSecurity();
        security.SetOwner(ownerSid);
        AddRule(security, AnonymousSid, PipeAccessRights.FullControl, AccessControlType.Deny);
        AddRule(security, NetworkSid, PipeAccessRights.FullControl, AccessControlType.Deny);
        AddRule(security, ownerSid, PipeAccessRights.FullControl, AccessControlType.Allow);
        AddRule(security, LocalServiceSid, ClientRights, AccessControlType.Allow);
        AddRule(security, AdministratorsSid, ClientRights, AccessControlType.Allow);
        return security;
    }

    private static void AddRule(
        PipeSecurity security,
        SecurityIdentifier sid,
        PipeAccessRights rights,
        AccessControlType type) => security.AddAccessRule(new PipeAccessRule(sid, rights, type));
}

internal interface ILocationBrokerDiagnostics
{
    void BrokerStarted();
    void RequestTimedOut();
    void RequestFailed();
}

internal sealed class TraceLocationBrokerDiagnostics : ILocationBrokerDiagnostics
{
    public void BrokerStarted() => Trace.TraceInformation("Location broker initialized.");
    public void RequestTimedOut() => Trace.TraceWarning("Location broker request timed out.");
    public void RequestFailed() => Trace.TraceWarning("Location broker request failed safely.");
}

internal sealed class LocationBrokerPipeServer(
    WindowsLocationBroker broker,
    LocationBrokerAuthorizationPolicy authorizationPolicy,
    ILocationBrokerDiagnostics diagnostics,
    string pipeName = LocationBrokerProtocol.PipeName,
    TimeSpan? operationTimeout = null,
    Func<PipeSecurity>? securityFactory = null)
{
    private readonly TimeSpan timeout = operationTimeout ?? LocationBrokerProtocol.OperationTimeout;

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        var started = false;
        while (!cancellationToken.IsCancellationRequested)
        {
            NamedPipeServerStream? pipe = null;
            try
            {
                pipe = NamedPipeServerStreamAcl.Create(
                    pipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Message,
                    PipeOptions.Asynchronous | PipeOptions.WriteThrough | PipeOptions.FirstPipeInstance,
                    NativeHealthProtocol.MaximumMessageBytes,
                    NativeHealthProtocol.MaximumMessageBytes,
                    securityFactory?.Invoke() ?? authorizationPolicy.CreateSecurity());
                if (!started)
                {
                    diagnostics.BrokerStarted();
                    started = true;
                }

                await pipe.WaitForConnectionAsync(cancellationToken);
                LocationBrokerRequest request;
                using (var requestTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
                {
                    requestTimeout.CancelAfter(timeout);
                    using var requestDisposal = requestTimeout.Token.Register(
                        static state => ((NamedPipeServerStream)state!).Dispose(),
                        pipe);
                    request = await NativeHealthMessageFraming.ReadAsync<LocationBrokerRequest>(
                        pipe,
                        requestTimeout.Token);
                }
                if (request.Command != LocationBrokerProtocol.GetLocationCommand)
                {
                    throw new InvalidDataException("Unsupported location broker request.");
                }

                LocationBrokerResponse response;
                using (var acquisitionTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
                {
                    acquisitionTimeout.CancelAfter(timeout);
                    try
                    {
                        response = await broker.GetLocationAsync(acquisitionTimeout.Token);
                    }
                    catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                    {
                        diagnostics.RequestTimedOut();
                        response = LocationBrokerResponse.WithoutTelemetry(LocationBrokerStatus.NoFix);
                    }
                }

                using var responseTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                responseTimeout.CancelAfter(timeout);
                using var responseDisposal = responseTimeout.Token.Register(
                    static state => ((NamedPipeServerStream)state!).Dispose(),
                    pipe);
                await NativeHealthMessageFraming.WriteAsync(pipe, response, responseTimeout.Token);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (OperationCanceledException)
            {
                diagnostics.RequestTimedOut();
            }
            catch (ObjectDisposedException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception) when (exception is IOException
                or UnauthorizedAccessException
                or InvalidDataException
                or ObjectDisposedException)
            {
                diagnostics.RequestFailed();
            }
            finally
            {
                pipe?.Dispose();
            }
        }
    }
}
