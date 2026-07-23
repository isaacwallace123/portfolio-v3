using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace IsaacWallace.Api.Auth;

// Validates a presented API key by asking the auth service to introspect it. This resource server
// stores no key material and makes no key-lifecycle decisions — it forwards the key over an internal
// channel (X-Internal-Token) and trusts auth's answer. Results (positive AND negative) are cached
// briefly so a burst of calls with the same key does not hammer auth; the cache TTL is the upper
// bound on how long a revoked key keeps working here.
public sealed class AuthIntrospectionApiKeyStore : IApiKeyStore
{
    private readonly HttpClient _http;
    private readonly IMemoryCache _cache;
    private readonly IntrospectionOptions _options;
    private readonly ILogger<AuthIntrospectionApiKeyStore> _log;

    public AuthIntrospectionApiKeyStore(
        HttpClient http,
        IMemoryCache cache,
        IOptions<IntrospectionOptions> options,
        ILogger<AuthIntrospectionApiKeyStore> log)
    {
        _http = http;
        _cache = cache;
        _options = options.Value;
        _log = log;
    }

    public async Task<ApiKeyRecord?> ResolveAsync(string presentedKey, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(presentedKey)) return null;

        // Never key the cache on the secret itself; use its hash.
        var cacheKey = "apikey:" + Convert.ToHexStringLower(
            SHA256.HashData(Encoding.UTF8.GetBytes(presentedKey)));

        if (_cache.TryGetValue<CacheEntry>(cacheKey, out var cached))
            return cached!.Record;

        var record = await IntrospectAsync(presentedKey, cancellationToken);
        _cache.Set(cacheKey, new CacheEntry(record),
            TimeSpan.FromSeconds(Math.Max(1, _options.CacheSeconds)));
        return record;
    }

    private async Task<ApiKeyRecord?> IntrospectAsync(string presentedKey, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_options.AuthBaseUrl) ||
            string.IsNullOrWhiteSpace(_options.IntrospectionToken))
        {
            _log.LogError("ApiAuth is not configured (AuthBaseUrl / IntrospectionToken); rejecting all keys.");
            return null; // fail closed
        }

        try
        {
            using var req = new HttpRequestMessage(
                HttpMethod.Post,
                $"{_options.AuthBaseUrl.TrimEnd('/')}/auth/apikeys/introspect");
            req.Headers.Add("X-Internal-Token", _options.IntrospectionToken);
            req.Content = JsonContent.Create(new { key = presentedKey });

            using var res = await _http.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode)
            {
                _log.LogWarning("Introspection returned {Status}.", (int)res.StatusCode);
                return null;
            }

            var body = await res.Content.ReadFromJsonAsync<IntrospectionResponse>(ct);
            if (body is null || !body.Active) return null;

            return new ApiKeyRecord(
                body.KeyId ?? "",
                body.Name ?? "",
                body.Scopes ?? [],
                body.RateLimitPerMinute > 0 ? body.RateLimitPerMinute : 120);
        }
        catch (Exception ex)
        {
            // Auth unreachable → fail closed (deny), never fail open.
            _log.LogError(ex, "Introspection call failed.");
            return null;
        }
    }

    // Wrapper so a negative result (null) is still a cache hit rather than a repeated round-trip.
    private sealed record CacheEntry(ApiKeyRecord? Record);

    private sealed record IntrospectionResponse
    {
        [JsonPropertyName("active")] public bool Active { get; init; }
        [JsonPropertyName("keyId")] public string? KeyId { get; init; }
        [JsonPropertyName("name")] public string? Name { get; init; }
        [JsonPropertyName("scopes")] public string[]? Scopes { get; init; }
        [JsonPropertyName("rateLimitPerMinute")] public int RateLimitPerMinute { get; init; }
    }
}
