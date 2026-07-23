using Microsoft.AspNetCore.Authorization;

namespace IsaacWallace.Api.Auth;

// Well-known API scopes. A key is granted a subset; the `admin` scope satisfies any requirement.
public static class ApiScopes
{
    public const string Admin = "admin";

    // HomeOps run-broker (added in the next slice).
    public const string RunsRead = "runs:read";
    public const string RunsWrite = "runs:write";
}

public sealed class ScopeRequirement(string scope) : IAuthorizationRequirement
{
    public string Scope { get; } = scope;
}

public sealed class ScopeAuthorizationHandler : AuthorizationHandler<ScopeRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, ScopeRequirement requirement)
    {
        var granted = context.User.Claims.Any(c =>
            c.Type == ApiKeyAuthenticationHandler.ScopeClaimType &&
            (c.Value == requirement.Scope || c.Value == ApiScopes.Admin));

        if (granted) context.Succeed(requirement);
        return Task.CompletedTask;
    }
}
