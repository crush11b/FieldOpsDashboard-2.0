using System.Net;

namespace FieldOps.Agent.Telemetry.Delivery;

internal enum TelemetryDeliveryFailureKind
{
    Timeout,
    Network,
    InvalidRequest,
    Authentication,
    EndpointNotFound,
    Conflict,
    RateLimited,
    ServerFailure,
    ProtocolFailure,
}

internal sealed class TelemetryDeliveryException : Exception
{
    internal TelemetryDeliveryException(
        TelemetryDeliveryFailureKind failureKind,
        string message,
        HttpStatusCode? statusCode = null,
        TimeSpan? retryAfter = null)
        : base(message)
    {
        FailureKind = failureKind;
        StatusCode = statusCode;
        RetryAfter = retryAfter;
    }

    public TelemetryDeliveryFailureKind FailureKind { get; }

    public HttpStatusCode? StatusCode { get; }

    public TimeSpan? RetryAfter { get; }
}
