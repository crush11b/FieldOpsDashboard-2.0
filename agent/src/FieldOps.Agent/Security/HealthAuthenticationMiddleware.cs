using Microsoft.Net.Http.Headers;
using System.Net.Http.Headers;

namespace FieldOps.Agent.Security;

internal sealed class HealthAuthenticationMiddleware(
    RequestDelegate next,
    AgentCredentialProvider credentialProvider,
    ILogger<HealthAuthenticationMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (context.Request.Headers.ContainsKey(HeaderNames.Origin))
        {
            logger.LogWarning(
                "Rejected browser-origin agent request; Method={Method}; Path={Path}",
                context.Request.Method,
                context.Request.Path);
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        var authorizationValues = context.Request.Headers.Authorization;
        var isValidAuthorization = authorizationValues.Count == 1
            && AuthenticationHeaderValue.TryParse(authorizationValues[0], out var authorization)
            && string.Equals(authorization.Scheme, "Bearer", StringComparison.OrdinalIgnoreCase)
            && authorization.Parameter is not null
            && authorization.Parameter.Length == AgentCredentialProvider.EncodedCredentialLength
            && credentialProvider.IsValid(authorization.Parameter);

        if (!isValidAuthorization)
        {
            logger.LogWarning(
                "Rejected unauthenticated agent request; Method={Method}; Path={Path}",
                context.Request.Method,
                context.Request.Path);
            context.Response.Headers.WWWAuthenticate = "Bearer";
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        await next(context);
    }
}
