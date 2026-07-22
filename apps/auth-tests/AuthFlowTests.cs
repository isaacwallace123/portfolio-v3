using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace IsaacWallace.Auth.Tests;

// Integration tests: the real app (routing, Identity, cookies, roles) against a throwaway SQLite
// file. No OAuth providers are configured in tests, so sign-in goes through the Development-only
// /auth/dev-login. One factory per test class; each test uses its own email so state never collides.

public class ApiFactory : WebApplicationFactory<Program>
{
    private readonly string _db = Path.Combine(Path.GetTempPath(), $"iw-test-{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development"); // enables dev-login
        builder.UseSetting("ConnectionStrings:Default", $"Data Source={_db}");
        builder.UseSetting("ConnectionStrings:Postgres", "");
        builder.UseSetting("Auth:AllowDevLogin", "true");
        builder.UseSetting("Auth:RateLimit:PermitLimit", "1000");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try { File.Delete(_db); } catch { /* temp file; best effort */ }
    }
}

public record TestUser(string Id, string Email, string DisplayName, string Theme, string[] Roles);

public class AuthFlowTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static StringContent Json(object o) => new(
        System.Text.Json.JsonSerializer.Serialize(o),
        System.Text.Encoding.UTF8,
        "application/json");

    private static Task<HttpResponseMessage> DevLogin(HttpClient c, string email, string? name = null) =>
        c.PostAsync("/auth/dev-login", Json(new { email, displayName = name }));

    [Fact]
    public async Task Health_ReturnsOk()
    {
        var res = await factory.CreateClient().GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task Providers_ReportsDevLoginAvailable_AndNoOAuthConfigured()
    {
        var doc = await factory.CreateClient().GetFromJsonAsync<ProvidersDto>("/auth/providers");
        Assert.NotNull(doc);
        Assert.True(doc.DevLogin);
        Assert.Empty(doc.Providers);
    }

    [Fact]
    public async Task DevLogin_SignsIn_And_Me_ReturnsUser()
    {
        var client = factory.CreateClient(); // cookie container per client
        var res = await DevLogin(client, "flow@test.dev", "Flow");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var me = await client.GetFromJsonAsync<TestUser>("/auth/me");
        Assert.NotNull(me);
        Assert.Equal("flow@test.dev", me.Email);
        Assert.Equal("Flow", me.DisplayName);
    }

    [Fact]
    public async Task Logout_EndsSession_And_DevLogin_RestoresIt()
    {
        var client = factory.CreateClient();
        await DevLogin(client, "session@test.dev");

        await client.PostAsync("/auth/logout", null);
        var afterLogout = await client.GetAsync("/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, afterLogout.StatusCode);

        await DevLogin(client, "session@test.dev");
        var me = await client.GetFromJsonAsync<TestUser>("/auth/me");
        Assert.Equal("session@test.dev", me!.Email);
    }

    [Fact]
    public async Task Me_WithoutSession_Returns401()
    {
        var res = await factory.CreateClient().GetAsync("/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Profile_UpdatesOwnDisplayName()
    {
        var client = factory.CreateClient();
        await DevLogin(client, "rename@test.dev", "Old Name");

        var res = await client.PostAsync("/auth/profile", Json(new { displayName = "New Name" }));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var updated = await res.Content.ReadFromJsonAsync<TestUser>();
        Assert.Equal("New Name", updated!.DisplayName);

        // persisted
        var me = await client.GetFromJsonAsync<TestUser>("/auth/me");
        Assert.Equal("New Name", me!.DisplayName);
    }

    [Fact]
    public async Task Profile_RequiresSignIn()
    {
        var res = await factory.CreateClient().PostAsync("/auth/profile", Json(new { displayName = "x" }));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Profile_UpdatesThemeIndependently()
    {
        var client = factory.CreateClient();
        await DevLogin(client, "theme@test.dev", "Themer");

        // new accounts default to "system"
        var me0 = await client.GetFromJsonAsync<TestUser>("/auth/me");
        Assert.Equal("system", me0!.Theme);

        // theme-only update leaves the display name untouched
        var res = await client.PostAsync("/auth/profile", Json(new { theme = "dark" }));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var updated = await res.Content.ReadFromJsonAsync<TestUser>();
        Assert.Equal("dark", updated!.Theme);
        Assert.Equal("Themer", updated.DisplayName);

        // persisted, and bad values are rejected
        var me = await client.GetFromJsonAsync<TestUser>("/auth/me");
        Assert.Equal("dark", me!.Theme);
        var bad = await client.PostAsync("/auth/profile", Json(new { theme = "neon" }));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task DevLogin_ConfiguredAdminEmail_GetsAdminRole()
    {
        // goosewal@gmail.com is in Auth:AdminEmails in appsettings.json
        var client = factory.CreateClient();
        await DevLogin(client, "goosewal@gmail.com", "Isaac");

        var me = await client.GetFromJsonAsync<TestUser>("/auth/me");
        Assert.Contains("admin", me!.Roles);
    }

    [Fact]
    public async Task Users_List_RequiresAdmin()
    {
        var anon = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/auth/users")).StatusCode);

        var member = factory.CreateClient();
        await DevLogin(member, "member@test.dev");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync("/auth/users")).StatusCode);
    }

    [Fact]
    public async Task Admin_CanPromoteAnotherUserToAdmin()
    {
        // a plain member to be promoted
        var member = factory.CreateClient();
        await DevLogin(member, "promote-me@test.dev");
        var memberId = (await member.GetFromJsonAsync<TestUser>("/auth/me"))!.Id;

        // an admin (allow-listed email)
        var admin = factory.CreateClient();
        await DevLogin(admin, "goosewal@gmail.com");

        var promote = await admin.PostAsync($"/auth/users/{memberId}/roles", Json(new { role = "admin", assigned = true }));
        Assert.Equal(HttpStatusCode.OK, promote.StatusCode);
        var updated = await promote.Content.ReadFromJsonAsync<TestUser>();
        Assert.Contains("admin", updated!.Roles);
    }

    [Fact]
    public async Task Admin_CannotRemoveOwnAdminRole()
    {
        var admin = factory.CreateClient();
        await DevLogin(admin, "goosewal@gmail.com");
        var selfId = (await admin.GetFromJsonAsync<TestUser>("/auth/me"))!.Id;

        var res = await admin.PostAsync($"/auth/users/{selfId}/roles", Json(new { role = "admin", assigned = false }));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Admin_CanCreateAssignAndDeleteACustomRole()
    {
        var admin = factory.CreateClient();
        await DevLogin(admin, "goosewal@gmail.com");

        // create
        var create = await admin.PostAsync("/auth/roles", Json(new { name = "editor" }));
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);

        // it shows up in the list, not as a system role
        var roles = await admin.GetFromJsonAsync<RoleDto[]>("/auth/roles");
        Assert.Contains(roles!, r => r.Name == "editor" && !r.System);
        Assert.Contains(roles!, r => r.Name == "admin" && r.System);

        // assign it to a member
        var member = factory.CreateClient();
        await DevLogin(member, "editor-target@test.dev");
        var memberId = (await member.GetFromJsonAsync<TestUser>("/auth/me"))!.Id;
        var assign = await admin.PostAsync($"/auth/users/{memberId}/roles", Json(new { role = "editor", assigned = true }));
        var updated = await assign.Content.ReadFromJsonAsync<TestUser>();
        Assert.Contains("editor", updated!.Roles);

        // delete the role
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync("/auth/roles/editor")).StatusCode);
    }

    [Fact]
    public async Task Admin_CannotDeleteSystemAdminRole()
    {
        var admin = factory.CreateClient();
        await DevLogin(admin, "goosewal@gmail.com");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.DeleteAsync("/auth/roles/admin")).StatusCode);
    }

    [Fact]
    public async Task CreateRole_RejectsInvalidNames()
    {
        var admin = factory.CreateClient();
        await DevLogin(admin, "goosewal@gmail.com");
        foreach (var bad in new[] { "A", "1role", "has space", "UPPER", "" })
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/auth/roles", Json(new { name = bad }))).StatusCode);
    }

    [Fact]
    public async Task RoleEndpoints_RequireAdmin()
    {
        var member = factory.CreateClient();
        await DevLogin(member, "not-admin@test.dev");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync("/auth/roles")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsync("/auth/roles", Json(new { name = "x" }))).StatusCode);
    }

    private record ProvidersDto(string[] Providers, bool DevLogin);
    private record RoleDto(string Name, bool System);
}
