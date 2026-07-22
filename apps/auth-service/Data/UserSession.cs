namespace IsaacWallace.Auth.Data;

/// <summary>
/// One signed-in device/browser. Created at sign-in, its id rides in the cookie as a claim, and
/// the cookie is re-validated against this row on every request — so revoking a row here kills
/// that device's session network-wide, immediately. Rows are soft-revoked (RevokedUtc) so the
/// account page can distinguish "signed out" from "never existed", then pruned later.
/// </summary>
public class UserSession
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string UserId { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
    public DateTime LastSeenUtc { get; set; }
    /// <summary>Raw User-Agent, truncated — the client renders it as "Chrome · Windows".</summary>
    public string UserAgent { get; set; } = "";
    /// <summary>Client IP as seen through the forwarded headers (Cloudflare in prod).</summary>
    public string Ip { get; set; } = "";
    public DateTime? RevokedUtc { get; set; }
}
