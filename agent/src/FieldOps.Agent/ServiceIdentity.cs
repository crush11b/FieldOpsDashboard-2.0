using System.Reflection;

namespace FieldOps.Agent;

internal sealed class ServiceIdentity(TimeProvider timeProvider)
{
    public const string Name = "FieldOpsAgent";

    public DateTimeOffset StartedAt { get; } = timeProvider.GetUtcNow();

    public string Version { get; } =
        typeof(ServiceIdentity).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion
        ?? "unknown";
}
