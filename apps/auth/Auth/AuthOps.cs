using System.Security.Claims;
using IsaacWallace.Auth.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace IsaacWallace.Auth;

// Sign-in helpers shared by the minimal-API auth endpoints (Program.cs) and the server-rendered
// Razor login page (Pages/Login). Extracted here so both paths issue sessions and apply the admin
// allow-list through exactly one implementation. Kept static + parameterised (managers + the
// relevant allow-list passed in) rather than a stateful service — there is nothing to hold.
public static class AuthOps
{
    // Display names are free text from an external provider; cap them before they hit the UI/db.
    public static string Trunc(string s) => s.Length <= 40 ? s : s[..40];

    // Normalise a user-entered profile link: default the scheme to https, require a valid http(s)
    // absolute URL, and cap the length. Returns false for anything that isn't a usable web URL.
    public static bool TryNormalizeUrl(string raw, out string url)
    {
        url = "";
        var s = raw.Trim();
        if (s.Length == 0) return false;
        if (!s.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            && !s.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            s = "https://" + s;
        if (s.Length > 200) return false;
        if (Uri.TryCreate(s, UriKind.Absolute, out var u)
            && (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps))
        {
            url = s;
            return true;
        }
        return false;
    }

    // Only allow redirecting the browser back to a known site origin — never an attacker-supplied URL.
    public static string SafeReturn(string? url, IReadOnlyList<string> allowed)
    {
        var fallback = allowed.FirstOrDefault() ?? "/";
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var abs))
            return fallback;
        var origin = $"{abs.Scheme}://{abs.Authority}";
        return allowed.Any(a => string.Equals(a.TrimEnd('/'), origin, StringComparison.OrdinalIgnoreCase))
            ? url
            : fallback;
    }

    // Grant admin to any allow-listed email; called on every sign-in so the list stays authoritative.
    public static async Task ApplyAdminAllowlist(UserManager<AppUser> users, AppUser user, IReadOnlyList<string> adminEmails)
    {
        if (user.Email is not null
            && adminEmails.Any(a => string.Equals(a, user.Email, StringComparison.OrdinalIgnoreCase))
            && !await users.IsInRoleAsync(user, "admin"))
            await users.AddToRoleAsync(user, "admin");
    }

    // Sign in AND open a revocable server-side session: the row is created first, then its id rides in
    // the cookie as the "iw:sid" claim that OnValidatePrincipal re-checks on every request.
    public static async Task SignInWithSession(HttpContext ctx, SignInManager<AppUser> signIn, AppDbContext db, AppUser user)
    {
        var now = DateTime.UtcNow;
        var ua = ctx.Request.Headers.UserAgent.ToString();
        var session = new UserSession
        {
            UserId = user.Id,
            CreatedUtc = now,
            LastSeenUtc = now,
            UserAgent = ua.Length <= 256 ? ua : ua[..256],
            Ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "",
        };
        db.UserSessions.Add(session);
        // opportunistic hygiene: drop this user's long-dead rows so the table never needs a janitor
        var deadRevoked = now.AddDays(-30);
        var deadIdle = now.AddDays(-60);
        var dead = await db.UserSessions
            .Where(s => s.UserId == user.Id
                && ((s.RevokedUtc != null && s.RevokedUtc < deadRevoked) || s.LastSeenUtc < deadIdle))
            .ToListAsync();
        db.UserSessions.RemoveRange(dead);
        await db.SaveChangesAsync();
        await signIn.SignInWithClaimsAsync(user, isPersistent: true, [new Claim("iw:sid", session.Id)]);
    }
}

// What the login page needs to render, plus the allow-lists the sign-in helpers consult. Built once
// at startup and registered as a singleton so the page and the /auth/providers endpoint agree.
public sealed record AuthUi(
    IReadOnlyList<string> Providers,
    bool DevLoginEnabled,
    IReadOnlyList<string> AdminEmails,
    IReadOnlyList<string> AllowedOrigins);
