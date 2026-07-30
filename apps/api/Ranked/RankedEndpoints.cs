using System.Text.RegularExpressions;
using IsaacWallace.Api.Auth;
using IsaacWallace.Api.Data;
using IsaacWallace.Api.Runs;
using Microsoft.Extensions.Options;

namespace IsaacWallace.Api.Ranked;

public static class RankedEndpoints
{
    private const string OwnerHeader = "X-Owner-Key";

    // Display only, and never authorization: it is the name that ends up on the board and on a
    // sealed attempt. Narrowed to one printable line of a length a row can hold, exactly as the run
    // endpoints do.
    private const string OwnerNameHeader = "X-Owner-Name";
    private const int MaxOwnerNameLength = 48;

    private static readonly Regex AttemptId =
        new("^[a-f0-9]{32}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static string Owner(HttpContext ctx) =>
        ctx.Request.Headers[OwnerHeader].ToString().Trim();

    private static string OwnerName(HttpContext ctx)
    {
        var raw = ctx.Request.Headers[OwnerNameHeader].ToString();
        var cleaned = new string(raw.Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (cleaned.Length == 0) return "operator";
        return cleaned.Length <= MaxOwnerNameLength
            ? cleaned
            : cleaned[..MaxOwnerNameLength].TrimEnd();
    }

    public static void MapRankedEndpoints(this WebApplication app)
    {
        // ── the ranked launch lifecycle ──────────────────────────────────────────────────────
        //
        // One operation, addressed by the caller's own identity rather than by a run id: there is
        // exactly one launch per operator, so a second click, a reload, a retry, and a second tab
        // can only ever find the launch that already exists. Nothing here is rated until the
        // environment has been verified playable — see RankedLaunchOrchestrator.

        // Start or resume. Advances the launch by one bounded step and returns the current phase;
        // the caller polls it. Never blocks waiting for a cluster, because a request held open for
        // the minutes a namespace takes is a request that gets retried into a duplicate.
        app.MapPost("/v1/ranked/launch", async (
            RankedLaunchRequest? req,
            HttpContext ctx,
            RunBroker broker,
            RankedStore ranked,
            IOptions<RunBrokerOptions> options,
            ILoggerFactory loggers,
            CancellationToken ct) =>
        {
            var owner = Owner(ctx);
            if (owner.Length == 0)
                return Results.Json(
                    new { error = "Sign in to start a ranked match." }, statusCode: 401);

            var result = await Orchestrator(broker, ranked, options, loggers)
                .LaunchAsync(
                    owner,
                    OwnerName(ctx),
                    req?.Retry == true,
                    req?.Start == true,
                    ct);
            return Project(result);
        }).RequireScope(ApiScopes.RunsWrite);

        // Observe without advancing, for a second tab or a page that only renders progress.
        app.MapGet("/v1/ranked/launch", async (
            HttpContext ctx,
            RunBroker broker,
            RankedStore ranked,
            IOptions<RunBrokerOptions> options,
            ILoggerFactory loggers,
            CancellationToken ct) =>
        {
            var owner = Owner(ctx);
            if (owner.Length == 0)
                return Results.Json(
                    new { error = "Sign in to view your ranked launch." }, statusCode: 401);

            var result = await Orchestrator(broker, ranked, options, loggers)
                .ObserveAsync(owner, ct);
            return Project(result);
        }).RequireScope(ApiScopes.RunsRead);

        // Cancel a launch that has not activated, and tear down what it provisioned. Refused once
        // the match is live: that ends through the existing forfeit path, which rates it.
        app.MapDelete("/v1/ranked/launch", async (
            HttpContext ctx,
            RunBroker broker,
            RankedStore ranked,
            IOptions<RunBrokerOptions> options,
            ILoggerFactory loggers,
            CancellationToken ct) =>
        {
            var owner = Owner(ctx);
            if (owner.Length == 0)
                return Results.Json(
                    new { error = "Sign in to cancel a ranked launch." }, statusCode: 401);

            var result = await Orchestrator(broker, ranked, options, loggers)
                .AbandonAsync(owner, OwnerName(ctx), ct);
            return Project(result);
        }).RequireScope(ApiScopes.RunsWrite);

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

        app.MapGet("/v1/ranked/attempts/{attemptId}/actions", async (
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
                : Results.Ok(new
                {
                    attemptId,
                    actions = await ranked.ActionsForAttemptAsync(attemptId, owner, ct),
                });
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

    // The orchestrator is per-request state over services that are already registered, so it is
    // built here rather than injected. Its one piece of cross-request state — the per-owner lock
    // that stops two simultaneous clicks becoming two clusters — is deliberately process-wide
    // inside the orchestrator itself.
    private static RankedLaunchOrchestrator Orchestrator(
        RunBroker broker,
        RankedStore ranked,
        IOptions<RunBrokerOptions> options,
        ILoggerFactory loggers) =>
        new(
            new RankedLaunchEnvironment(
                broker, ranked, loggers.CreateLogger<RankedLaunchEnvironment>()),
            options.Value.LaunchBudget,
            TimeProvider.System,
            loggers.CreateLogger<RankedLaunchOrchestrator>());

    private static IResult Project(RankedLaunchResult result) =>
        result.Launch is not null
            ? Results.Json(new { launch = result.Launch }, statusCode: result.Status)
            : Results.Json(new { error = result.Error }, statusCode: result.Status);
}

/// <summary>The only input a launch takes. Bounded by construction: the caller names no run, no
/// incident, and no cluster — everything else about the launch is decided server-side.</summary>
public sealed record RankedLaunchRequest(bool? Retry, bool? Start);
