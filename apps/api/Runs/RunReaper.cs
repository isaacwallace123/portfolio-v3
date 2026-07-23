namespace IsaacWallace.Api.Runs;

// Enforces the run TTL. Crossplane has no native TTL, and a public visitor can provision a run and
// close the tab without tearing it down — which would hold a capacity slot forever. Every minute
// this deletes LabRuns whose age exceeds their ttlSeconds. Delete is idempotent, so it running on
// every api replica is harmless.
public sealed class RunReaper(IServiceScopeFactory scopes, ILogger<RunReaper> log)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(60);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ReapAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Run reaper pass failed.");
            }

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task ReapAsync(CancellationToken ct)
    {
        // RunBroker is scoped; take a scope per pass.
        using var scope = scopes.CreateScope();
        var broker = scope.ServiceProvider.GetRequiredService<RunBroker>();

        var now = DateTime.UtcNow;
        foreach (var run in await broker.ListAsync(ct))
        {
            if (run.CreatedAt is not DateTime created) continue;
            var ageSeconds = (now - created).TotalSeconds;
            var ttl = run.TtlSeconds > 0 ? run.TtlSeconds : 900;
            if (ageSeconds > ttl)
            {
                log.LogInformation(
                    "Reaping expired run {RunId} (age {Age}s > ttl {Ttl}s).",
                    run.RunId, (int)ageSeconds, ttl);
                await broker.DeleteRunAsync(run.RunId, ct);
            }
        }
    }
}
