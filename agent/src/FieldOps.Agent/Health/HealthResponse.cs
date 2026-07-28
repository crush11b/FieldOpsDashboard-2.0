namespace FieldOps.Agent.Health;

internal sealed record HealthResponse(
    string Status,
    string Service,
    string Version,
    DateTimeOffset StartedAt,
    DateTimeOffset CheckedAt,
    long UptimeSeconds);
