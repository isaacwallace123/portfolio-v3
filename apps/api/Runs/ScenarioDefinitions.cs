namespace IsaacWallace.Api.Runs;

public sealed record ScenarioDecisionDefinition(
    string Id,
    string Label,
    string Description,
    int AvailableAfterSeconds,
    IReadOnlyDictionary<string, object> SpecPatch,
    // A drill is a quiz with real consequences: every option is genuinely applied to the running
    // workload, but only some of them actually resolve the incident. Choosing a wrong one is the
    // teaching moment — you watch the measured signals fail to recover, then read why.
    bool IsCorrect = true,
    string Explanation = "");

// What it means to have actually resolved a drill, expressed against signals the platform measures
// rather than against which buttons were pressed. A drill is over when the workload is genuinely in
// the target state — that is the whole claim the exercise makes.
public sealed record DrillGoal(
    string Label,
    // p95 | errors | throughput | release | data | pool
    string Metric,
    // Numeric goals compare against this; state goals ignore it.
    double Threshold,
    // State goals compare the run's spec against this; numeric goals leave it empty.
    string State,
    // Numeric goals only: whether lower is better.
    bool Below = true)
{
    public string TargetText => Metric switch
    {
        "p95" => $"< {Threshold:0} ms",
        "errors" => $"< {Threshold:0.#}%",
        "throughput" => $"> {Threshold:0}/s",
        _ => State,
    };
}

// A goal with the run's current value attached, so the page can show progress rather than a verdict.
public sealed record DrillGoalState(
    string Label,
    string Target,
    string Current,
    bool Met);

public sealed record ScenarioDefinition(
    string Id,
    string Title,
    string Eyebrow,
    string Summary,
    string Difficulty,
    string ResourceClass,
    int DurationSeconds,
    string Objective,
    int InitialApiReplicas,
    int InitialCacheReplicas,
    string InitialReleaseTrack,
    string InitialDataState,
    string InitialTargetPool,
    IReadOnlyList<ScenarioDecisionDefinition> Decisions,
    // Empty for the open sandbox, which has nothing to achieve.
    IReadOnlyList<DrillGoal> Goals);

// This catalog is the public control plane's allowlist. A caller can choose an id and one of the
// decisions below, but cannot supply an image, command, manifest, namespace, or arbitrary patch.
public static class ScenarioDefinitions
{
    // The open sandbox a practice cluster runs as when no drill is active. It is a scenario (it seeds
    // the workload) but never a drill: it has no objective clock and no decisions.
    public const string SandboxId = "practice-cluster";

    // A drill is a scenario that layers an objective, a clock, and decisions over a live cluster.
    public static bool IsDrill(string id) =>
        id != SandboxId && All.TryGetValue(id, out var d) && d.Decisions.Count > 0;

    public static IEnumerable<ScenarioDefinition> Drills =>
        All.Values.Where(d => IsDrill(d.Id));

    public static readonly IReadOnlyDictionary<string, ScenarioDefinition> All =
        new[]
        {
            new ScenarioDefinition(
                "checkout-traffic-spike",
                "Keep checkout alive",
                "SRE drill 01",
                "Scale or cache a real checkout workload while measured traffic burns its SLO.",
                "operator",
                "standard",
                64,
                "Return p95 below 120 ms and errors below 1% before the run ends.",
                3, 0, "stable", "healthy", "apps",
                [
                    Right("scale", "Scale checkout to 6 replicas",
                        "Add capacity now instead of waiting for an autoscaling window.",
                        "Correct. Each replica has its own CPU limit, so doubling replicas roughly doubles "
                        + "throughput and the request queue drains — measured p95 falls.", 12,
                        ("apiReplicas", 6)),
                    Right("cache", "Enable the response cache",
                        "Bring up Redis so repeated catalogue reads skip the work entirely.",
                        "Correct, and the strongest move here. A cache hit skips the per-request CPU work "
                        + "altogether, so throughput jumps and latency collapses.", 12,
                        ("cacheReplicas", 1)),
                    Wrong("shrink", "Scale checkout down to 1 replica",
                        "Consolidate onto a single replica to reduce overhead.",
                        "Wrong. The service is CPU-bound and already saturated; removing replicas removes "
                        + "capacity, so the queue grows and p95 climbs further.", 12,
                        ("apiReplicas", 1)),
                    Wrong("stop-load", "Turn off the load generator",
                        "Stop the incoming traffic so the graphs go quiet.",
                        "Wrong. Silencing the load generator hides the incident instead of resolving it — "
                        + "real users would still be hitting a saturated service.", 12,
                        ("loadReplicas", 0)),
                ],
                [
                    new DrillGoal("Live traffic", "throughput", 20, "", Below: false),
                    new DrillGoal("p95 latency", "p95", 120, ""),
                    new DrillGoal("Error rate", "errors", 1, ""),
                ]),
            new ScenarioDefinition(
                "checkout-bad-release",
                "Ship a bad release",
                "SRE drill 02",
                "Trace a candidate release regression and roll it back before the error budget is gone.",
                "operator",
                "standard",
                64,
                "Identify pricing.apply and restore the stable release.",
                3, 0, "candidate", "healthy", "apps",
                [
                    Right("rollback", "Roll back to the stable release",
                        "Replace the candidate ReplicaSet with the last known-good build.",
                        "Correct. The regression is in the candidate's pricing path, so removing that code "
                        + "is the only thing that actually restores latency and stops the 5xx.", 10,
                        ("releaseTrack", "stable")),
                    Wrong("scale", "Scale the candidate to 6 replicas",
                        "Add capacity so the slow release has more headroom.",
                        "Wrong. This is a code regression, not a capacity problem — every new replica runs "
                        + "the same faulty path, so the error rate stays and you have simply spent more CPU.", 10,
                        ("apiReplicas", 6)),
                    Wrong("cache-over", "Cache over the regression",
                        "Turn on Redis so fewer requests reach the bad code.",
                        "Wrong. Caching masks a fraction of the requests while the broken release stays in "
                        + "production — cache misses still hit it, and the error budget keeps burning.", 10,
                        ("cacheReplicas", 1)),
                ],
                [
                    new DrillGoal("Live traffic", "throughput", 20, "", Below: false),
                    new DrillGoal("Release", "release", 0, "stable"),
                    new DrillGoal("Error rate", "errors", 1, ""),
                    new DrillGoal("p95 latency", "p95", 200, ""),
                ]),
            new ScenarioDefinition(
                "catalogue-data-recovery",
                "Recover the data tier",
                "SRE drill 03",
                "Restore a degraded disposable catalogue and verify the recovery objective.",
                "guided",
                "standard",
                64,
                "Restore healthy reads and keep errors below 1%.",
                3, 0, "stable", "degraded", "apps",
                [
                    Right("restore", "Restore from the recovery point",
                        "Roll the data tier forward from the scenario's clean snapshot.",
                        "Correct. The integrity failures come from the degraded catalogue itself, so "
                        + "restoring the data is the only action that removes the source of the errors.", 8,
                        ("dataState", "recovered")),
                    Right("cache", "Serve the cached catalogue",
                        "Shield readers from the degraded tier while it recovers.",
                        "Reasonable. Caching genuinely reduces blast radius during a recovery, but on its "
                        + "own it only hides the bad data — pair it with the restore.", 8,
                        ("cacheReplicas", 1)),
                    Wrong("scale-out", "Scale checkout to 6 replicas",
                        "Add application capacity to absorb the failures.",
                        "Wrong. The application is healthy; the data underneath it is not. More replicas "
                        + "read the same corrupt catalogue and fail at exactly the same rate.", 8,
                        ("apiReplicas", 6)),
                ],
                [
                    new DrillGoal("Live traffic", "throughput", 20, "", Below: false),
                    new DrillGoal("Catalogue", "data", 0, "recovered"),
                    new DrillGoal("Error rate", "errors", 1, ""),
                ]),
            new ScenarioDefinition(
                "worker-evacuation",
                "Evacuate a worker",
                "SRE drill 04",
                "Move scenario-owned checkout replicas to the alternate worker pool while traffic stays live.",
                "expert",
                "standard",
                64,
                "Move checkout to the infra pool without exhausting the request error budget.",
                3, 0, "stable", "healthy", "apps",
                [
                    Right("scale", "Add capacity before moving",
                        "Scale out first so the service keeps serving during the migration.",
                        "Correct, and the right order. Extra replicas mean the drain can take pods away "
                        + "without dropping below the capacity the traffic needs.", 8,
                        ("apiReplicas", 6)),
                    Right("evacuate", "Evacuate to the infra pool",
                        "Reconcile the checkout replicas onto the alternate worker pool.",
                        "Correct. This is the objective — the workload moves pools while requests keep "
                        + "being served. Doing it after scaling keeps the error budget intact.", 10,
                        ("targetPool", "infra")),
                    Wrong("shrink-first", "Scale down to 1 replica first",
                        "Shrink the workload so there is less to move.",
                        "Wrong. Draining a node with a single replica means a window with no healthy pod "
                        + "at all — this is exactly how a routine migration becomes an outage.", 8,
                        ("apiReplicas", 1)),
                ],
                [
                    new DrillGoal("Live traffic", "throughput", 20, "", Below: false),
                    new DrillGoal("Worker pool", "pool", 0, "infra"),
                    new DrillGoal("Error rate", "errors", 1, ""),
                ]),
            new ScenarioDefinition(
                "practice-cluster",
                "Practice cluster",
                "Open sandbox",
                "A disposable Kubernetes workspace with a checkout API, Postgres, Redis, Envoy, and optional k6 traffic.",
                "open",
                "standard",
                900,
                "Experiment safely, observe real reconciliation, then tear the workspace down.",
                // One replica, no cache, no traffic: the sandbox starts at the smallest thing that
                // serves a request, so every control the page offers has somewhere to go and its
                // effect is visible against a baseline you chose rather than one already half set.
                1, 0, "stable", "healthy", "apps",
                [], []),
        }.ToDictionary(s => s.Id, StringComparer.Ordinal);

    // Judge a drill against what the cluster is actually doing. Every goal must hold at once — the
    // traffic goal is what stops an idle cluster from passing a latency target by serving nothing.
    public static IReadOnlyList<DrillGoalState> Evaluate(
        ScenarioDefinition drill, RunTelemetry t, LabRunSpec spec) =>
        drill.Goals.Select(g =>
        {
            var (current, met) = g.Metric switch
            {
                "p95" => ($"{t.P95LatencyMs} ms", t.P95LatencyMs < g.Threshold),
                "errors" => ($"{t.ErrorRatePct:0.00}%", t.ErrorRatePct < g.Threshold),
                "throughput" => ($"{t.RequestsPerSec}/s", t.RequestsPerSec > g.Threshold),
                "release" => (spec.ReleaseTrack ?? "", spec.ReleaseTrack == g.State),
                "data" => (spec.DataState ?? "", spec.DataState == g.State),
                "pool" => (spec.TargetPool ?? "", spec.TargetPool == g.State),
                _ => ("", false),
            };
            return new DrillGoalState(g.Label, g.TargetText, current, met);
        }).ToArray();

    private static ScenarioDecisionDefinition Decision(
        string id,
        string label,
        string description,
        int availableAfterSeconds,
        params (string Key, object Value)[] patch)
        => new(
            id,
            label,
            description,
            availableAfterSeconds,
            patch.ToDictionary(x => x.Key, x => x.Value, StringComparer.Ordinal));

    // A deliberately wrong option: plausible, really applied, and explained once chosen.
    private static ScenarioDecisionDefinition Wrong(
        string id,
        string label,
        string description,
        string explanation,
        int availableAfterSeconds,
        params (string Key, object Value)[] patch)
        => new(
            id,
            label,
            description,
            availableAfterSeconds,
            patch.ToDictionary(x => x.Key, x => x.Value, StringComparer.Ordinal),
            IsCorrect: false,
            Explanation: explanation);

    private static ScenarioDecisionDefinition Right(
        string id,
        string label,
        string description,
        string explanation,
        int availableAfterSeconds,
        params (string Key, object Value)[] patch)
        => new(
            id,
            label,
            description,
            availableAfterSeconds,
            patch.ToDictionary(x => x.Key, x => x.Value, StringComparer.Ordinal),
            IsCorrect: true,
            Explanation: explanation);
}
