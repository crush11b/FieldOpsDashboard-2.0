namespace FieldOps.Agent.Location;

public interface ISerialNmeaLocationService
{
    Task<LocationObservation> AcquireAsync(CancellationToken cancellationToken);
    Task<NmeaTimeEvidence> AcquireTimeAsync(CancellationToken cancellationToken);
}

public sealed class SerialNmeaLocationService(SerialNmeaLocationProvider provider) : ISerialNmeaLocationService, IDisposable
{
    public Task<LocationObservation> AcquireAsync(CancellationToken cancellationToken) => provider.GetLocationAsync(cancellationToken);
    public Task<NmeaTimeEvidence> AcquireTimeAsync(CancellationToken cancellationToken) => provider.GetTimeEvidenceAsync(cancellationToken);
    public void Dispose() => provider.Dispose();
}
