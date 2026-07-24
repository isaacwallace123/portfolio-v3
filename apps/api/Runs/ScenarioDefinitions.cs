namespace IsaacWallace.Api.Runs;

public sealed record ScenarioDecisionDefinition(
    string Id,
    string Label,
    string Description,
    int AvailableAfterSeconds,
    IReadOnlyDictionary<string, object> SpecPatch);

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
    IReadOnlyList<ScenarioDecisionDefinition> Decisions);

// This catalog is the public control plane's allowlist. A caller can choose an id and one of the
// decisions below, but cannot supply an image, command, manifest, namespace, or arbitrary patch.
public static class ScenarioDefinitions
{
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
                    Decision("scale", "Scale API to 6",
                        "Add checkout capacity without waiting for an autoscaling window.", 15,
                        ("apiReplicas", 6)),
                    Decision("cache", "Enable response cache",
                        "Bring up Redis so repeated reads bypass Postgres.", 18,
                        ("cacheReplicas", 1)),
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
                    Decision("rollback", "Rollback to stable",
                        "Replace the candidate ReplicaSet with the last known-good release.", 10,
                        ("releaseTrack", "stable")),
                    Decision("scale", "Scale the bad build",
                        "Add capacity without removing the faulty code path.", 12,
                        ("apiReplicas", 6)),
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
                    Decision("restore", "Restore clean dataset",
                        "Roll the data tier forward from the scenario recovery point.", 8,
                        ("dataState", "recovered")),
                    Decision("cache", "Serve cached catalogue",
                        "Reduce impact while the data tier recovers.", 10,
                        ("cacheReplicas", 1)),
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
                    Decision("scale", "Add a safety replica",
                        "Add capacity before changing placement.", 8,
                        ("apiReplicas", 6)),
                    Decision("evacuate", "Evacuate demo workload",
                        "Reconcile checkout replicas onto the alternate worker pool.", 10,
                        ("targetPool", "infra")),
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
                2, 0, "stable", "healthy", "apps",
                []),
        }.ToDictionary(s => s.Id, StringComparer.Ordinal);

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
}
