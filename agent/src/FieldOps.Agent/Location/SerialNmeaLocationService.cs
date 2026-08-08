namespace FieldOps.Agent.Location;

public interface ISerialNmeaLocationService
{
    Task<LocationObservation> AcquireAsync(CancellationToken cancellationToken);
}

public sealed class SerialNmeaLocationService(SerialNmeaLocationProvider provider) : ISerialNmeaLocationService, IDisposable
{
    private readonly SemaphoreSlim gate = new(1, 1);

    public async Task<LocationObservation> AcquireAsync(CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken);
        try { return await provider.GetLocationAsync(cancellationToken); }
        finally { gate.Release(); }
    }

    public void Dispose() => gate.Dispose();
}
