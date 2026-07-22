using Microsoft.AspNetCore.Identity;

namespace IsaacWallace.Auth.Data;

public class AppUser : IdentityUser
{
    /// <summary>Public-facing name shown on the sites (e.g. attribution on the cyberlab queue).</summary>
    public string DisplayName { get; set; } = "";

    /// <summary>Network-wide appearance preference: "light" | "dark" | "system". Follows the user
    /// across devices; mirrored into the cross-subdomain <c>iw_theme</c> cookie for no-flash SSR.</summary>
    public string ThemePreference { get; set; } = "system";
}
