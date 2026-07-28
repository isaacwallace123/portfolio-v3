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
    [JsonPropertyName("annotations")] public Dictionary<string, string>? Annotations { get; set; }
}

public sealed class LabRunSpec
{
    [JsonPropertyName("scenarioId")] public string ScenarioId { get; set; } = "";
    [JsonPropertyName("runId")] public string RunId { get; set; } = "";
    // Opaque per-user key (hash of the account id) identifying who provisioned this cluster.
    [JsonPropertyName("owner")] public string Owner { get; set; } = "";
    [JsonPropertyName("resourceClass")] public string ResourceClass { get; set; } = "standard";
    [JsonPropertyName("ttlSeconds")] public int TtlSeconds { get; set; } = 900;

    // Decision-driven fields. Nullable so create omits them and the XRD defaults (3 / 0) apply.
    [JsonPropertyName("apiReplicas")] public int? ApiReplicas { get; set; }
    [JsonPropertyName("cacheReplicas")] public int? CacheReplicas { get; set; }
    [JsonPropertyName("releaseTrack")] public string? ReleaseTrack { get; set; }
    [JsonPropertyName("dataState")] public string? DataState { get; set; }
    [JsonPropertyName("targetPool")] public string? TargetPool { get; set; }
    [JsonPropertyName("loadReplicas")] public int? LoadReplicas { get; set; }
    [JsonPropertyName("restartToken")] public string? RestartToken { get; set; }

    // A drill layers an objective, clock, and decision set over an already-running cluster.
    // Empty drillId means the cluster is an open sandbox.
    [JsonPropertyName("drillId")] public string? DrillId { get; set; }
    [JsonPropertyName("drillStartedAt")] public string? DrillStartedAt { get; set; }
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
    int PostgresCpuPct,
    int ApiReplicas,
    bool CacheEnabled,
    // Real request metrics scraped from the run's Envoy gateway.
    int RequestsPerSec,
    int P95LatencyMs,
    double ErrorRatePct);

// One pod of a cluster component, with its measured resource usage.
public sealed record RunPod(
    string Name,
    string Phase,
    bool Ready,
    int Restarts,
    int CpuMillicores,
    int MemoryMiB);

// One tier of the request path (a Deployment), with per-pod detail for the flowchart.
public sealed record RunComponent(
    string Name,
    int Desired,
    int Ready,
    int CpuMillicores,
    int MemoryMiB,
    int CpuLimitMillicoresPerPod,
    IReadOnlyList<RunPod> Pods);

// One option in the active drill's quiz. Correctness and its explanation are only revealed once the
// option has been chosen, so the answer is not sitting in the page before you decide.
public sealed record DrillOption(
    string Id,
    string Label,
    string Description,
    bool Unlocked,
    // Seconds until this option unlocks, so the UI can explain the wait instead of just greying out.
    int UnlocksInSeconds,
    bool Chosen,
    bool? IsCorrect,
    string Explanation);

// A sanitized Kubernetes Event from the run namespace — real cluster activity (scheduling, image
// pulls, probes, scaling), not a scripted timeline.
public sealed record RunEventView(
    string Id,
    DateTime At,
    string Source,
    string Reason,
    string Message,
    string Severity,
    string ObjectKind);

// The sanitized projection returned to API clients. No raw Kubernetes objects, conditions, or labels
// cross this boundary — only the run's identity, lifecycle phase, and envelope.
public sealed record RunView(
    string RunId,
    string ScenarioId,
    string Owner,
    string Status,
    string? Namespace,
    int TtlSeconds,
    DateTime? CreatedAt,
    int ApiReplicas,
    bool CacheEnabled,
    string ReleaseTrack,
    string DataState,
    string TargetPool,
    bool LoadEnabled,
    string RestartToken,
    IReadOnlyList<AcceptedDecision> AcceptedDecisions,
    IReadOnlyList<string> AvailableDecisions,
    // Active drill layered on this cluster ("" when the cluster is an open sandbox).
    string DrillId,
    string DrillTitle,
    string DrillObjective,
    int DrillElapsedSeconds,
    int DrillDurationSeconds,
    bool DrillComplete,
    // A drill is solved when every correct action has been taken. The counts let the UI show quiz
    // progress ("1 of 2") without revealing WHICH options are the correct ones.
    bool DrillSolved,
    int DrillCorrectChosen,
    int DrillCorrectTotal,
    int DrillWrongChosen,
    IReadOnlyList<DrillOption> DrillOptions)
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

        var createdAt = r.Metadata.CreationTimestamp;

        // The active drill is spec.drillId when a drill was started on a running cluster. Runs created
        // directly against a drill scenario (the original one-run-per-drill flow) still work: their
        // scenarioId is the drill and the clock runs from provisioning.
        var drillId = r.Spec.DrillId ?? "";
        if (!ScenarioDefinitions.IsDrill(drillId)) drillId = "";
        DateTime? drillStart = null;
        if (drillId.Length > 0)
        {
            drillStart = DateTime.TryParse(
                r.Spec.DrillStartedAt,
                null,
                System.Globalization.DateTimeStyles.AdjustToUniversal |
                System.Globalization.DateTimeStyles.AssumeUniversal,
                out var parsed)
                ? parsed
                : createdAt;
        }
        else if (ScenarioDefinitions.IsDrill(r.Spec.ScenarioId))
        {
            drillId = r.Spec.ScenarioId;
            // Discount provisioning so the drill clock starts when the workload is actually serving.
            drillStart = createdAt?.AddSeconds(16);
        }

        var definition = drillId.Length > 0
            ? ScenarioDefinitions.All.GetValueOrDefault(drillId)
            : null;
        var elapsedSeconds = drillStart is null
            ? 0
            : Math.Max(0, (DateTime.UtcNow - drillStart.Value).TotalSeconds);

        var accepted = ReadAcceptedDecisions(r, drillStart ?? createdAt);
        var acceptedIds = accepted.Select(d => d.Id).ToHashSet(StringComparer.Ordinal);
        var available = definition?.Decisions
            .Where(d => elapsedSeconds >= d.AvailableAfterSeconds && !acceptedIds.Contains(d.Id))
            .Select(d => d.Id)
            .ToArray() ?? [];

        var duration = definition?.DurationSeconds ?? 0;
        var drillComplete = definition is not null && elapsedSeconds >= duration;

        var correctTotal = definition?.Decisions.Count(d => d.IsCorrect) ?? 0;
        var correctChosen = definition?.Decisions.Count(d => d.IsCorrect && acceptedIds.Contains(d.Id)) ?? 0;
        var wrongChosen = definition?.Decisions.Count(d => !d.IsCorrect && acceptedIds.Contains(d.Id)) ?? 0;
        var solved = definition is not null && correctTotal > 0 && correctChosen == correctTotal;

        var options = definition?.Decisions.Select(d =>
        {
            var chosen = acceptedIds.Contains(d.Id);
            return new DrillOption(
                d.Id,
                d.Label,
                d.Description,
                elapsedSeconds >= d.AvailableAfterSeconds,
                Math.Max(0, (int)Math.Ceiling(d.AvailableAfterSeconds - elapsedSeconds)),
                chosen,
                // Withheld until the option is chosen, so the quiz cannot be read off the wire.
                chosen ? d.IsCorrect : null,
                chosen ? d.Explanation : "");
        }).ToArray() ?? [];

        return new RunView(
            r.Spec.RunId,
            r.Spec.ScenarioId,
            r.Spec.Owner ?? "",
            status,
            r.Status?.Namespace,
            r.Spec.TtlSeconds,
            createdAt,
            r.Spec.ApiReplicas ?? 3,
            (r.Spec.CacheReplicas ?? 0) > 0,
            r.Spec.ReleaseTrack ?? "stable",
            r.Spec.DataState ?? "healthy",
            r.Spec.TargetPool ?? "apps",
            (r.Spec.LoadReplicas ?? 1) > 0,
            r.Spec.RestartToken ?? "baseline",
            accepted,
            available,
            definition is null ? "" : drillId,
            definition?.Title ?? "",
            definition?.Objective ?? "",
            (int)Math.Round(elapsedSeconds),
            duration,
            // Finishing the objective ends the drill just as the clock running out does.
            drillComplete || solved,
            solved,
            correctChosen,
            correctTotal,
            wrongChosen,
            options);
    }

    private static IReadOnlyList<AcceptedDecision> ReadAcceptedDecisions(
        LabRunResource resource,
        DateTime? createdAt)
    {
        const string prefix = "homeops.isaacwallace.dev/decision-";
        if (resource.Metadata.Annotations is null) return [];

        return resource.Metadata.Annotations
            .Where(pair => pair.Key.StartsWith(prefix, StringComparison.Ordinal))
            .Select(pair =>
            {
                var acceptedAt = DateTime.TryParse(pair.Value, out var parsed)
                    ? parsed.ToUniversalTime()
                    : createdAt ?? DateTime.UtcNow;
                var offset = createdAt is null
                    ? 0
                    : Math.Max(0, (int)(acceptedAt - createdAt.Value).TotalMilliseconds - 16_000);
                var id = pair.Key[prefix.Length..];
                var label = ScenarioDefinitions.All.GetValueOrDefault(resource.Spec.ScenarioId)?
                    .Decisions.FirstOrDefault(d => d.Id == id)?.Label ?? id;
                return new AcceptedDecision(id, label, offset);
            })
            .OrderBy(decision => decision.AcceptedAtMs)
            .ToArray();
    }
}

public sealed record AcceptedDecision(string Id, string Label, int AcceptedAtMs);
