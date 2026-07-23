namespace IsaacWallace.Api.Auth;

// A resolved API-key identity. Carries no secret material — the presented key has already been
// verified by the store before this is produced.
public sealed record ApiKeyRecord(
    string Id,
    string Name,
    IReadOnlyList<string> Scopes,
    int RateLimitPerMinute);
