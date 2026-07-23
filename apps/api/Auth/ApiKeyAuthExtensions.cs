using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi.Models;

namespace IsaacWallace.Api.Auth;

public static class ApiKeyAuthExtensions
{
    // Registers API-key authentication, scope authorization, and per-caller rate limiting.
    public static IServiceCollection AddHomelabApiAuth(
        this IServiceCollection services, IConfiguration config)
    {
        services.Configure<IntrospectionOptions>(config.GetSection(IntrospectionOptions.SectionName));
        services.AddSingleton<IAuthorizationHandler, ScopeAuthorizationHandler>();

        // Keys are validated by the auth service; this resource server holds none. The store is a
        // typed HttpClient that introspects against auth, with a short in-memory result cache.
        services.AddMemoryCache();
        services.AddHttpClient<IApiKeyStore, AuthIntrospectionApiKeyStore>(c =>
            c.Timeout = TimeSpan.FromSeconds(5));

        services
            .AddAuthentication(ApiKeyAuthenticationHandler.SchemeName)
            .AddScheme<AuthenticationSchemeOptions, ApiKeyAuthenticationHandler>(
                ApiKeyAuthenticationHandler.SchemeName, null);

        services.AddAuthorization();

        // Read the options once at setup for the anonymous ceiling; per-key limits come from the
        // resolved record on HttpContext.Items (set by the auth handler, which runs first).
        var apiAuthOptions =
            config.GetSection(IntrospectionOptions.SectionName).Get<IntrospectionOptions>() ?? new IntrospectionOptions();

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
            {
                if (ctx.Items[ApiKeyAuthenticationHandler.RecordItemKey] is ApiKeyRecord record)
                {
                    return RateLimitPartition.GetFixedWindowLimiter(
                        $"key:{record.Id}",
                        _ => new FixedWindowRateLimiterOptions
                        {
                            PermitLimit = record.RateLimitPerMinute,
                            Window = TimeSpan.FromMinutes(1),
                            QueueLimit = 0,
                        });
                }

                var ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
                return RateLimitPartition.GetFixedWindowLimiter(
                    $"ip:{ip}",
                    _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = apiAuthOptions.AnonymousRateLimitPerMinute,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                    });
            });
        });

        return services;
    }

    // Requires a valid API key (any scope).
    public static RouteHandlerBuilder RequireApiKey(this RouteHandlerBuilder builder)
        => builder.RequireAuthorization(policy => policy
            .AddAuthenticationSchemes(ApiKeyAuthenticationHandler.SchemeName)
            .RequireAuthenticatedUser());

    // Requires a valid API key that carries the given scope (or `admin`).
    public static RouteHandlerBuilder RequireScope(this RouteHandlerBuilder builder, string scope)
        => builder.RequireAuthorization(policy => policy
            .AddAuthenticationSchemes(ApiKeyAuthenticationHandler.SchemeName)
            .RequireAuthenticatedUser()
            .AddRequirements(new ScopeRequirement(scope)));
}

// Advertises the API-key scheme in the OpenAPI document so the Scalar reference shows an auth field.
internal sealed class ApiKeySecuritySchemeTransformer : IOpenApiDocumentTransformer
{
    public Task TransformAsync(
        OpenApiDocument document,
        OpenApiDocumentTransformerContext context,
        CancellationToken cancellationToken)
    {
        document.Components ??= new OpenApiComponents();
        document.Components.SecuritySchemes[ApiKeyAuthenticationHandler.SchemeName] = new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.Http,
            Scheme = "bearer",
            Description =
                "Send your API key as a bearer token (`Authorization: Bearer <key>`) " +
                "or in the `X-API-Key` header.",
        };
        return Task.CompletedTask;
    }
}
