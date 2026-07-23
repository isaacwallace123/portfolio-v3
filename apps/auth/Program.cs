using System.Security.Claims;
using System.Threading.RateLimiting;
using IsaacWallace.Auth;
using IsaacWallace.Auth.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

// auth.isaacwallace.dev — the dedicated identity service for the portfolio network. Its own .NET
// project and image, wholly separate from the general app API (api.isaacwallace.dev). In production
// it is reached under the auth domain via edge path-routing (/auth/*, /signin-*); the Next portal
// (apps/auth) serves the sign-in UI on the same host.
//
// Auth model: session SSO for every *.isaacwallace.dev site via one cookie scoped to the parent
// domain. Identity is proven by an EXTERNAL provider (Google / GitHub) — we store NO passwords.
// A breach of this database exposes emails + role assignments, never credentials.
//   • who is admin: the Auth:AdminEmails allow-list (seeded at startup + applied on every sign-in),
//     plus admins can promote/demote others at runtime.
//   • local dev: a Development-only /auth/dev-login (email, no provider) keeps the loop fast;
//     it is never mapped outside Development.

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

var adminEmails = config.GetSection("Auth:AdminEmails").Get<string[]>() ?? [];
var corsOrigins = config.GetSection("Cors:Origins").Get<string[]>() ?? [];
var cookieDomain = config["Auth:CookieDomain"]; // empty in dev → host-only "localhost"

// Postgres when a connection string is provided (docker compose does), SQLite otherwise — the
// zero-setup default for running the API bare on the host.
var postgres = config.GetConnectionString("Postgres");
builder.Services.AddDbContext<AppDbContext>(o =>
{
    if (!string.IsNullOrWhiteSpace(postgres)) o.UseNpgsql(postgres);
    else o.UseSqlite(config.GetConnectionString("Default") ?? "Data Source=app.db");
});

builder.Services
    .AddIdentityCore<AppUser>(o =>
    {
        o.User.RequireUniqueEmail = false; // some providers (private GitHub email) yield no address
        o.SignIn.RequireConfirmedAccount = false;
    })
    .AddRoles<IdentityRole>()
    .AddEntityFrameworkStores<AppDbContext>()
    .AddSignInManager();

// Identity application + external cookies, then bolt the configured OAuth providers onto the same
// authentication builder. A provider is only wired up when its client id/secret are present, so the
// API runs fine locally with none configured (you use dev-login there).
var auth = builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme);
auth.AddIdentityCookies();

var providers = new List<string>();

var googleId = config["Auth:Google:ClientId"];
var googleSecret = config["Auth:Google:ClientSecret"];
if (!string.IsNullOrWhiteSpace(googleId) && !string.IsNullOrWhiteSpace(googleSecret))
{
    auth.AddGoogle(o =>
    {
        o.ClientId = googleId;
        o.ClientSecret = googleSecret;
        o.SignInScheme = IdentityConstants.ExternalScheme;
    });
    providers.Add("Google");
}

var githubId = config["Auth:GitHub:ClientId"];
var githubSecret = config["Auth:GitHub:ClientSecret"];
if (!string.IsNullOrWhiteSpace(githubId) && !string.IsNullOrWhiteSpace(githubSecret))
{
    auth.AddGitHub(o =>
    {
        o.ClientId = githubId;
        o.ClientSecret = githubSecret;
        o.SignInScheme = IdentityConstants.ExternalScheme;
        o.Scope.Add("user:email");
    });
    providers.Add("GitHub");
}

// Data Protection keys sign the session cookie. In a container they must outlive the pod, or every
// restart/scale invalidates everyone's session. When DataProtection:KeyPath is set (k8s mounts a
// persistent volume there) keys live on disk; unset in local dev → default in-memory behaviour.
var dpKeyPath = config["DataProtection:KeyPath"];
if (!string.IsNullOrWhiteSpace(dpKeyPath))
    builder.Services.AddDataProtection()
        .PersistKeysToFileSystem(new DirectoryInfo(dpKeyPath))
        .SetApplicationName("isaacwallace");

builder.Services.ConfigureApplicationCookie(o =>
{
    o.Cookie.Name = "iw_session";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Lax;
    // In prod the app sits behind cloudflared/Cloudflare, so the hop it sees is plain HTTP even
    // though the client is HTTPS — pin Secure on rather than inferring it from the internal scheme.
    o.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest
        : CookieSecurePolicy.Always;
    if (!string.IsNullOrWhiteSpace(cookieDomain)) o.Cookie.Domain = cookieDomain;
    o.ExpireTimeSpan = TimeSpan.FromDays(30);
    o.SlidingExpiration = true;
    // An API returns status codes, not login-page redirects.
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    // Server-side sessions: every cookie carries the id of a UserSessions row (the "sid" claim)
    // and is re-checked here on each request. Revoke the row → the cookie dies everywhere, now —
    // a stolen or forgotten session can be killed from the account page. Chains Identity's own
    // security-stamp validation first so we lose none of its guarantees.
    o.Events.OnValidatePrincipal = async ctx =>
    {
        await SecurityStampValidator.ValidatePrincipalAsync(ctx);
        if (ctx.Principal?.Identity?.IsAuthenticated != true) return;
        var sid = ctx.Principal.FindFirstValue("iw:sid");
        if (sid is null) return; // pre-sessions cookie: still valid, just not revocable
        var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var session = await db.UserSessions.FindAsync(sid);
        if (session is null || session.RevokedUtc is not null)
        {
            ctx.RejectPrincipal();
            await ctx.HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
            return;
        }
        // touch "last seen" at most once a minute — enough for the UI, cheap on the db
        if (DateTime.UtcNow - session.LastSeenUtc > TimeSpan.FromMinutes(1))
        {
            session.LastSeenUtc = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
    };
});

// When Identity refreshes the cookie principal (security-stamp check, every ~30 min) it rebuilds
// claims from the factory — which knows nothing of our session id. Copy it across or every session
// would silently degrade into a non-revocable legacy cookie after the first refresh.
builder.Services.Configure<SecurityStampValidatorOptions>(o =>
{
    o.OnRefreshingPrincipal = ctx =>
    {
        var sid = ctx.CurrentPrincipal?.FindFirstValue("iw:sid");
        if (sid is not null
            && ctx.NewPrincipal?.Identities.FirstOrDefault() is { } identity
            && identity.FindFirst("iw:sid") is null)
            identity.AddClaim(new Claim("iw:sid", sid));
        return Task.CompletedTask;
    };
});

builder.Services.AddAuthorizationBuilder().AddPolicy("admin", p => p.RequireRole("admin"));
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(corsOrigins)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

// The sign-in entry points are brute-force / abuse targets; throttle per client IP. /auth/me and
// the OAuth redirect dance stay unthrottled.
var permitLimit = config.GetValue("Auth:RateLimit:PermitLimit", 10);
var windowSeconds = config.GetValue("Auth:RateLimit:WindowSeconds", 60);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permitLimit,
            Window = TimeSpan.FromSeconds(windowSeconds),
        }));
});

builder.Services.AddOpenApi();

// The server-rendered sign-in page lives here now (folded in from the old Next portal). What it needs
// to render — the wired providers, whether dev-login exists, and the allow-lists the sign-in helpers
// consult — is captured once and shared with the /auth/providers endpoint.
var devLoginEnabled = builder.Environment.IsDevelopment() && config.GetValue("Auth:AllowDevLogin", true);
builder.Services.AddSingleton(new AuthUi(providers, devLoginEnabled, adminEmails, corsOrigins));
builder.Services.AddRazorPages();

// Behind cloudflared + Cloudflare: honour X-Forwarded-Proto/For so the app knows the real client
// scheme and IP (rate limiting partitions on IP; auth cares about https).
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    // trust the in-cluster proxy chain; the network boundary is enforced upstream
    o.KnownNetworks.Clear();
    o.KnownProxies.Clear();
});

var app = builder.Build();

app.UseForwardedHeaders();

// The login page's stylesheet (wwwroot/css/site.css) — public, so serve it before auth.
app.UseStaticFiles();

// Create the schema + seed the admin role/allow-list on startup. (EnsureCreated is fine while the
// schema is just Identity; switch to EF migrations before the first real schema change.)
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.EnsureCreatedAsync();
    // EnsureCreated only builds schema for EMPTY databases; existing ones need the sessions table
    // added by hand. IF NOT EXISTS makes this idempotent on both providers. (First real candidate
    // for a move to EF migrations — kept raw here because the schema serves two providers.)
    var isNpgsql = db.Database.ProviderName?.Contains("Npgsql", StringComparison.OrdinalIgnoreCase) == true;
    await db.Database.ExecuteSqlRawAsync(isNpgsql
        ? """
          CREATE TABLE IF NOT EXISTS "UserSessions" (
              "Id" text NOT NULL CONSTRAINT "PK_UserSessions" PRIMARY KEY,
              "UserId" text NOT NULL,
              "CreatedUtc" timestamp with time zone NOT NULL,
              "LastSeenUtc" timestamp with time zone NOT NULL,
              "UserAgent" character varying(256) NOT NULL,
              "Ip" character varying(64) NOT NULL,
              "RevokedUtc" timestamp with time zone NULL
          );
          CREATE INDEX IF NOT EXISTS "IX_UserSessions_UserId" ON "UserSessions" ("UserId");
          """
        : """
          CREATE TABLE IF NOT EXISTS "UserSessions" (
              "Id" TEXT NOT NULL CONSTRAINT "PK_UserSessions" PRIMARY KEY,
              "UserId" TEXT NOT NULL,
              "CreatedUtc" TEXT NOT NULL,
              "LastSeenUtc" TEXT NOT NULL,
              "UserAgent" TEXT NOT NULL,
              "Ip" TEXT NOT NULL,
              "RevokedUtc" TEXT NULL
          );
          CREATE INDEX IF NOT EXISTS "IX_UserSessions_UserId" ON "UserSessions" ("UserId");
          """);
    // Same story for the theme column on the existing AspNetUsers table: EnsureCreated won't alter
    // it. Postgres has ADD COLUMN IF NOT EXISTS natively; SQLite doesn't, so probe pragma first.
    if (isNpgsql)
    {
        await db.Database.ExecuteSqlRawAsync(
            """ALTER TABLE "AspNetUsers" ADD COLUMN IF NOT EXISTS "ThemePreference" text NOT NULL DEFAULT 'system';""");
    }
    else
    {
        var hasTheme = false;
        var conn = db.Database.GetDbConnection();
        await conn.OpenAsync();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT 1 FROM pragma_table_info('AspNetUsers') WHERE name = 'ThemePreference';";
            hasTheme = await cmd.ExecuteScalarAsync() is not null;
        }
        if (!hasTheme)
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "AspNetUsers" ADD COLUMN "ThemePreference" TEXT NOT NULL DEFAULT 'system';""");
    }
    // The nullable profile-link columns (LinkedIn / website), same EnsureCreated caveat as the theme
    // column above. Keep complete statements constant so neither the SQL nor its identifiers are
    // ever assembled from runtime input.
    var profileColumns = new[]
    {
        new
        {
            Postgres = """ALTER TABLE "AspNetUsers" ADD COLUMN IF NOT EXISTS "LinkedInUrl" text NULL;""",
            Probe = "SELECT 1 FROM pragma_table_info('AspNetUsers') WHERE name = 'LinkedInUrl';",
            Sqlite = """ALTER TABLE "AspNetUsers" ADD COLUMN "LinkedInUrl" TEXT NULL;"""
        },
        new
        {
            Postgres = """ALTER TABLE "AspNetUsers" ADD COLUMN IF NOT EXISTS "WebsiteUrl" text NULL;""",
            Probe = "SELECT 1 FROM pragma_table_info('AspNetUsers') WHERE name = 'WebsiteUrl';",
            Sqlite = """ALTER TABLE "AspNetUsers" ADD COLUMN "WebsiteUrl" TEXT NULL;"""
        }
    };
    foreach (var column in profileColumns)
    {
        if (isNpgsql)
        {
            await db.Database.ExecuteSqlRawAsync(column.Postgres);
        }
        else
        {
            var conn2 = db.Database.GetDbConnection();
            if (conn2.State != System.Data.ConnectionState.Open) await conn2.OpenAsync();
            bool hasCol;
            await using (var cmd = conn2.CreateCommand())
            {
                cmd.CommandText = column.Probe;
                hasCol = await cmd.ExecuteScalarAsync() is not null;
            }
            if (!hasCol)
                await db.Database.ExecuteSqlRawAsync(column.Sqlite);
        }
    }
    var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
    if (!await roles.RoleExistsAsync("admin")) await roles.CreateAsync(new IdentityRole("admin"));
    var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
    foreach (var email in adminEmails)
    {
        var existing = await users.FindByEmailAsync(email);
        if (existing is not null && !await users.IsInRoleAsync(existing, "admin"))
            await users.AddToRoleAsync(existing, "admin");
    }
}

app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// The sign-in UI: server-rendered Razor page at /login; bare root bounces to it (the portal's old
// job). Everything else on this host is the auth API below.
app.MapRazorPages();
app.MapGet("/", () => Results.Redirect("/login"));

// Interactive API reference in dev: /scalar (spec at /openapi/v1.json).
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

static async Task<UserDto> ToDto(UserManager<AppUser> users, AppUser user)
{
    var roles = await users.GetRolesAsync(user);
    var logins = await users.GetLoginsAsync(user);
    return new(user.Id, user.Email ?? "", user.DisplayName, NormalizeTheme(user.ThemePreference),
        [.. roles], user.LinkedInUrl, user.WebsiteUrl,
        [.. logins.Select(l => l.LoginProvider).Distinct()]);
}

// Appearance is a closed set; anything else collapses to the "follow the OS" default.
static string NormalizeTheme(string? t) =>
    t is "light" or "dark" or "system" ? t : "system";

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "isaacwallace-auth" }));

// What the sign-in UI should render: which providers are wired up, and whether dev-login exists.
// The login page renders this server-side; the endpoint stays for programmatic callers, reading the
// same AuthUi so the two never disagree.
app.MapGet("/auth/providers", (AuthUi ui) => Results.Ok(new
{
    providers = ui.Providers,
    devLogin = ui.DevLoginEnabled,
}));

// Step 1: bounce the browser to the provider. returnUrl is where we send them once signed in.
app.MapGet("/auth/login/{provider}", (string provider, string? returnUrl, SignInManager<AppUser> signIn) =>
{
    var scheme = providers.FirstOrDefault(p => string.Equals(p, provider, StringComparison.OrdinalIgnoreCase));
    if (scheme is null)
        return Results.BadRequest(new { error = $"Unknown or unconfigured provider '{provider}'." });
    var target = AuthOps.SafeReturn(returnUrl, corsOrigins);
    var callback = $"/auth/complete?returnUrl={Uri.EscapeDataString(target)}";
    var props = signIn.ConfigureExternalAuthenticationProperties(scheme, callback);
    return Results.Challenge(props, [scheme]);
});

// Step 2: provider has authenticated the user (external cookie set). Find-or-create the local user,
// link the external login, apply the admin allow-list, issue the shared session cookie, and bounce
// back to the site. Redirects (never JSON) because a browser is following this.
app.MapGet("/auth/complete", async (string? returnUrl, HttpContext ctx, SignInManager<AppUser> signIn, UserManager<AppUser> users, AppDbContext db) =>
{
    var target = AuthOps.SafeReturn(returnUrl, corsOrigins);
    var info = await signIn.GetExternalLoginInfoAsync();
    if (info is null) return Results.Redirect(target);

    var user = await users.FindByLoginAsync(info.LoginProvider, info.ProviderKey);
    if (user is null)
    {
        var email = info.Principal.FindFirstValue(ClaimTypes.Email);
        var name = info.Principal.FindFirstValue(ClaimTypes.Name) ?? email ?? info.ProviderKey;
        // If they signed in with a different provider before, link by email rather than duplicate.
        if (!string.IsNullOrWhiteSpace(email)) user = await users.FindByEmailAsync(email);
        if (user is null)
        {
            user = new AppUser
            {
                UserName = email ?? $"{info.LoginProvider}:{info.ProviderKey}",
                Email = email,
                DisplayName = AuthOps.Trunc(name),
            };
            await users.CreateAsync(user); // no password — external identity only
        }
        await users.AddLoginAsync(user, info);
    }

    await AuthOps.ApplyAdminAllowlist(users, user, adminEmails);
    await AuthOps.SignInWithSession(ctx, signIn, db, user);
    await ctx.SignOutAsync(IdentityConstants.ExternalScheme); // drop the temporary external cookie
    return Results.Redirect(target);
});

app.MapPost("/auth/logout", async (ClaimsPrincipal principal, SignInManager<AppUser> signIn, AppDbContext db) =>
{
    // logging out IS revoking this device's session — one code path, one truth
    var sid = principal.FindFirstValue("iw:sid");
    if (sid is not null && await db.UserSessions.FindAsync(sid) is { RevokedUtc: null } session)
    {
        session.RevokedUtc = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }
    await signIn.SignOutAsync();
    return Results.Ok(new { ok = true });
});

app.MapGet("/auth/me", async (ClaimsPrincipal principal, UserManager<AppUser> users) =>
{
    if (principal.Identity?.IsAuthenticated != true)
        return Results.Json(new { error = "Not signed in." }, statusCode: StatusCodes.Status401Unauthorized);
    var user = await users.GetUserAsync(principal);
    if (user is null)
        return Results.Json(new { error = "Not signed in." }, statusCode: StatusCodes.Status401Unauthorized);
    return Results.Ok(await ToDto(users, user));
});

// Update your own profile — display name and/or the network-wide theme. Both fields are optional so
// a single caller (the settings modal) can save either independently. Any signed-in user; not admin-gated.
app.MapPost("/auth/profile", async (UpdateProfileRequest req, UserManager<AppUser> users, ClaimsPrincipal principal) =>
{
    var user = await users.GetUserAsync(principal);
    if (user is null)
        return Results.Json(new { error = "Not signed in." }, statusCode: StatusCodes.Status401Unauthorized);

    // Every field is optional; a caller (settings modal / theme control) sends only what it changes.
    // For the link fields, "not present" (null) leaves them untouched, while an empty string clears
    // them — so saving the theme alone never wipes a user's saved links.
    if (req.DisplayName is null && req.Theme is null && req.LinkedInUrl is null && req.WebsiteUrl is null)
        return Results.BadRequest(new { error = "Nothing to update." });

    if (req.DisplayName is not null)
    {
        var name = req.DisplayName.Trim();
        if (name.Length == 0)
            return Results.BadRequest(new { error = "Display name can't be empty." });
        user.DisplayName = AuthOps.Trunc(name);
    }

    if (req.Theme is not null)
    {
        if (req.Theme is not ("light" or "dark" or "system"))
            return Results.BadRequest(new { error = "Theme must be light, dark, or system." });
        user.ThemePreference = req.Theme;
    }

    if (req.LinkedInUrl is not null)
    {
        if (req.LinkedInUrl.Trim().Length == 0) user.LinkedInUrl = null;
        else if (AuthOps.TryNormalizeUrl(req.LinkedInUrl, out var url)) user.LinkedInUrl = url;
        else return Results.BadRequest(new { error = "LinkedIn must be a valid URL." });
    }

    if (req.WebsiteUrl is not null)
    {
        if (req.WebsiteUrl.Trim().Length == 0) user.WebsiteUrl = null;
        else if (AuthOps.TryNormalizeUrl(req.WebsiteUrl, out var url)) user.WebsiteUrl = url;
        else return Results.BadRequest(new { error = "Website must be a valid URL." });
    }

    await users.UpdateAsync(user);
    return Results.Ok(await ToDto(users, user));
}).RequireAuthorization();

// ── Connected accounts: link/unlink additional external providers to THIS account ───────────────
// Signing in with any linked provider lands the same account; the /auth/complete find-or-create
// already auto-links a new provider by shared email. These endpoints let a signed-in user add or
// remove a provider deliberately from the settings modal.

// Step 1: challenge the provider while already signed in; the callback links it to the current user.
app.MapGet("/auth/connect/{provider}", (string provider, string? returnUrl, SignInManager<AppUser> signIn, UserManager<AppUser> users, ClaimsPrincipal principal) =>
{
    var scheme = providers.FirstOrDefault(p => string.Equals(p, provider, StringComparison.OrdinalIgnoreCase));
    if (scheme is null)
        return Results.BadRequest(new { error = $"Unknown or unconfigured provider '{provider}'." });
    var target = AuthOps.SafeReturn(returnUrl, corsOrigins);
    var callback = $"/auth/connect/complete?returnUrl={Uri.EscapeDataString(target)}";
    // Bind the flow to this user id (XSRF) so a stray external cookie can't be linked to the wrong one.
    var props = signIn.ConfigureExternalAuthenticationProperties(scheme, callback, users.GetUserId(principal));
    return Results.Challenge(props, [scheme]);
}).RequireAuthorization();

// Step 2: the provider authenticated; attach its login to the signed-in account (unless it already
// belongs to someone else), then bounce back to the site. A browser follows this → redirects, not JSON.
app.MapGet("/auth/connect/complete", async (string? returnUrl, HttpContext ctx, SignInManager<AppUser> signIn, UserManager<AppUser> users, ClaimsPrincipal principal) =>
{
    var target = AuthOps.SafeReturn(returnUrl, corsOrigins);
    var user = await users.GetUserAsync(principal);
    if (user is null) return Results.Redirect(target);
    var info = await signIn.GetExternalLoginInfoAsync(user.Id);
    if (info is not null)
    {
        var existing = await users.FindByLoginAsync(info.LoginProvider, info.ProviderKey);
        if (existing is null) await users.AddLoginAsync(user, info); // free to link
        // If it already belongs to THIS user it's a no-op; if to another account we simply don't steal it.
        await ctx.SignOutAsync(IdentityConstants.ExternalScheme);
    }
    return Results.Redirect(target);
}).RequireAuthorization();

// Unlink a provider. Guarded so you can't remove your last sign-in method (there are no passwords).
app.MapDelete("/auth/connections/{provider}", async (string provider, ClaimsPrincipal principal, UserManager<AppUser> users) =>
{
    var user = await users.GetUserAsync(principal);
    if (user is null)
        return Results.Json(new { error = "Not signed in." }, statusCode: StatusCodes.Status401Unauthorized);
    var logins = await users.GetLoginsAsync(user);
    var match = logins.FirstOrDefault(l => string.Equals(l.LoginProvider, provider, StringComparison.OrdinalIgnoreCase));
    if (match is null)
        return Results.NotFound(new { error = "That provider isn't connected." });
    if (logins.Count <= 1)
        return Results.BadRequest(new { error = "You can't remove your only sign-in method." });
    await users.RemoveLoginAsync(user, match.LoginProvider, match.ProviderKey);
    return Results.Ok(await ToDto(users, user));
}).RequireAuthorization();

// ── Sessions: your signed-in devices, and the power to revoke any of them ───────────────────────
// The list is always scoped to the caller — there is deliberately no admin view of other people's
// sessions. Revoking takes effect on the target's very next request (OnValidatePrincipal).

app.MapGet("/auth/sessions", async (ClaimsPrincipal principal, UserManager<AppUser> users, AppDbContext db) =>
{
    var userId = users.GetUserId(principal)!;
    var sid = principal.FindFirstValue("iw:sid");
    var sessions = await db.UserSessions
        .Where(s => s.UserId == userId && s.RevokedUtc == null)
        .OrderByDescending(s => s.LastSeenUtc)
        .ToListAsync();
    return Results.Ok(sessions.Select(s =>
        new SessionDto(s.Id, s.CreatedUtc, s.LastSeenUtc, s.UserAgent, s.Ip, s.Id == sid)));
}).RequireAuthorization();

app.MapDelete("/auth/sessions/{id}", async (string id, ClaimsPrincipal principal, UserManager<AppUser> users, SignInManager<AppUser> signIn, AppDbContext db) =>
{
    var userId = users.GetUserId(principal)!;
    var session = await db.UserSessions.FindAsync(id);
    // 404 for both "doesn't exist" and "not yours" — no probing other accounts' session ids
    if (session is null || session.UserId != userId)
        return Results.NotFound(new { error = "No such session." });
    if (session.RevokedUtc is null)
    {
        session.RevokedUtc = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }
    var current = principal.FindFirstValue("iw:sid") == id;
    if (current) await signIn.SignOutAsync(); // revoking yourself is a logout
    return Results.Ok(new { ok = true, current });
}).RequireAuthorization();

app.MapPost("/auth/sessions/revoke-others", async (ClaimsPrincipal principal, UserManager<AppUser> users, AppDbContext db) =>
{
    var userId = users.GetUserId(principal)!;
    var sid = principal.FindFirstValue("iw:sid");
    var others = await db.UserSessions
        .Where(s => s.UserId == userId && s.RevokedUtc == null && s.Id != sid)
        .ToListAsync();
    foreach (var s in others) s.RevokedUtc = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(new { ok = true, revoked = others.Count });
}).RequireAuthorization();

// ── Admin: users, roles, and assignments (the control plane for the whole network) ──────────────
// "admin" is a protected system role: it can't be deleted, and you can't remove it from yourself.
const string AdminRole = "admin";
static bool ValidRoleName(string? name) =>
    !string.IsNullOrWhiteSpace(name) && System.Text.RegularExpressions.Regex.IsMatch(name, "^[a-z][a-z0-9-]{1,30}$");

app.MapGet("/auth/users", async (UserManager<AppUser> users) =>
{
    var dtos = new List<UserDto>();
    foreach (var u in users.Users.ToList()) dtos.Add(await ToDto(users, u));
    return Results.Ok(dtos.OrderBy(d => d.Email));
}).RequireAuthorization("admin");

app.MapGet("/auth/roles", (RoleManager<IdentityRole> roles) =>
    Results.Ok(roles.Roles.Select(r => r.Name).Where(n => n != null).OrderBy(n => n)
        .Select(n => new RoleDto(n!, n == AdminRole))))
    .RequireAuthorization("admin");

app.MapPost("/auth/roles", async (CreateRoleRequest req, RoleManager<IdentityRole> roles) =>
{
    var name = req.Name?.Trim();
    if (!ValidRoleName(name)) // validate the raw input so "UPPER" is rejected, not silently rewritten
        return Results.BadRequest(new { error = "Role name must be lowercase letters/digits/dashes, 2–31 chars, starting with a letter." });
    if (await roles.RoleExistsAsync(name!))
        return Results.BadRequest(new { error = $"Role '{name}' already exists." });
    var res = await roles.CreateAsync(new IdentityRole(name!));
    if (!res.Succeeded)
        return Results.BadRequest(new { error = string.Join(" ", res.Errors.Select(e => e.Description)) });
    return Results.Ok(new RoleDto(name!, false));
}).RequireAuthorization("admin");

app.MapDelete("/auth/roles/{name}", async (string name, RoleManager<IdentityRole> roles) =>
{
    name = name.ToLowerInvariant();
    if (name == AdminRole) return Results.BadRequest(new { error = "The admin role is protected and can't be deleted." });
    var role = await roles.FindByNameAsync(name);
    if (role is null) return Results.NotFound(new { error = "No such role." });
    await roles.DeleteAsync(role);
    return Results.Ok(new { ok = true });
}).RequireAuthorization("admin");

// Assign or remove one role on one user. Generalises the old admin toggle to any role.
app.MapPost("/auth/users/{id}/roles", async (string id, SetRoleRequest req, UserManager<AppUser> users, RoleManager<IdentityRole> roles, ClaimsPrincipal me) =>
{
    var target = await users.FindByIdAsync(id);
    if (target is null) return Results.NotFound(new { error = "No such user." });
    var role = req.Role?.Trim().ToLowerInvariant();
    if (string.IsNullOrWhiteSpace(role) || !await roles.RoleExistsAsync(role))
        return Results.BadRequest(new { error = "No such role." });

    if (req.Assigned)
    {
        if (!await users.IsInRoleAsync(target, role)) await users.AddToRoleAsync(target, role);
    }
    else
    {
        // Guard against locking yourself out of admin.
        if (role == AdminRole && users.GetUserId(me) == id)
            return Results.BadRequest(new { error = "You can't remove your own admin role." });
        if (await users.IsInRoleAsync(target, role)) await users.RemoveFromRoleAsync(target, role);
    }
    return Results.Ok(await ToDto(users, target));
}).RequireAuthorization("admin");

// ── Development only: sign in with just an email so the local loop needs no OAuth setup. ─────────
// Never mapped outside Development, so it cannot exist in the production image.
if (app.Environment.IsDevelopment() && config.GetValue("Auth:AllowDevLogin", true))
{
    app.MapPost("/auth/dev-login", async (DevLoginRequest req, HttpContext ctx, SignInManager<AppUser> signIn, UserManager<AppUser> users, AppDbContext db) =>
    {
        var email = req.Email?.Trim();
        if (string.IsNullOrWhiteSpace(email))
            return Results.BadRequest(new { error = "Email is required." });

        var user = await users.FindByEmailAsync(email);
        if (user is null)
        {
            user = new AppUser
            {
                UserName = email,
                Email = email,
                DisplayName = AuthOps.Trunc(string.IsNullOrWhiteSpace(req.DisplayName) ? email.Split('@')[0] : req.DisplayName.Trim()),
            };
            await users.CreateAsync(user);
        }
        await AuthOps.ApplyAdminAllowlist(users, user, adminEmails);
        await AuthOps.SignInWithSession(ctx, signIn, db, user);
        return Results.Ok(await ToDto(users, user));
    }).RequireRateLimiting("auth");
}

app.Run();

record UserDto(string Id, string Email, string DisplayName, string Theme, string[] Roles,
    string? LinkedInUrl, string? WebsiteUrl, string[] Connections);
record SessionDto(string Id, DateTime CreatedUtc, DateTime LastSeenUtc, string UserAgent, string Ip, bool Current);
record RoleDto(string Name, bool System);
record CreateRoleRequest(string? Name);
record SetRoleRequest(string? Role, bool Assigned);
record UpdateProfileRequest(string? DisplayName, string? Theme, string? LinkedInUrl, string? WebsiteUrl);
record DevLoginRequest(string? Email, string? DisplayName);

// exposes the entry point to WebApplicationFactory in the integration tests
public partial class Program { }
