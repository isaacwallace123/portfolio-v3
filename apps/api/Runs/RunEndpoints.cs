using IsaacWallace.Api.Auth;

namespace IsaacWallace.Api.Runs;

public static class RunEndpoints
{
    // The front end verifies the visitor's SSO session server-side and forwards an opaque per-user
    // key. The API treats it as the cluster's owner: reads and mutations only ever see clusters that
    // key provisioned. It is never accepted from a browser — only from the scoped, key-authenticated
    // server-side caller.
    private const string OwnerHeader = "X-Owner-Key";

    private static string Owner(HttpContext ctx) =>
        ctx.Request.Headers[OwnerHeader].ToString().Trim();

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
                    s.DurationSeconds,
                    s.Objective,
                    decisions = s.Decisions.Select(d => new
                    {
                        d.Id,
                        d.Label,
                        d.Description,
                        d.AvailableAfterSeconds,
                    }),
                }),
            }))
            .RequireApiKey();

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
        }).RequireScope(ApiScopes.RunsRead);

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
            var run = await broker.GetRunAsync(runId, owner, ct);
            if (run is null) return Results.NotFound(new { error = "No such run." });

            // Gathered concurrently: the slowest of these is the Envoy scrape, and serialising them
            // would put the whole frame behind it.
            var telemetryTask = broker.GetTelemetryAsync(runId, owner, ct);
            var componentsTask = broker.GetComponentsAsync(runId, owner, ct);
            var eventsTask = broker.GetEventsAsync(runId, owner, ct);
            var traceTask = broker.GetTraceAsync(runId, owner, ct);
            await Task.WhenAll(telemetryTask, componentsTask, eventsTask, traceTask);

            return Results.Ok(new
            {
                run,
                telemetry = await telemetryTask,
                components = await componentsTask ?? [],
                events = await eventsTask ?? [],
                trace = await traceTask,
            });
        }).RequireScope(ApiScopes.RunsRead);

        app.MapGet("/v1/runs/{runId}/telemetry", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var telemetry = await broker.GetTelemetryAsync(runId, Owner(ctx), ct);
            return telemetry is null
                ? Results.NotFound(new { error = "No such run." })
                : Results.Ok(telemetry);
        }).RequireScope(ApiScopes.RunsRead);

        app.MapGet("/v1/runs/{runId}/trace", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var trace = await broker.GetTraceAsync(runId, Owner(ctx), ct);
            return trace is null
                ? Results.NotFound(new { error = "No trace is available yet." })
                : Results.Ok(trace);
        }).RequireScope(ApiScopes.RunsRead);

        app.MapGet("/v1/runs/{runId}/report", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var report = await broker.GetReportAsync(runId, Owner(ctx), ct);
            if (report is null) return Results.NotFound(new { error = "No such run." });
            return report.Ready
                ? Results.Ok(report)
                : Results.Json(new { error = "The report is not ready." }, statusCode: 409);
        }).RequireScope(ApiScopes.RunsRead);

        app.MapPost("/v1/runs/{runId}/decisions", async (string runId, DecisionRequest req, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.SubmitDecisionAsync(runId, req.DecisionId ?? "", Owner(ctx), ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite);

        app.MapPost("/v1/practice/{runId}/actions", async (
            string runId, PracticeActionRequest req, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.SubmitPracticeActionAsync(runId, req.ActionId ?? "", Owner(ctx), ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite);

        // Buy one more window before the cluster expires. Allowed once per cluster.
        app.MapPost("/v1/runs/{runId}/renew", async (
            string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.RenewRunAsync(runId, Owner(ctx), ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite);

        // Start a drill ON a running cluster (objective + clock + decisions over the live workload).
        app.MapPost("/v1/runs/{runId}/drill", async (
            string runId, DrillRequest req, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.StartDrillAsync(runId, req.DrillId ?? "", Owner(ctx), ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite);

        // End the active drill; the cluster stays up as an open sandbox.
        app.MapDelete("/v1/runs/{runId}/drill", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.EndDrillAsync(runId, Owner(ctx), ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite);

        // Per-component / per-pod state of the caller's cluster (drives the request-path flowchart).
        app.MapGet("/v1/runs/{runId}/components", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var components = await broker.GetComponentsAsync(runId, Owner(ctx), ct);
            return components is null
                ? Results.NotFound(new { error = "No such run." })
                : Results.Ok(components);
        }).RequireScope(ApiScopes.RunsRead);

        // Real Kubernetes Events from the run namespace.
        app.MapGet("/v1/runs/{runId}/events", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var events = await broker.GetEventsAsync(runId, Owner(ctx), ct);
            return events is null
                ? Results.NotFound(new { error = "No such run." })
                : Results.Ok(events);
        }).RequireScope(ApiScopes.RunsRead);

        app.MapDelete("/v1/runs/{runId}", async (string runId, HttpContext ctx, RunBroker broker, CancellationToken ct) =>
        {
            var deleted = await broker.DeleteRunAsync(runId, Owner(ctx), ct);
            return deleted ? Results.Ok(new { ok = true }) : Results.NotFound(new { error = "No such run." });
        }).RequireScope(ApiScopes.RunsWrite);
    }
}

record CreateRunRequest(string? ScenarioId);
record DecisionRequest(string? DecisionId);
record DrillRequest(string? DrillId);
record PracticeActionRequest(string? ActionId);
