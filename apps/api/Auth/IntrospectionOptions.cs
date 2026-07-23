namespace IsaacWallace.Api.Auth;

// Bound from the "ApiAuth" configuration section. How this resource server reaches the auth service
// to validate API keys, plus the anonymous rate ceiling (a resource-server concern, not auth's).
public sealed class IntrospectionOptions
{
    public const string SectionName = "ApiAuth";

    // Base URL of the auth service, e.g. http://localhost:5170 in dev or the in-cluster service URL.
    public string AuthBaseUrl { get; set; } = "";

    // Shared secret sent as X-Internal-Token; must match auth's Auth:IntrospectionToken.
    public string IntrospectionToken { get; set; } = "";

    // How long to cache an introspection result (positive or negative). Bounds revocation latency.
    public int CacheSeconds { get; set; } = 30;

    // Requests per minute for unauthenticated callers, partitioned by client IP.
    public int AnonymousRateLimitPerMinute { get; set; } = 30;
}
