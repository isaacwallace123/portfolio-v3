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

        // Start or resume, and then keep advancing it here until it is done.
        //
        // Same lifecycle as the POST above, with the drive loop moved to the side of the wire that
        // can see the cluster. A launch spends minutes waiting on a namespace, and having the
        // browser supply each step meant a fixed client-side timer paid for a round trip, a session
        // introspection, and a rate-limit decision per step — for a state machine whose next move is
        // decided entirely server-side. The connection is not what the launch is made of: its state
        // lives on the LabRun, every step is idempotent, and the orchestrator's per-owner gate
        // serializes two of these against each other. So a dropped connection loses a viewer, not a
        // launch, and reconnecting resumes exactly where it was — which is the same property that
        // made a page reload free before.
        app.MapGet("/v1/ranked/launch/stream", async (
            HttpContext ctx,
            RunBroker broker,
            RankedStore ranked,
            IOptions<RunBrokerOptions> options,
            ILoggerFactory loggers,
            bool? start,
            bool? retry,
            CancellationToken ct) =>
        {
            var owner = Owner(ctx);
            if (owner.Length == 0)
                return Results.Json(
                    new { error = "Sign in to start a ranked match." }, statusCode: 401);

            var orchestrator = Orchestrator(broker, ranked, options, loggers);
            var displayName = OwnerName(ctx);

            // The first advance happens before a single byte of the stream is written, so a refusal
            // is still an ordinary HTTP status. A 404 for "no launch in progress", a 429 for
            // capacity, a 409 for an incident already on the cluster: the caller reads them exactly
            // as it reads them from the POST, instead of having to unpack an error frame out of a
            // 200 response to find out the request was rejected.
            var result = await orchestrator.LaunchAsync(
                owner, displayName, retry == true, start == true, ct);
            if (result.Launch is null) return Project(result);

            ctx.Response.Headers.ContentType = "text/event-stream";
            // no-transform matters as much as no-cache: an intermediary that buffers to compress
            // turns an event stream into a response that arrives all at once, at the end.
            ctx.Response.Headers.CacheControl = "no-cache, no-transform";
            ctx.Response.Headers["X-Accel-Buffering"] = "no";

            var launch = result.Launch;
            RankedLaunchView? sent = null;
            var deadline = TimeProvider.System.GetUtcNow() + RankedLaunchStream.Ceiling;

            try
            {
                while (true)
                {
                    if (RankedLaunchStream.SameState(sent, launch))
                        await ctx.Response.WriteAsync(
                            RankedLaunchStream.TickFrame(launch.LaunchElapsedSeconds), ct);
                    else
                    {
                        await ctx.Response.WriteAsync(
                            RankedLaunchStream.LaunchFrame(launch), ct);
                        sent = launch;
                    }
                    await ctx.Response.Body.FlushAsync(ct);

                    if (launch.Terminal) break;
                    if (TimeProvider.System.GetUtcNow() >= deadline) break;

                    await Task.Delay(RankedLaunchStream.TickFor(launch.Phase), ct);

                    // Resume rather than start: retry and start were consumed by the first advance,
                    // and replaying them would re-arm a reset on a launch that is already running.
                    var next = await orchestrator.LaunchAsync(
                        owner, displayName, retry: false, allowProvision: false, ct);
                    if (next.Launch is null)
                    {
                        // The launch stopped existing under us — cancelled from another tab, or torn
                        // down by the reaper. There is nothing left to report and nothing to advance.
                        break;
                    }
                    launch = next.Launch;
                }

                await ctx.Response.WriteAsync(RankedLaunchStream.EndFrame(), ct);
                await ctx.Response.Body.FlushAsync(ct);
            }
            catch (OperationCanceledException)
            {
                // The viewer went away. The launch keeps whatever state it had written; the next
                // connection picks it up.
            }

            return Results.Empty;
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
