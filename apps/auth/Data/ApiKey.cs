namespace IsaacWallace.Auth.Data;

/// <summary>
/// A machine-to-machine API key for the portfolio network's resource servers (api.isaacwallace.dev).
/// auth is the authority: it issues these, stores only the SHA-256 <see cref="Hash"/> (the plaintext
/// is shown once at creation and never again), and revokes them. Resource servers never hold key
/// material — they validate a presented key via the introspection endpoint. Revoke by setting
/// <see cref="RevokedUtc"/>, mirroring the UserSession model.
/// </summary>
public class ApiKey
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";

    /// <summary>Lowercase hex SHA-256 of the full key string. The secret itself is never stored.</summary>
    public string Hash { get; set; } = "";

    /// <summary>Comma-separated scopes, e.g. "runs:read,runs:write".</summary>
    public string Scopes { get; set; } = "";

    /// <summary>The admin who issued the key (AspNetUsers.Id), for the audit trail.</summary>
    public string? OwnerUserId { get; set; }

    public int RateLimitPerMinute { get; set; } = 120;
    public bool Enabled { get; set; } = true;
    public DateTime CreatedUtc { get; set; }
    public DateTime? LastUsedUtc { get; set; }
    public DateTime? RevokedUtc { get; set; }
}
