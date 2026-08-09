using System.IO.Ports;

namespace FieldOps.Agent.Location;

internal interface INmeaSerialReader : IDisposable
{
    void Open();
    Task<string?> ReadLineAsync(CancellationToken cancellationToken);
}

internal sealed class SerialPortNmeaReader(string portName, int baudRate) : INmeaSerialReader
{
    private readonly SerialPort port = new(portName, baudRate, Parity.None, 8, StopBits.One) { Handshake = Handshake.None, ReadTimeout = 250 };
    public void Open() => port.Open();
    public async Task<string?> ReadLineAsync(CancellationToken cancellationToken)
    {
        try { return await Task.Run(port.ReadLine, cancellationToken); }
        catch (TimeoutException) { return null; }
    }
    public void Dispose() => port.Dispose();
}
