using System.Text.Json.Serialization;

namespace IsaacWallace.Api.Runs;

// Typed view of the Crossplane LabRun composite (platform.homelab.isaacwallace.dev/v1alpha1). The
// resource server only ever sends a scenario id + run id; the Composition (in the homelab repo) owns
// everything the namespace actually gets. Cluster-scoped, so there is no namespace on the LabRun
// itself — status.namespace is the disposable namespace it composed.
public static class LabRun
{
    public const string Group = "platform.homelab.isaacwallace.dev";
    public const string Version = "v1alpha1";
    public const string Plural = "labruns";
    public const string Kind = "LabRun";
    public const string ApiVersion = $"{Group}/{Version}";
}

public sealed class LabRunResource
{
    [JsonPropertyName("apiVersion")] public string ApiVersion { get; set; } = LabRun.ApiVersion;
    [JsonPropertyName("kind")] public string Kind { get; set; } = LabRun.Kind;
    [JsonPropertyName("metadata")] public LabRunMetadata Metadata { get; set; } = new();
    [JsonPropertyName("spec")] public LabRunSpec Spec { get; set; } = new();
    [JsonPropertyName("status")] public LabRunStatus? Status { get; set; }
}

public sealed class LabRunMetadata
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("creationTimestamp")] public DateTime? CreationTimestamp { get; set; }
    [JsonPropertyName("deletionTimestamp")] public DateTime? DeletionTimestamp { get; set; }
}

public sealed class LabRunSpec
{
    [JsonPropertyName("scenarioId")] public string ScenarioId { get; set; } = "";
    [JsonPropertyName("runId")] public string RunId { get; set; } = "";
    [JsonPropertyName("resourceClass")] public string ResourceClass { get; set; } = "standard";
    [JsonPropertyName("ttlSeconds")] public int TtlSeconds { get; set; } = 900;

    // Decision-driven fields. Nullable so create omits them and the XRD defaults (3 / 0) apply.
    [JsonPropertyName("apiReplicas")] public int? ApiReplicas { get; set; }
    [JsonPropertyName("cacheReplicas")] public int? CacheReplicas { get; set; }
}

public sealed class LabRunStatus
{
    [JsonPropertyName("namespace")] public string? Namespace { get; set; }
    [JsonPropertyName("conditions")] public List<LabRunCondition>? Conditions { get; set; }
}

public sealed class LabRunCondition
{
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("reason")] public string? Reason { get; set; }
}

// Real, sanitized run telemetry: measured resource usage of the run's workload (from metrics-server)
// plus the decision-driven state. Aggregate numbers only — no pod names, specs, or labels.
public sealed record RunTelemetry(
    int PodCount,
    int CpuMillicores,
    int MemoryMiB,
    int ApiReplicas,
    bool CacheEnabled);

// The sanitized projection returned to API clients. No raw Kubernetes objects, conditions, or labels
// cross this boundary — only the run's identity, lifecycle phase, and envelope.
public sealed record RunView(
    string RunId,
    string ScenarioId,
    string Status,
    string? Namespace,
    int TtlSeconds,
    DateTime? CreatedAt,
    int ApiReplicas,
    bool CacheEnabled)
{
    // Map the LabRun's Crossplane conditions to a small, public lifecycle vocabulary, and surface the
    // decision-driven state (replica count, cache tier) so a caller can see the effect of a decision.
    public static RunView From(LabRunResource r)
    {
        string status;
        if (r.Metadata.DeletionTimestamp is not null)
            status = "deleting";
        else if (r.Status?.Conditions?.Any(c => c.Type == "Ready" && c.Status == "True") == true)
            status = "ready";
        else
            status = "provisioning";

        return new RunView(
            r.Spec.RunId,
            r.Spec.ScenarioId,
            status,
            r.Status?.Namespace,
            r.Spec.TtlSeconds,
            r.Metadata.CreationTimestamp,
            r.Spec.ApiReplicas ?? 3,
            (r.Spec.CacheReplicas ?? 0) > 0);
    }
}
