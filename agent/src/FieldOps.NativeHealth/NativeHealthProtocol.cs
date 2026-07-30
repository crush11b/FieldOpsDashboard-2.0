namespace FieldOps.NativeHealth;

public static class NativeHealthProtocol
{
    public const int Version = 1;
    public const int MaximumMessageBytes = 4096;
    public const string PipeName = "FieldOps.Agent.NativeHealth.v1";
    public static readonly TimeSpan ClientOperationTimeout = TimeSpan.FromSeconds(5);
    public static readonly TimeSpan ServerClientProcessingTimeout = TimeSpan.FromSeconds(1);
}

public enum NativeHealthRequestType
{
    ReadHealth = 1,
}

public enum NativeHealthResultCode
{
    Ok = 1,
    Unavailable = 2,
    InvalidRequest = 3,
    UnsupportedRequest = 4,
    UnsupportedVersion = 5,
}

public sealed record NativeHealthRequest(
    int ProtocolVersion,
    Guid CorrelationId,
    NativeHealthRequestType RequestType);

public sealed record NativeHealthSnapshot(
    string Status,
    string Service,
    string Version,
    DateTimeOffset StartedAt,
    DateTimeOffset CheckedAt,
    long UptimeSeconds);

public sealed record NativeHealthResponse(
    int ProtocolVersion,
    Guid CorrelationId,
    NativeHealthResultCode Result,
    NativeHealthSnapshot? Health);

public sealed record NativeHealthAcknowledgement(
    int ProtocolVersion,
    Guid CorrelationId);
