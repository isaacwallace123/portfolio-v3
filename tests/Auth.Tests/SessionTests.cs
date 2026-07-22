using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace IsaacWallace.Auth.Tests;

// Server-side sessions: every sign-in opens a revocable UserSessions row whose id rides in the
// cookie. These tests prove the whole loop — list, revoke another device, revoke yourself,
// revoke-others — with each HttpClient acting as its own "device" (own cookie container).

public record SessionInfo(string Id, DateTime CreatedUtc, DateTime LastSeenUtc, string UserAgent, string Ip, bool Current);

public class SessionTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static StringContent Json(object o) => new(
        System.Text.Json.JsonSerializer.Serialize(o),
        System.Text.Encoding.UTF8,
        "application/json");

    private static Task<HttpResponseMessage> DevLogin(HttpClient c, string email) =>
        c.PostAsync("/auth/dev-login", Json(new { email }));

    [Fact]
    public async Task Sessions_RequireSignIn()
    {
        var res = await factory.CreateClient().GetAsync("/auth/sessions");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Login_OpensASession_MarkedCurrent()
    {
        var device = factory.CreateClient();
        await DevLogin(device, "one-device@test.dev");

        var sessions = await device.GetFromJsonAsync<SessionInfo[]>("/auth/sessions");
        var s = Assert.Single(sessions!);
        Assert.True(s.Current);
    }

    [Fact]
    public async Task RevokingAnotherDevice_KillsItsSession_Immediately()
    {
        var laptop = factory.CreateClient();
        var phone = factory.CreateClient();
        await DevLogin(laptop, "revoke-other@test.dev");
        await DevLogin(phone, "revoke-other@test.dev");

        // the laptop sees both devices
        var sessions = await laptop.GetFromJsonAsync<SessionInfo[]>("/auth/sessions");
        Assert.Equal(2, sessions!.Length);
        var other = Assert.Single(sessions, s => !s.Current);

        // revoke the phone from the laptop
        var res = await laptop.DeleteAsync($"/auth/sessions/{other.Id}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        // the phone's very next request is rejected; the laptop still works
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.GetAsync("/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await laptop.GetAsync("/auth/me")).StatusCode);
    }

    [Fact]
    public async Task RevokingYourOwnSession_IsALogout()
    {
        var device = factory.CreateClient();
        await DevLogin(device, "revoke-self@test.dev");
        var sessions = await device.GetFromJsonAsync<SessionInfo[]>("/auth/sessions");
        var current = Assert.Single(sessions!, s => s.Current);

        var res = await device.DeleteAsync($"/auth/sessions/{current.Id}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await device.GetAsync("/auth/me")).StatusCode);
    }

    [Fact]
    public async Task RevokeOthers_KeepsOnlyTheCurrentDevice()
    {
        var keeper = factory.CreateClient();
        var doomed1 = factory.CreateClient();
        var doomed2 = factory.CreateClient();
        await DevLogin(keeper, "revoke-others@test.dev");
        await DevLogin(doomed1, "revoke-others@test.dev");
        await DevLogin(doomed2, "revoke-others@test.dev");

        var res = await keeper.PostAsync("/auth/sessions/revoke-others", null);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await keeper.GetAsync("/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await doomed1.GetAsync("/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await doomed2.GetAsync("/auth/me")).StatusCode);

        var sessions = await keeper.GetFromJsonAsync<SessionInfo[]>("/auth/sessions");
        Assert.Single(sessions!);
    }

    [Fact]
    public async Task CannotRevokeSomeoneElsesSession()
    {
        var victim = factory.CreateClient();
        await DevLogin(victim, "victim@test.dev");
        var victimSession = (await victim.GetFromJsonAsync<SessionInfo[]>("/auth/sessions"))!.Single();

        var attacker = factory.CreateClient();
        await DevLogin(attacker, "attacker@test.dev");

        // 404, not 403 — session ids of other accounts are not even confirmed to exist
        var res = await attacker.DeleteAsync($"/auth/sessions/{victimSession.Id}");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await victim.GetAsync("/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Logout_RevokesTheSession_NotJustTheCookie()
    {
        var device = factory.CreateClient();
        var watcher = factory.CreateClient();
        await DevLogin(device, "logout-revokes@test.dev");
        await DevLogin(watcher, "logout-revokes@test.dev");

        await device.PostAsync("/auth/logout", null);

        // from the surviving device, the logged-out session is gone from the list
        var sessions = await watcher.GetFromJsonAsync<SessionInfo[]>("/auth/sessions");
        var s = Assert.Single(sessions!);
        Assert.True(s.Current);
    }
}
