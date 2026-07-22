using System.Security.Claims;
using IsaacWallace.Auth.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace IsaacWallace.Auth.Pages;

// The sign-in turnstile — server-rendered here in the auth service (folded in from the old Next
// portal). Two states, exactly as the portal had: "Sign in" (provider links + dev-login form) and
// "You're signed in" (Continue / Sign out). The provider buttons hand off to the existing
// /auth/login/{provider} endpoints; only logout and dev-login post back to this page.
[AllowAnonymous]
public class LoginModel(
    AuthUi ui,
    UserManager<AppUser> users,
    SignInManager<AppUser> signIn,
    AppDbContext db) : PageModel
{
    public IReadOnlyList<string> Providers => ui.Providers;
    public bool DevLoginEnabled => ui.DevLoginEnabled;

    /// <summary>Validated destination to return to once signed in (never an arbitrary URL).</summary>
    public string Dest { get; private set; } = "";
    public bool SignedIn { get; private set; }
    public string? Email { get; private set; }
    public string? DisplayName { get; private set; }
    public string? Error { get; private set; }

    public async Task OnGet(string? returnUrl)
    {
        Dest = AuthOps.SafeReturn(returnUrl, ui.AllowedOrigins);
        if (User.Identity?.IsAuthenticated == true && await users.GetUserAsync(User) is { } user)
        {
            SignedIn = true;
            Email = user.Email;
            DisplayName = user.DisplayName;
        }
    }

    // Signing out IS revoking this device's session — the same one code path as /auth/logout. Then
    // bounce back to the signed-out page so the state the user sees matches reality.
    public async Task<IActionResult> OnPostLogout(string? returnUrl)
    {
        var dest = AuthOps.SafeReturn(returnUrl, ui.AllowedOrigins);
        var sid = User.FindFirstValue("iw:sid");
        if (sid is not null && await db.UserSessions.FindAsync(sid) is { RevokedUtc: null } session)
        {
            session.RevokedUtc = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
        await signIn.SignOutAsync();
        return Redirect($"/login?returnUrl={Uri.EscapeDataString(dest)}");
    }

    // Development-only: sign in with just an email, mirroring the /auth/dev-login endpoint. Never
    // reachable in production because DevLoginEnabled is false there.
    public async Task<IActionResult> OnPostDevLogin(string? email, string? returnUrl)
    {
        if (!ui.DevLoginEnabled) return NotFound();
        Dest = AuthOps.SafeReturn(returnUrl, ui.AllowedOrigins);

        email = email?.Trim();
        if (string.IsNullOrWhiteSpace(email))
        {
            Error = "Email is required.";
            return Page();
        }

        var user = await users.FindByEmailAsync(email);
        if (user is null)
        {
            user = new AppUser
            {
                UserName = email,
                Email = email,
                DisplayName = AuthOps.Trunc(email.Split('@')[0]),
            };
            await users.CreateAsync(user);
        }
        await AuthOps.ApplyAdminAllowlist(users, user, ui.AdminEmails);
        await AuthOps.SignInWithSession(HttpContext, signIn, db, user);
        return Redirect(Dest);
    }
}
