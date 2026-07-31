using IsaacWallace.Api.Ranked;

namespace IsaacWallace.Api.Runs;

// Bound from the "RunBroker" configuration section. The scenario allowlist is the trust boundary:
// a caller may only name a scenario in this list, and the id maps to a Composition that lives in the
// homelab repo — images, commands, and manifests are never caller-supplied.
public sealed class RunBrokerOptions
{
    public const string SectionName = "RunBroker";

    public List<string> Scenarios { get; set; } = [];

    // Hard cap on concurrent active runs across the whole platform.
    public int MaxConcurrentRuns { get; set; } = 1;

    public int DefaultTtlSeconds { get; set; } = 900;

    // Authoritative provisioning budget. The Next proxy applies the same shape as cheap edge
    // throttling, but this database-backed budget is the cross-replica security boundary.
    public int ProvisionLimit { get; set; } = 5;
    public int ProvisionWindowSeconds { get; set; } = 3600;
    public int ProvisionCooldownSeconds { get; set; } = 30;

    // How long each phase of a ranked launch may take before the launch is abandoned as failed.
    // Cumulative from the moment the launch opened, so a slow provision does not buy itself extra
    // time to start workloads in. Overrunning is never rated; it marks the launch failed. Defaults
    // match RankedLaunchBudget.Default and should stay comfortably inside DefaultTtlSeconds — a
    // launch that used the whole window would hand the operator a match with no cluster left.
    public int LaunchProvisionSeconds { get; set; } = 300;
    public int LaunchWorkloadSeconds { get; set; } = 180;
    public int LaunchTelemetrySeconds { get; set; } = 120;
    public int LaunchActivationSeconds { get; set; } = 60;

    public RankedLaunchBudget LaunchBudget => new(
        TimeSpan.FromSeconds(Math.Max(1, LaunchProvisionSeconds)),
        TimeSpan.FromSeconds(Math.Max(1, LaunchWorkloadSeconds)),
        TimeSpan.FromSeconds(Math.Max(1, LaunchTelemetrySeconds)),
        TimeSpan.FromSeconds(Math.Max(1, LaunchActivationSeconds)));
}
