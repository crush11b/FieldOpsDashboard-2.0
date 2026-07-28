using System.Net;
using System.Net.Http.Headers;

namespace FieldOps.Agent.Telemetry.Delivery;

internal sealed class HttpTelemetryDestination : ITelemetryDestination
{
    private readonly HttpClient httpClient;
    private readonly Uri endpoint;
    private readonly TelemetryEnvelopeSerializer serializer;
    private readonly ITelemetryRequestAuthenticator authenticator;
    private readonly TimeProvider timeProvider;

    public HttpTelemetryDestination(
        HttpClient httpClient,
        Uri endpoint,
        TelemetryEnvelopeSerializer serializer,
        ITelemetryRequestAuthenticator authenticator,
        TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(httpClient);
        ArgumentNullException.ThrowIfNull(endpoint);
        ArgumentNullException.ThrowIfNull(serializer);
        ArgumentNullException.ThrowIfNull(authenticator);
        ArgumentNullException.ThrowIfNull(timeProvider);

        if (!endpoint.IsAbsoluteUri
            || (endpoint.Scheme != Uri.UriSchemeHttp && endpoint.Scheme != Uri.UriSchemeHttps))
        {
            throw new ArgumentException("The telemetry endpoint must be an absolute HTTP or HTTPS URI.", nameof(endpoint));
        }

        this.httpClient = httpClient;
        this.endpoint = endpoint;
        this.serializer = serializer;
        this.authenticator = authenticator;
        this.timeProvider = timeProvider;
    }

    public async ValueTask SendAsync(
        TelemetryEnvelope envelope,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(envelope);

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new ByteArrayContent(serializer.Serialize(envelope)),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");

        try
        {
            await authenticator.AuthenticateAsync(request, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            throw new TelemetryDeliveryException(
                TelemetryDeliveryFailureKind.AuthenticationConfiguration,
                "Telemetry request authentication was cancelled before completion.");
        }
        catch (Exception exception) when (exception is not OutOfMemoryException and not StackOverflowException and not AccessViolationException)
        {
            throw new TelemetryDeliveryException(
                TelemetryDeliveryFailureKind.AuthenticationConfiguration,
                "Telemetry request authentication could not be applied.");
        }

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            throw new TelemetryDeliveryException(
                TelemetryDeliveryFailureKind.Timeout,
                "Telemetry delivery timed out.");
        }
        catch (HttpRequestException)
        {
            throw new TelemetryDeliveryException(
                TelemetryDeliveryFailureKind.Network,
                "Telemetry delivery failed because the destination could not be reached.");
        }

        using (response)
        {
            if (response.IsSuccessStatusCode)
            {
                return;
            }

            throw CreateResponseException(response);
        }
    }

    private TelemetryDeliveryException CreateResponseException(HttpResponseMessage response)
    {
        var statusCode = response.StatusCode;
        var failureKind = statusCode switch
        {
            HttpStatusCode.BadRequest => TelemetryDeliveryFailureKind.InvalidRequest,
            HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => TelemetryDeliveryFailureKind.Authentication,
            HttpStatusCode.NotFound => TelemetryDeliveryFailureKind.EndpointNotFound,
            HttpStatusCode.Conflict => TelemetryDeliveryFailureKind.Conflict,
            HttpStatusCode.TooManyRequests => TelemetryDeliveryFailureKind.RateLimited,
            _ when (int)statusCode is >= 500 and <= 599 => TelemetryDeliveryFailureKind.ServerFailure,
            _ => TelemetryDeliveryFailureKind.ProtocolFailure,
        };

        return new TelemetryDeliveryException(
            failureKind,
            $"Telemetry delivery was rejected with HTTP status {(int)statusCode}.",
            statusCode,
            failureKind == TelemetryDeliveryFailureKind.RateLimited
                ? GetRetryAfter(response)
                : null);
    }

    private TimeSpan? GetRetryAfter(HttpResponseMessage response)
    {
        try
        {
            var retryAfter = response.Headers.RetryAfter;
            if (retryAfter?.Delta is { } delta)
            {
                return delta;
            }

            if (retryAfter?.Date is { } date)
            {
                var remaining = date - timeProvider.GetUtcNow();
                return remaining > TimeSpan.Zero ? remaining : TimeSpan.Zero;
            }
        }
        catch (FormatException)
        {
            // Malformed optional guidance does not change failure classification.
        }

        return null;
    }
}
