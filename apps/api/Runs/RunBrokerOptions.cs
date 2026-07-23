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
}
