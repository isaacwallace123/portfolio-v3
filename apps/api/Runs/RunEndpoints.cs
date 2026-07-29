using System.Text.RegularExpressions;
using IsaacWallace.Api.Auth;
using IsaacWallace.Api.Data;

namespace IsaacWallace.Api.Runs;

public static class RunEndpoints
{
    // Run ids are broker-issued and always have this shape. Every {runId} route is checked against
    // it before the handler runs, so a crafted path segment never reaches the Kubernetes client —
    // where it would otherwise be interpolated into a resource name, a namespace, and the
    // write-through names derived from it. The ownership check behind it is the real boundary; this
    // is the cheap one that keeps malformed input from getting that far in the first place.
    private static readonly Regex RunIdPattern =
        new(@"^run-hl-[a-z0-9]{6,32}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    // Answers 404 rather than 400: a malformed id and an id belonging to someone else should be
    // indistinguishable, or the difference is itself a probe.
    private sealed class RunIdFilter : IEndpointFilter
    {
        public async ValueTask<object?> InvokeAsync(
            EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
        {
            var runId = ctx.HttpContext.Request.RouteValues["runId"]?.ToString() ?? "";
            return RunIdPattern.IsMatch(runId)
                ? await next(ctx)
                : Results.NotFound(new { error = "No such run." });
        }
    }

    private static RouteHandlerBuilder ValidatesRunId(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter<RunIdFilter>();

    // The front end verifies the visitor's SSO session server-side and forwards an opaque per-user
    // key. The API treats it as the cluster's owner: reads and mutations only ever see clusters that
    // key provisioned. It is never accepted from a browser — only from the scoped, key-authenticated
    // server-side caller.
    private const string OwnerHeader = "X-Owner-Key";

    // The name to put on the board, resolved from the same server-side session as the owner key. It
    // is display only: nothing is ever authorised by it.
    private const string OwnerNameHeader = "X-Owner-Name";

    private static string Owner(HttpContext ctx) =>
        ctx.Request.Headers[OwnerHeader].ToString().Trim();

    // Display only, but it is persisted and shown to everyone on the leaderboard, so it is narrowed
    // to printable characters on one line and a length a board row can actually hold. React escapes
    // it on the way out; this is about a row that reads as a name rather than as an accident.
    private const int MaxOwnerNameLength = 48;

    private static string OwnerName(HttpContext ctx)
    {
        var raw = ctx.Request.Headers[OwnerNameHeader].ToString();
        var cleaned = new string(raw.Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (cleaned.Length == 0) return "operator";
        return cleaned.Length <= MaxOwnerNameLength
            ? cleaned
            : cleaned[..MaxOwnerNameLength].TrimEnd();
    }

    public static void MapRunEndpoints(this WebApplication app)
    {
        // What a caller may launch. Any valid key can read the catalog.
        app.MapGet("/v1/scenarios", (RunBroker broker) =>
            Results.Ok(new
            {
                scenarios = broker.Scenarios.Select(s => new
                {
                    s.Id,
                    s.Title,
                    s.Eyebrow,
                    s.Summary,
                    s.Difficulty,
                    s.ResourceClass,
                    s.Objective,
                    // Named for the wire contract integrators already consume; it is a par time
                    // rather than a deadline now, since drills no longer expire.
                    DurationSeconds = s.ParSeconds,
                    decisions = s.Stages.SelectMany(stage => stage.Decisions).Select(d => new
                    {
                        d.Id,
                        d.Label,
                        d.Description,
                        d.AvailableAfterSeconds,
                    }),
                }),
            }))
            .RequireApiKey();

        // The drill catalog, with what the field has actually done on each one.
        //
        // Averages come from every recorded attempt by everybody, which is the only way an average
        // solve time means anything — and the caller's own numbers ride alongside so a drill page can
        // say "you: 1:48, everyone: 2:31" without a second round trip.
        app.MapGet("/v1/drills", async (
            HttpContext ctx, DrillResultStore results, CancellationToken ct) =>
        {
            var stats = (await results.StatsAsync(Owner(ctx), ct))
                .ToDictionary(s => s.DrillId, StringComparer.Ordinal);

            return Results.Ok(new
            {
                offeredPerGenerator = LoadModel.RequestsPerSecondPerGenerator,
                drills = ScenarioDefinitions.Drills.Select(d =>
                {
                    stats.TryGetValue(d.Id, out var s);
                    return new
                    {
                        d.Id,
                        d.Title,
                        d.Eyebrow,
                        d.Summary,
                        d.Difficulty,
                        d.Objective,
                        d.Mode,
                        d.ParSeconds,
                        StageCount = d.Stages.Count,
                        Stages = d.Stages.Select(stage => new { stage.Id, stage.Title }),
                        Attempts = s?.Attempts ?? 0,
                        Operators = s?.Operators ?? 0,
                        AverageMs = s?.AverageMs ?? 0,
                        BestMs = s?.BestMs ?? 0,
                        YourAttempts = s?.YourAttempts ?? 0,
                        YourBestMs = s?.YourBestMs,
                        YourAverageMs = s?.YourAverageMs,
                    };
                }),
            });
        }).RequireScope(ApiScopes.RunsRead);

        // Best homelab operator. Ranked drills only — see DrillResultStore for why breadth outranks
        // a single fast cascade.
        app.MapGet("/v1/leaderboard", async (
            HttpContext ctx, DrillResultStore results, int? limit, CancellationToken ct) =>
        {
            var titles = ScenarioDefinitions.RankedDrills
                .ToDictionary(d => d.Id, d => d.Title, StringComparer.Ordinal);
            var board = await results.LeaderboardAsync(
                Owner(ctx), titles, Math.Clamp(limit ?? 20, 1, 100), ct);
            return Results.Ok(board);
        }).RequireScope(ApiScopes.RunsRead);

        app.MapGet("/v1/platform", async (RunBroker broker, CancellationToken ct) =>
            Results.Ok(await broker.GetPlatformStatusAsync(ct)))
            .RequireScope(ApiScopes.RunsRead);

        app.MapGet("/v1/overview", async (RunBroker broker, CancellationToken ct) =>
            Results.Ok(await broker.GetOverviewAsync(ct)))
            .RequireScope(ApiScopes.RunsRead);

        app.MapGet("/v1/topology", async (RunBroker broker, CancellationToken ct) =>
            Results.Ok(await broker.GetTopologyAsync(ct)))
            .RequireScope(ApiScopes.RunsRead);

        // Listing is owner-scoped: with an owner key you see only your own clusters. Without one you
        // get capacity counts, never other people's clusters.
        app.MapGet("/v1/runs", async (HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var owner = Owner(ctx);
            var all = await broker.ListAsync(ct);
            return Results.Ok(
                string.IsNullOrEmpty(owner)
                    ? []
                    : all.Where(r => r.Owner == owner).ToArray());
        }).RequireScope(ApiScopes.RunsRead);

        app.MapGet("/v1/runs/{runId}", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var run = await broker.GetRunAsync(runId, Owner(ctx), ct);
            return run is null ? Results.NotFound(new { error = "No such run." }) : Results.Ok(run);
        }).RequireScope(ApiScopes.RunsRead).ValidatesRunId();

        app.MapPost("/v1/runs", async (CreateRunRequest req, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.CreateRunAsync(req.ScenarioId ?? "", Owner(ctx), ct);
            return result.Run is not null
                ? Results.Created($"/v1/runs/{result.Run.RunId}", result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite);

        // Everything the live page needs for one frame, in one call.
        //
        // The page used to assemble a frame from five separate reads (run, telemetry, components,
        // events, trace). At a 1.2s poll that is ~250 requests a minute against a per-key fixed
        // window, so the window would empty part-way through every minute and the page would spend
        // the rest of it failing — the periodic "reconnecting" flap. One call per frame is ~50 a
        // minute, and it also means the numbers on screen all describe the same instant instead of
        // five instants smeared across five round trips.
        app.MapGet("/v1/runs/{runId}/snapshot", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var owner = Owner(ctx);
            var resource = await broker.GetOwnedAsync(runId, owner, ct);
            if (resource is null) return Results.NotFound(new { error = "No such run." });

            // One pass over the namespace. Composing this from the four public read methods meant
            // each of them re-fetched the LabRun to find the namespace and separately listed pods
            // and metrics — five GETs of a run already in hand, twice the listings, every 1.2s.
            var frame = await broker.GetFrameAsync(resource, ct);
            var telemetry = frame.Telemetry;

            // Judging the drill needs the run and its telemetry together, which is exactly what a
            // snapshot has. Doing it here also means completion is recorded from the same numbers
            // the page is about to render — and that a stage advance or a solve is reflected in
            // THIS frame, since the evaluation hands back the run it just updated.
            var judged = telemetry is null
                ? new DrillEvaluation([], resource)
                : await broker.EvaluateDrillAsync(resource, telemetry, OwnerName(ctx), ct);

            return Results.Ok(new
            {
                run = RunView.From(judged.Resource) with { DrillGoals = judged.Goals },
                telemetry,
                components = frame.Components,
                events = frame.Events,
                trace = frame.Trace,
            });
        }).RequireScope(ApiScopes.RunsRead).ValidatesRunId();

        app.MapGet("/v1/runs/{runId}/telemetry", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var telemetry = await broker.GetTelemetryAsync(runId, Owner(ctx), ct);
            return telemetry is null
                ? Results.NotFound(new { error = "No such run." })
                : Results.Ok(telemetry);
        }).RequireScope(ApiScopes.RunsRead).ValidatesRunId();

        app.MapGet("/v1/runs/{runId}/trace", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var trace = await broker.GetTraceAsync(runId, Owner(ctx), ct);
            return trace is null
                ? Results.NotFound(new { error = "No trace is available yet." })
                : Results.Ok(trace);
        }).RequireScope(ApiScopes.RunsRead).ValidatesRunId();

        app.MapGet("/v1/runs/{runId}/report", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var report = await broker.GetReportAsync(runId, Owner(ctx), ct);
            if (report is null) return Results.NotFound(new { error = "No such run." });
            return report.Ready
                ? Results.Ok(report)
                : Results.Json(new { error = "The report is not ready." }, statusCode: 409);
        }).RequireScope(ApiScopes.RunsRead).ValidatesRunId();

        app.MapPost("/v1/runs/{runId}/decisions", async (string runId, DecisionRequest req, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.SubmitDecisionAsync(runId, req.DecisionId ?? "", Owner(ctx), ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite).ValidatesRunId();

        app.MapPost("/v1/practice/{runId}/actions", async (
            string runId, PracticeActionRequest req, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.SubmitPracticeActionAsync(runId, req.ActionId ?? "", Owner(ctx), ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite).ValidatesRunId();

        // Buy one more window before the cluster expires. Allowed once per cluster.
        app.MapPost("/v1/runs/{runId}/renew", async (
            string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.RenewRunAsync(runId, Owner(ctx), ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite).ValidatesRunId();

        // Start a drill ON a running cluster (objective + clock + decisions over the live workload).
        // With mode "ranked" and no drill id the broker draws one from the multi-stage pool.
        app.MapPost("/v1/runs/{runId}/drill", async (
            string runId, DrillRequest req, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.StartDrillAsync(
                runId, req.DrillId ?? "", req.Mode ?? "practice", Owner(ctx), ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite).ValidatesRunId();

        // End the active drill; the cluster stays up as an open sandbox.
        app.MapDelete("/v1/runs/{runId}/drill", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.EndDrillAsync(runId, Owner(ctx), ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite).ValidatesRunId();

        // Per-component / per-pod state of the caller's cluster (drives the request-path flowchart).
        app.MapGet("/v1/runs/{runId}/components", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var components = await broker.GetComponentsAsync(runId, Owner(ctx), ct);
            return components is null
                ? Results.NotFound(new { error = "No such run." })
                : Results.Ok(components);
        }).RequireScope(ApiScopes.RunsRead).ValidatesRunId();

        // Real Kubernetes Events from the run namespace.
        app.MapGet("/v1/runs/{runId}/events", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var events = await broker.GetEventsAsync(runId, Owner(ctx), ct);
            return events is null
                ? Results.NotFound(new { error = "No such run." })
                : Results.Ok(events);
        }).RequireScope(ApiScopes.RunsRead).ValidatesRunId();

        app.MapDelete("/v1/runs/{runId}", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var deleted = await broker.DeleteRunAsync(runId, Owner(ctx), ct);
            return deleted ? Results.Ok(new { ok = true }) : Results.NotFound(new { error = "No such run." });
        }).RequireScope(ApiScopes.RunsWrite).ValidatesRunId();
    }
}

record CreateRunRequest(string? ScenarioId);
record DecisionRequest(string? DecisionId);
record DrillRequest(string? DrillId, string? Mode);
record PracticeActionRequest(string? ActionId);
