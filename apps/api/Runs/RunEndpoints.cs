using IsaacWallace.Api.Auth;

namespace IsaacWallace.Api.Runs;

public static class RunEndpoints
{
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

        app.MapGet("/v1/runs", async (RunBroker broker, CancellationToken ct) =>
            Results.Ok(await broker.ListAsync(ct)))
            .RequireScope(ApiScopes.RunsRead);

        app.MapGet("/v1/runs/{runId}", async (string runId, RunBroker broker, CancellationToken ct) =>
        {
            var run = await broker.GetRunAsync(runId, ct);
            return run is null ? Results.NotFound(new { error = "No such run." }) : Results.Ok(run);
        }).RequireScope(ApiScopes.RunsRead);

        app.MapPost("/v1/runs", async (CreateRunRequest req, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.CreateRunAsync(req.ScenarioId ?? "", ct);
            return result.Run is not null
                ? Results.Created($"/v1/runs/{result.Run.RunId}", result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite);

        app.MapGet("/v1/runs/{runId}/telemetry", async (string runId, RunBroker broker, CancellationToken ct) =>
        {
            var telemetry = await broker.GetTelemetryAsync(runId, ct);
            return telemetry is null
                ? Results.NotFound(new { error = "No such run." })
                : Results.Ok(telemetry);
        }).RequireScope(ApiScopes.RunsRead);

        app.MapGet("/v1/runs/{runId}/trace", async (string runId, RunBroker broker, CancellationToken ct) =>
        {
            var trace = await broker.GetTraceAsync(runId, ct);
            return trace is null
                ? Results.NotFound(new { error = "No trace is available yet." })
                : Results.Ok(trace);
        }).RequireScope(ApiScopes.RunsRead);

        app.MapGet("/v1/runs/{runId}/report", async (string runId, RunBroker broker, CancellationToken ct) =>
        {
            var report = await broker.GetReportAsync(runId, ct);
            if (report is null) return Results.NotFound(new { error = "No such run." });
            return report.Ready
                ? Results.Ok(report)
                : Results.Json(new { error = "The report is not ready." }, statusCode: 409);
        }).RequireScope(ApiScopes.RunsRead);

        app.MapPost("/v1/runs/{runId}/decisions", async (string runId, DecisionRequest req, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.SubmitDecisionAsync(runId, req.DecisionId ?? "", ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite);

        app.MapPost("/v1/practice/{runId}/actions", async (
            string runId, PracticeActionRequest req, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.SubmitPracticeActionAsync(runId, req.ActionId ?? "", ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite);

        // Start a drill ON a running cluster (objective + clock + decisions over the live workload).
        app.MapPost("/v1/runs/{runId}/drill", async (
            string runId, DrillRequest req, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.StartDrillAsync(runId, req.DrillId ?? "", ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite);

        // End the active drill; the cluster stays up as an open sandbox.
        app.MapDelete("/v1/runs/{runId}/drill", async (string runId, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.EndDrillAsync(runId, ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite);

        // Real Kubernetes Events from the run namespace.
        app.MapGet("/v1/runs/{runId}/events", async (string runId, RunBroker broker, CancellationToken ct) =>
        {
            var events = await broker.GetEventsAsync(runId, ct);
            return events is null
                ? Results.NotFound(new { error = "No such run." })
                : Results.Ok(events);
        }).RequireScope(ApiScopes.RunsRead);

        app.MapDelete("/v1/runs/{runId}", async (string runId, RunBroker broker, CancellationToken ct) =>
        {
            var deleted = await broker.DeleteRunAsync(runId, ct);
            return deleted ? Results.Ok(new { ok = true }) : Results.NotFound(new { error = "No such run." });
        }).RequireScope(ApiScopes.RunsWrite);
    }
}

record CreateRunRequest(string? ScenarioId);
record DecisionRequest(string? DecisionId);
record DrillRequest(string? DrillId);
record PracticeActionRequest(string? ActionId);
