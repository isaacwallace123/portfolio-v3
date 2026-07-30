using System.Text.RegularExpressions;
using IsaacWallace.Api.Auth;
using IsaacWallace.Api.Data;

namespace IsaacWallace.Api.Ranked;

public static class RankedEndpoints
{
    private const string OwnerHeader = "X-Owner-Key";
    private static readonly Regex AttemptId =
        new("^[a-f0-9]{32}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static string Owner(HttpContext ctx) =>
        ctx.Request.Headers[OwnerHeader].ToString().Trim();

    public static void MapRankedEndpoints(this WebApplication app)
    {
        app.MapGet("/v1/ranked/profile", async (
            HttpContext ctx,
            RankedStore ranked,
            CancellationToken ct) =>
        {
            var owner = Owner(ctx);
            return owner.Length == 0
                ? Results.Json(new { error = "Sign in to view your rating." }, statusCode: 401)
                : Results.Ok(await ranked.ProfileAsync(owner, ct));
        }).RequireScope(ApiScopes.RunsRead);

        app.MapGet("/v1/ranked/attempts/{attemptId}", async (
            string attemptId,
            HttpContext ctx,
            RankedStore ranked,
            CancellationToken ct) =>
        {
            var owner = Owner(ctx);
            if (owner.Length == 0 || !AttemptId.IsMatch(attemptId))
                return Results.NotFound(new { error = "No such ranked attempt." });
            var attempt = await ranked.GetAttemptAsync(attemptId, owner, ct);
            return attempt is null
                ? Results.NotFound(new { error = "No such ranked attempt." })
                : Results.Ok(attempt);
        }).RequireScope(ApiScopes.RunsRead);

        app.MapGet("/v1/ranked/leaderboard", async (
            HttpContext ctx,
            RankedStore ranked,
            int? limit,
            CancellationToken ct) =>
        {
            var standings = await ranked.LeaderboardAsync(
                Owner(ctx), Math.Clamp(limit ?? 25, 1, 100), ct);
            return Results.Ok(new { standings });
        }).RequireScope(ApiScopes.RunsRead);
    }
}
