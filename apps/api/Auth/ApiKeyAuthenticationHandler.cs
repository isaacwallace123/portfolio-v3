using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace IsaacWallace.Api.Auth;

// Authenticates callers by API key, presented either as `Authorization: Bearer <key>` or the
// `X-API-Key` header. When no key is present the request is left anonymous (NoResult) so public
// endpoints keep working; a present-but-invalid key fails authentication.
public sealed class ApiKeyAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string SchemeName = "ApiKey";
    public const string ScopeClaimType = "scope";

    // Set on HttpContext.Items after a successful auth so the rate limiter and handlers can read the
    // resolved key without re-parsing the header.
    public const string RecordItemKey = "ApiKey";

    private readonly IApiKeyStore _store;

    public ApiKeyAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        IApiKeyStore store)
        : base(options, logger, encoder)
    {
        _store = store;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var presented = ExtractKey();
        if (presented is null)
            return AuthenticateResult.NoResult();

        var record = await _store.ResolveAsync(presented, Context.RequestAborted);
        if (record is null)
            return AuthenticateResult.Fail("Invalid API key.");

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, record.Id),
            new(ClaimTypes.Name, record.Name),
        };
        foreach (var scope in record.Scopes)
            claims.Add(new Claim(ScopeClaimType, scope));

        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
        Context.Items[RecordItemKey] = record;
        return AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName));
    }

    private string? ExtractKey()
    {
        var auth = Request.Headers.Authorization.ToString();
        if (auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            var value = auth["Bearer ".Length..].Trim();
            if (value.Length > 0) return value;
        }

        var header = Request.Headers["X-API-Key"].ToString().Trim();
        return header.Length > 0 ? header : null;
    }
}
