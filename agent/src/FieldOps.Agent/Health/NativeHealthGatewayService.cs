using FieldOps.NativeHealth;

namespace FieldOps.Agent.Health;

internal sealed class NativeHealthGatewayService(
    NativeHealthGatewayServer server,
    ILogger<NativeHealthGatewayService> logger) : BackgroundService
{
    internal static readonly EventId PipeOwnershipFailureEvent = new(2303, "NativeHealthPipeOwnershipFailure");
    internal static readonly EventId PipeRecoveryFailureEvent = new(2304, "NativeHealthPipeRecoveryFailure");
    private const int OwnershipFailureLogInterval = 20;
    private static readonly TimeSpan MaximumRetryDelay = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var consecutiveFailures = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await server.RunAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (NativeHealthPipeOwnershipException)
            {
                consecutiveFailures++;
                if (ShouldLogFailure(consecutiveFailures))
                {
                    logger.LogWarning(
                        PipeOwnershipFailureEvent,
                        "Native health gateway could not acquire exclusive ownership of the fixed pipe; access remains unavailable");
                }

                await Task.Delay(GetRetryDelay(consecutiveFailures), stoppingToken);
            }
            catch (NativeHealthPipeRecoveryException)
            {
                consecutiveFailures = 1;
                if (ShouldLogFailure(consecutiveFailures))
                {
                    logger.LogWarning(
                        PipeRecoveryFailureEvent,
                        "Native health gateway could not recycle the fixed pipe safely; access remains unavailable while ownership is reacquired");
                }

                await Task.Delay(GetRetryDelay(consecutiveFailures), stoppingToken);
            }
        }
    }

    internal static TimeSpan GetRetryDelay(int consecutiveFailures)
    {
        var exponent = Math.Clamp(consecutiveFailures - 1, 0, 7);
        var delay = TimeSpan.FromMilliseconds(250 * Math.Pow(2, exponent));
        return delay <= MaximumRetryDelay ? delay : MaximumRetryDelay;
    }

    internal static bool ShouldLogFailure(int consecutiveFailures) =>
        consecutiveFailures == 1 || consecutiveFailures % OwnershipFailureLogInterval == 0;
}
