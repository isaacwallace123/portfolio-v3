namespace IsaacWallace.Api.Auth;

// Resolves a presented API-key string to its identity, or null when the key is unknown or disabled.
// The authority is the auth service (auth.isaacwallace.dev): this API holds no key material and asks
// auth to validate every key (see AuthIntrospectionApiKeyStore).
public interface IApiKeyStore
{
    Task<ApiKeyRecord?> ResolveAsync(string presentedKey, CancellationToken cancellationToken = default);
}
