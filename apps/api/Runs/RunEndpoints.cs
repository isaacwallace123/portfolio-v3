using IsaacWallace.Api.Auth;

namespace IsaacWallace.Api.Runs;

public static class RunEndpoints
{
    public static void MapRunEndpoints(this WebApplication app)
    {
        // What a caller may launch. Any valid key can read the catalog.
        app.MapGet("/v1/scenarios", (RunBroker broker) =>
            Results.Ok(new { scenarios = broker.Scenarios }))
            .RequireApiKey();

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

        app.MapPost("/v1/runs/{runId}/decisions", async (string runId, DecisionRequest req, RunBroker broker, CancellationToken ct) =>
        {
            var result = await broker.SubmitDecisionAsync(runId, req.DecisionId ?? "", ct);
            return result.Run is not null
                ? Results.Ok(result.Run)
                : Results.Json(new { error = result.Error }, statusCode: result.Status);
        }).RequireScope(ApiScopes.RunsWrite);

        app.MapDelete("/v1/runs/{runId}", async (string runId, RunBroker broker, CancellationToken ct) =>
        {
            var deleted = await broker.DeleteRunAsync(runId, ct);
            return deleted ? Results.Ok(new { ok = true }) : Results.NotFound(new { error = "No such run." });
        }).RequireScope(ApiScopes.RunsWrite);
    }
}

record CreateRunRequest(string? ScenarioId);
record DecisionRequest(string? DecisionId);
