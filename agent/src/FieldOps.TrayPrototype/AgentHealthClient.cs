using FieldOps.NativeHealth;

namespace FieldOps.TrayPrototype;

public interface IAgentHealthClient
{
    Task<AgentHealthResult> ReadAsync(CancellationToken cancellationToken);
}

public enum AgentHealthState
{
    Healthy,
    Degraded,
    Unhealthy,
    Unavailable,
    ProtocolMismatch,
    Rejected,
    Timeout,
    AccessDenied,
    Canceled,
}

public sealed record AgentHealthResult(AgentHealthState State, string Detail);

internal interface INativeHealthReader
{
    Task<NativeHealthResponse> ReadAsync(CancellationToken cancellationToken);
}

internal sealed class SharedNativeHealthReader(NativeHealthClient client) : INativeHealthReader
{
    public Task<NativeHealthResponse> ReadAsync(CancellationToken cancellationToken) =>
        client.ReadAsync(cancellationToken);
}

internal sealed class NativeAgentHealthClient(INativeHealthReader reader) : IAgentHealthClient
{
    public async Task<AgentHealthResult> ReadAsync(CancellationToken cancellationToken)
    {
        try
        {
            var response = await reader.ReadAsync(cancellationToken);
            if (response.Result == NativeHealthResultCode.UnsupportedVersion)
            {
                return new(AgentHealthState.ProtocolMismatch, "Native health protocol is incompatible.");
            }

            if (response.Result is NativeHealthResultCode.InvalidRequest
                or NativeHealthResultCode.UnsupportedRequest)
            {
                return new(AgentHealthState.Rejected, "Native health response was rejected.");
            }

            if (response.Result != NativeHealthResultCode.Ok || response.Health is null)
            {
                return new(AgentHealthState.Unavailable, "Native health is unavailable.");
            }

            return response.Health.Status.ToLowerInvariant() switch
            {
                "ok" => new(AgentHealthState.Healthy, "Native health reports healthy."),
                "degraded" => new(AgentHealthState.Degraded, "Native health reports degraded."),
                _ => new(AgentHealthState.Unhealthy, "Native health did not report healthy."),
            };
        }
        catch (NativeHealthProtocolMismatchException)
        {
            return new(AgentHealthState.ProtocolMismatch, "Native health protocol is incompatible.");
        }
        catch (NativeHealthResponseRejectedException)
        {
            return new(AgentHealthState.Rejected, "Native health response was rejected.");
        }
        catch (UnauthorizedAccessException)
        {
            return new(AgentHealthState.AccessDenied, "Native health access was denied.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return new(AgentHealthState.Canceled, "Native health refresh was canceled.");
        }
        catch (OperationCanceledException)
        {
            return new(AgentHealthState.Timeout, "Native health request timed out.");
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException)
        {
            return new(AgentHealthState.Unavailable, "Native health is unavailable.");
        }
    }
}
