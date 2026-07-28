using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using FieldOps.Agent.Telemetry;
using FieldOps.Agent.Telemetry.Delivery;

namespace FieldOps.Agent.Tests;

public sealed class HttpTelemetryDestinationTests
{
    private static readonly TimeSpan TestTimeout = TimeSpan.FromSeconds(5);
    private static readonly Uri Endpoint = new("http://127.0.0.1:43121/api/v1/telemetry");

    public static TheoryData<int> SuccessfulStatuses => new()
    {
        (int)HttpStatusCode.OK,
        (int)HttpStatusCode.Created,
        (int)HttpStatusCode.Accepted,
        (int)HttpStatusCode.NoContent,
    };

    public static TheoryData<int, int> FailedStatuses => new()
    {
        { (int)HttpStatusCode.BadRequest, (int)TelemetryDeliveryFailureKind.InvalidRequest },
        { (int)HttpStatusCode.Unauthorized, (int)TelemetryDeliveryFailureKind.Authentication },
        { (int)HttpStatusCode.Forbidden, (int)TelemetryDeliveryFailureKind.Authentication },
        { (int)HttpStatusCode.NotFound, (int)TelemetryDeliveryFailureKind.EndpointNotFound },
        { (int)HttpStatusCode.Conflict, (int)TelemetryDeliveryFailureKind.Conflict },
        { (int)HttpStatusCode.TooManyRequests, (int)TelemetryDeliveryFailureKind.RateLimited },
        { (int)HttpStatusCode.InternalServerError, (int)TelemetryDeliveryFailureKind.ServerFailure },
        { (int)HttpStatusCode.ServiceUnavailable, (int)TelemetryDeliveryFailureKind.ServerFailure },
        { (int)HttpStatusCode.Redirect, (int)TelemetryDeliveryFailureKind.ProtocolFailure },
        { (int)HttpStatusCode.UnprocessableEntity, (int)TelemetryDeliveryFailureKind.ProtocolFailure },
        { 600, (int)TelemetryDeliveryFailureKind.ProtocolFailure },
    };

    [Fact]
    public async Task SendsOneAuthenticatedJsonPostToExactEndpoint()
    {
        HttpRequestMessage? capturedRequest = null;
        string? capturedBody = null;
        var handler = new DelegateHandler(async (request, cancellationToken) =>
        {
            capturedRequest = request;
            capturedBody = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.Accepted);
        });
        using var client = new HttpClient(handler);
        var authenticator = new FakeAuthenticator("test-bearer-token");
        var destination = CreateDestination(client, authenticator);

        await destination.SendAsync(Envelope()).AsTask().WaitAsync(TestTimeout);

        Assert.NotNull(capturedRequest);
        Assert.Equal(HttpMethod.Post, capturedRequest.Method);
        Assert.Equal(Endpoint, capturedRequest.RequestUri);
        Assert.Equal("application/json", capturedRequest.Content!.Headers.ContentType!.MediaType);
        Assert.Equal("Bearer", capturedRequest.Headers.Authorization!.Scheme);
        Assert.Equal("test-bearer-token", capturedRequest.Headers.Authorization.Parameter);
        Assert.Equal(1, authenticator.Calls);
        using var body = JsonDocument.Parse(capturedBody!);
        Assert.Equal("ok", body.RootElement.GetProperty("status").GetString());
        Assert.Equal(73, body.RootElement.GetProperty("data").GetProperty("percent").GetInt32());
    }

    [Theory]
    [MemberData(nameof(SuccessfulStatuses))]
    public async Task AcceptsEverySuccessfulHttpResponse(int statusCode)
    {
        using var client = new HttpClient(new DelegateHandler(
            (_, _) => Task.FromResult(new HttpResponseMessage((HttpStatusCode)statusCode))));
        var destination = CreateDestination(client);

        await destination.SendAsync(Envelope()).AsTask().WaitAsync(TestTimeout);
    }

    [Theory]
    [MemberData(nameof(FailedStatuses))]
    public async Task ClassifiesHttpFailures(int statusCode, int expectedFailureKind)
    {
        using var client = new HttpClient(new DelegateHandler((_, _) =>
        {
            var response = new HttpResponseMessage((HttpStatusCode)statusCode);
            if ((HttpStatusCode)statusCode == HttpStatusCode.TooManyRequests)
            {
                response.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(12));
            }
            return Task.FromResult(response);
        }));
        var destination = CreateDestination(client);

        var exception = await Assert.ThrowsAsync<TelemetryDeliveryException>(async () =>
            await destination.SendAsync(Envelope()).AsTask().WaitAsync(TestTimeout));

        Assert.Equal((TelemetryDeliveryFailureKind)expectedFailureKind, exception.FailureKind);
        Assert.Equal((HttpStatusCode)statusCode, exception.StatusCode);
        Assert.Equal(
            (HttpStatusCode)statusCode == HttpStatusCode.TooManyRequests ? TimeSpan.FromSeconds(12) : null,
            exception.RetryAfter);
    }

    [Fact]
    public async Task PropagatesCallerCancellation()
    {
        using var client = new HttpClient(new DelegateHandler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.Accepted);
        }));
        var destination = CreateDestination(client);
        using var cancellation = new CancellationTokenSource();
        var send = destination.SendAsync(Envelope(), cancellation.Token).AsTask();

        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            await send.WaitAsync(TestTimeout));
        Assert.True(send.IsCanceled);
    }

    [Fact]
    public async Task ClassifiesHttpClientTimeout()
    {
        using var client = new HttpClient(new DelegateHandler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.Accepted);
        }))
        {
            Timeout = TimeSpan.FromMilliseconds(50),
        };
        var destination = CreateDestination(client);

        var exception = await Assert.ThrowsAsync<TelemetryDeliveryException>(async () =>
            await destination.SendAsync(Envelope()).AsTask().WaitAsync(TestTimeout));

        Assert.Equal(TelemetryDeliveryFailureKind.Timeout, exception.FailureKind);
        Assert.Null(exception.StatusCode);
    }

    [Fact]
    public async Task ClassifiesNetworkFailureWithoutLeakingInnerMessage()
    {
        const string sensitiveText = "token=secret-value";
        using var client = new HttpClient(new DelegateHandler(
            (_, _) => throw new HttpRequestException($"Could not reach destination?{sensitiveText}")));
        var destination = CreateDestination(client);

        var exception = await Assert.ThrowsAsync<TelemetryDeliveryException>(async () =>
            await destination.SendAsync(Envelope()).AsTask().WaitAsync(TestTimeout));

        Assert.Equal(TelemetryDeliveryFailureKind.Network, exception.FailureKind);
        Assert.DoesNotContain(sensitiveText, exception.ToString(), StringComparison.Ordinal);
        Assert.Null(exception.InnerException);
    }

    [Fact]
    public async Task DoesNotIncludeRequestOrResponseSecretsInHttpException()
    {
        const string requestSecret = "request-secret";
        const string responseSecret = "response-secret";
        var endpoint = new Uri($"{Endpoint}?token={requestSecret}");
        using var client = new HttpClient(new DelegateHandler((_, _) => Task.FromResult(
            new HttpResponseMessage(HttpStatusCode.BadRequest)
            {
                Content = new StringContent(responseSecret),
            })));
        var destination = CreateDestination(client, new FakeAuthenticator(requestSecret), endpoint);

        var exception = await Assert.ThrowsAsync<TelemetryDeliveryException>(async () =>
            await destination.SendAsync(EnvelopeWithSecret(requestSecret)).AsTask().WaitAsync(TestTimeout));

        var renderedException = exception.ToString();
        Assert.DoesNotContain(requestSecret, renderedException, StringComparison.Ordinal);
        Assert.DoesNotContain(responseSecret, renderedException, StringComparison.Ordinal);
        Assert.DoesNotContain("token=", renderedException, StringComparison.Ordinal);
    }

    [Fact]
    public async Task DisposesRequestAndResponseAfterSuccess()
    {
        HttpContent? capturedRequestContent = null;
        var responseContent = new TrackingContent();
        using var client = new HttpClient(new DelegateHandler((request, _) =>
        {
            capturedRequestContent = request.Content;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Accepted)
            {
                Content = responseContent,
            });
        }));
        var destination = CreateDestination(client);

        await destination.SendAsync(Envelope()).AsTask().WaitAsync(TestTimeout);

        Assert.True(responseContent.WasDisposed);
        Assert.NotNull(capturedRequestContent);
        await Assert.ThrowsAsync<ObjectDisposedException>(async () =>
            await capturedRequestContent.ReadAsByteArrayAsync().WaitAsync(TestTimeout));
    }

    private static HttpTelemetryDestination CreateDestination(
        HttpClient client,
        ITelemetryRequestAuthenticator? authenticator = null,
        Uri? endpoint = null) =>
        new(
            client,
            endpoint ?? Endpoint,
            new TelemetryEnvelopeSerializer(),
            authenticator ?? new FakeAuthenticator("test-token"));

    private static TelemetryEnvelope Envelope()
    {
        var now = new DateTimeOffset(2026, 7, 28, 16, 0, 0, TimeSpan.Zero);
        return new TelemetryEnvelope(
            TelemetryStatus.Ok,
            new TelemetrySource("battery", "test"),
            new TelemetryTimestamps(now, now),
            JsonSerializer.SerializeToElement(new { percent = 73 }));
    }

    private static TelemetryEnvelope EnvelopeWithSecret(string secret)
    {
        var envelope = Envelope();
        return envelope with { Data = JsonSerializer.SerializeToElement(new { secret }) };
    }

    private sealed class FakeAuthenticator(string token) : ITelemetryRequestAuthenticator
    {
        private int calls;

        public int Calls => Volatile.Read(ref calls);

        public ValueTask AuthenticateAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Interlocked.Increment(ref calls);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return ValueTask.CompletedTask;
        }
    }

    private sealed class DelegateHandler(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> sendAsync) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            sendAsync(request, cancellationToken);
    }

    private sealed class TrackingContent : HttpContent
    {
        public bool WasDisposed { get; private set; }

        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
            Task.CompletedTask;

        protected override bool TryComputeLength(out long length)
        {
            length = 0;
            return true;
        }

        protected override void Dispose(bool disposing)
        {
            WasDisposed = true;
            base.Dispose(disposing);
        }
    }
}
