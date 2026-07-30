using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using IsaacWallace.Api.Ranked;

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

    // Decision-driven fields. Nullable so create omits them and the XRD defaults apply.
    [JsonPropertyName("apiReplicas")] public int? ApiReplicas { get; set; }
    // Replicas running the CANDIDATE build beside the stable ones. They share the gateway's backend
    // pool, so the new build's share of traffic is its share of the replicas.
    [JsonPropertyName("canaryReplicas")] public int? CanaryReplicas { get; set; }
    [JsonPropertyName("cacheReplicas")] public int? CacheReplicas { get; set; }
    [JsonPropertyName("releaseTrack")] public string? ReleaseTrack { get; set; }
    [JsonPropertyName("dataState")] public string? DataState { get; set; }
    [JsonPropertyName("dbMaxConns")] public int? DbMaxConns { get; set; }
    [JsonPropertyName("networkMode")] public string? NetworkMode { get; set; }
    [JsonPropertyName("targetPool")] public string? TargetPool { get; set; }
    [JsonPropertyName("loadReplicas")] public int? LoadReplicas { get; set; }
    // The Envoy gateway is a scalable tier: past roughly 2000 rps it, rather than the checkout tier
    // behind it, is where requests queue.
    [JsonPropertyName("gatewayReplicas")] public int? GatewayReplicas { get; set; }
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
    // Real request metrics scraped from the run's Envoy gateways. p95 carries a decimal place
    // because a cached request is genuinely sub-millisecond and whole milliseconds cannot tell
    // "0.4ms" from "we did not get a sample".
    int RequestsPerSec,
    double P95LatencyMs,
    double ErrorRatePct);

// The public shape can withhold selected live gauges for a generated ranked match. Null means the
// platform measured the value and used it for judging, but this match's instrument panel does not
// reveal it. Resource/state signals stay numeric because current generator cuts always expose state.
public sealed record PublicRunTelemetry(
    int PodCount,
    int CpuMillicores,
    int MemoryMiB,
    int PostgresCpuPct,
    int ApiReplicas,
    bool CacheEnabled,
    int? RequestsPerSec,
    double? P95LatencyMs,
    double? ErrorRatePct)
{
    public static PublicRunTelemetry From(
        RunTelemetry telemetry,
        RankedTelemetryVisibility? visibility = null) =>
        new(
            telemetry.PodCount,
            telemetry.CpuMillicores,
            telemetry.MemoryMiB,
            telemetry.PostgresCpuPct,
            telemetry.ApiReplicas,
            telemetry.CacheEnabled,
            visibility?.Throughput == false ? null : telemetry.RequestsPerSec,
            visibility?.Latency == false ? null : telemetry.P95LatencyMs,
            visibility?.Errors == false ? null : telemetry.ErrorRatePct);
}

// One pod of a cluster component, with its measured resource usage.
public sealed record RunPod(
    string Name,
    string Phase,
    bool Ready,
    int Restarts,
    int CpuMillicores,
    int MemoryMiB,
    // What the pod is actually doing right now ("ContainerCreating", "PodInitializing",
    // "ImagePullBackOff", "Starting"), or empty once it is serving. Pod.Status.Phase alone says
    // "Pending" for both "waiting for a node" and "pulling the image", which is exactly the
    // difference a person watching a scale-up wants to see.
    string Detail,
    // The worker pool this replica actually landed on ("apps" | "infra"), or empty while it is
    // still being scheduled. Placement as measured, not as requested — during an evacuation a
    // half-moved fleet really does show pods on both.
    string Pool);

// One tier of the request path (a Deployment), with per-pod detail for the flowchart.
public sealed record RunComponent(
    string Name,
    int Desired,
    int Ready,
    int CpuMillicores,
    int MemoryMiB,
    int CpuLimitMillicoresPerPod,
    IReadOnlyList<RunPod> Pods);

// One option in the active stage's quiz. Correctness and its explanation are only revealed once the
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
    // False once the single permitted extension has been used, so the page can stop offering it.
    bool Renewable,
    DateTime? CreatedAt,
    int ApiReplicas,
    /// <summary>Replicas serving the candidate build alongside the stable fleet. Zero is no canary.</summary>
    int CanaryReplicas,
    bool CacheEnabled,
    string ReleaseTrack,
    string DataState,
    string TargetPool,
    bool LoadEnabled,
    int LoadGenerators,
    int GatewayReplicas,
    // What the generators are asking the stack for, so the page can show demand next to what is
    // actually being served. Offered load is fixed per generator by the open-loop k6 script.
    int OfferedRequestsPerSec,
    string RestartToken,
    IReadOnlyList<AcceptedDecision> AcceptedDecisions,
    IReadOnlyList<string> AvailableDecisions,
    IReadOnlyList<RankedAction> RankedActions,
    // Active drill layered on this cluster ("" when the cluster is an open sandbox).
    string DrillId,
    string DrillTitle,
    string DrillObjective,
    // practice (single incident) | ranked (a cascade, and the only kind that is timed for the board)
    string DrillMode,
    // Where in the cascade this run is. Single-stage drills are stage 1 of 1.
    int DrillStage,
    int DrillStageCount,
    string DrillStageTitle,
    string DrillStageObjective,
    // The handover note for the CURRENT stage: what the last fix caused. Empty on the first stage.
    string DrillStageHandoff,
    // Whole-drill elapsed, in milliseconds, and frozen at the moment the drill was solved. A solved
    // drill's clock must stop, or the number on screen is the age of the result rather than the
    // result — and for a ranked time it has to be the result.
    long DrillElapsedMs,
    // Seconds since the CURRENT stage began. Decision unlocks are gated on this, not on the whole
    // drill, so every stage gets its own baseline before its options open.
    int DrillStageElapsedSeconds,
    // A reference time for the drill, not a deadline. Drills do not expire.
    int DrillParSeconds,
    bool DrillComplete,
    // A drill is solved when the WORKLOAD reaches the target state of its LAST stage, not when a set
    // of buttons has been pressed — see DrillGoals. The broker records the moment that first
    // happens, so a later dip in a measured signal cannot un-solve it. The counts let the UI show
    // quiz progress ("1 of 2") without revealing WHICH options are the correct ones.
    bool DrillSolved,
    // A ranked attempt that hit a wrong move. The cluster keeps the damage so it can be inspected,
    // but nothing further is judged and no time is recorded.
    bool DrillFailed,
    string DrillFailedMove,
    int DrillCorrectChosen,
    int DrillCorrectTotal,
    // The same counts across every stage of the drill so far, for the summary at the end.
    int DrillCorrectChosenAll,
    int DrillCorrectTotalAll,
    // Missteps accumulate across the whole cascade: a wrong move in stage one was still really
    // applied to this cluster, and stage three is running on what it left behind.
    int DrillWrongChosen,
    IReadOnlyList<DrillOption> DrillOptions,
    // Live progress against the current stage's objective. Empty unless telemetry was available.
    IReadOnlyList<DrillGoalState> DrillGoals,
    // How long the objective has held so far, and how long it must, so the page can explain the
    // wait instead of looking stuck once every condition is green.
    int DrillHeldSeconds,
    int DrillHoldSeconds,
    RankedMatchBriefing? RankedBriefing,
    RankedMatchDebrief? RankedDebrief)
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
        var annotations = r.Metadata.Annotations;

        // The active drill is spec.drillId when a drill was started on a running cluster. Runs created
        // directly against a drill scenario (the original one-run-per-drill flow) still work: their
        // scenarioId is the drill and the clock runs from provisioning.
        var drillId = r.Spec.DrillId ?? "";
        if (!ScenarioDefinitions.IsDrill(drillId)) drillId = "";
        DateTime? drillStart = null;
        if (drillId.Length > 0)
        {
            drillStart = ParseTime(r.Spec.DrillStartedAt) ?? createdAt;
        }
        else if (ScenarioDefinitions.IsDrill(r.Spec.ScenarioId))
        {
            drillId = r.Spec.ScenarioId;
            // Discount provisioning so the drill clock starts when the workload is actually serving.
            drillStart = createdAt?.AddSeconds(16);
        }

        var definition = drillId.Length > 0
            ? ScenarioDefinitions.Find(drillId)
            : null;
        var drillMode = annotations?.GetValueOrDefault(RunBroker.DrillModeAnnotation)
            ?? definition?.Mode
            ?? "";
        var isRanked = string.Equals(drillMode, "ranked", StringComparison.Ordinal);

        // Which stage of the cascade is live. Clamped rather than trusted: an annotation left behind
        // by a longer drill must not index past a shorter one's stage list.
        var stageIndex = 0;
        if (definition is not null && definition.Stages.Count > 0)
        {
            var raw = annotations?.GetValueOrDefault(RunBroker.DrillStageAnnotation);
            if (int.TryParse(raw, out var parsedStage))
                stageIndex = Math.Clamp(parsedStage, 0, definition.Stages.Count - 1);
        }
        var stage = definition is { Stages.Count: > 0 } ? definition.Stages[stageIndex] : null;

        // Solved is a recorded fact, not a recomputation: the broker writes this annotation the first
        // time the LAST stage's objective is actually met.
        var solvedAt = drillId.Length > 0
            ? ParseTime(annotations?.GetValueOrDefault(RunBroker.DrillSolvedAnnotation))
            : null;
        var solved = solvedAt is not null;

        var voidedAt = drillId.Length > 0
            ? ParseTime(annotations?.GetValueOrDefault(RunBroker.DrillVoidedAnnotation))
            : null;
        var failedAt = drillId.Length > 0
            ? ParseTime(annotations?.GetValueOrDefault(RunBroker.DrillFailedAnnotation))
                ?? voidedAt
            : null;
        var failed = failedAt is not null;
        var failedMove = voidedAt is not null
            ? RunBroker.InfrastructureVoidMove
            : failed
            ? annotations?.GetValueOrDefault(RunBroker.DrillFailedMoveAnnotation) ?? ""
            : "";

        // The whole-drill clock STOPS at the solve. Everything after that instant is time spent
        // reading the result, and counting it would make a recorded time depend on how long the tab
        // stayed open.
        var elapsedMs = drillStart is null
            ? 0
            : (long)Math.Max(0, ((solvedAt ?? failedAt ?? DateTime.UtcNow) - drillStart.Value).TotalMilliseconds);

        // Options unlock on the CURRENT stage's clock, so stage three does not open with everything
        // already available just because the drill has been running a while.
        var stageStart = ParseTime(annotations?.GetValueOrDefault(RunBroker.DrillStageStartedAnnotation))
            ?? drillStart;
        var stageElapsed = stageStart is null
            ? 0
            : Math.Max(0, ((solvedAt ?? failedAt ?? DateTime.UtcNow) - stageStart.Value).TotalSeconds);

        IReadOnlyList<AcceptedDecision> accepted = isRanked
            ? []
            : ReadAcceptedDecisions(r, definition, stageStart ?? drillStart ?? createdAt);
        var rankedActions = ReadRankedActions(r, drillStart ?? createdAt);
        // Decisions are recorded per stage, so the same id can appear in more than one stage of a
        // cascade without one stage's answer pre-filling another's.
        var chosenHere = accepted
            .Where(d => d.Stage == stageIndex)
            .Select(d => d.Id)
            .ToHashSet(StringComparer.Ordinal);

        var available = !isRanked ? stage?.Decisions
            .Where(d => stageElapsed >= d.AvailableAfterSeconds && !chosenHere.Contains(d.Id))
            .Select(d => d.Id)
            .ToArray() ?? [] : [];

        var correctTotal = isRanked ? 0 : stage?.Decisions.Count(d => d.IsCorrect) ?? 0;
        var correctChosen = isRanked ? 0 : stage?.Decisions.Count(d => d.IsCorrect && chosenHere.Contains(d.Id)) ?? 0;

        // Across the whole cascade: what the summary at the end is about.
        var correctTotalAll = 0;
        var correctChosenAll = 0;
        var wrongChosen = 0;
        if (definition is not null && !isRanked)
        {
            for (var i = 0; i <= stageIndex && i < definition.Stages.Count; i++)
            {
                var stageChosen = accepted
                    .Where(d => d.Stage == i)
                    .Select(d => d.Id)
                    .ToHashSet(StringComparer.Ordinal);
                foreach (var d in definition.Stages[i].Decisions)
                {
                    if (d.IsCorrect) correctTotalAll++;
                    if (!stageChosen.Contains(d.Id)) continue;
                    if (d.IsCorrect) correctChosenAll++;
                    else wrongChosen++;
                }
            }
        }

        // How long every condition has held continuously, per the broker's running record.
        var heldSeconds = 0;
        var heldFrom = ParseTime(annotations?.GetValueOrDefault(RunBroker.DrillGoalsMetSinceAnnotation));
        if (heldFrom is not null)
            heldSeconds = Math.Max(0, (int)(DateTime.UtcNow - heldFrom.Value).TotalSeconds);

        var options = !isRanked ? stage?.Decisions.Select(d =>
        {
            var chosen = chosenHere.Contains(d.Id);
            return new DrillOption(
                d.Id,
                d.Label,
                d.Description,
                stageElapsed >= d.AvailableAfterSeconds,
                Math.Max(0, (int)Math.Ceiling(d.AvailableAfterSeconds - stageElapsed)),
                chosen,
                // Withheld until the option is chosen, so the quiz cannot be read off the wire.
                chosen ? d.IsCorrect : null,
                chosen ? d.Explanation : "");
        })
        // Presented in an order that is stable for this run and different between runs. Fixed order
        // rewarded remembering that the answer was third; re-randomising every poll would move a
        // button out from under the cursor. Seeded on the run, the drill, and the stage, so it is the
        // same list on every replica and every reload of the same attempt.
        .OrderBy(o => ShuffleKey(r.Spec.RunId, drillId, stageIndex, o.Id))
        .ToArray() ?? [] : [];

        var generatedPlan = RankedScenarioCatalog.TryPlan(drillId);

        var loadGenerators = r.Spec.LoadReplicas ?? 1;
        var ttl = r.Spec.TtlSeconds;

        return new RunView(
            r.Spec.RunId,
            r.Spec.ScenarioId,
            r.Spec.Owner ?? "",
            status,
            r.Status?.Namespace,
            ttl,
            annotations?.ContainsKey(RunBroker.RenewedAnnotation) != true,
            createdAt,
            r.Spec.ApiReplicas ?? 3,
            r.Spec.CanaryReplicas ?? 0,
            (r.Spec.CacheReplicas ?? 0) > 0,
            r.Spec.ReleaseTrack ?? "stable",
            r.Spec.DataState ?? "healthy",
            r.Spec.TargetPool ?? "apps",
            loadGenerators > 0,
            loadGenerators,
            r.Spec.GatewayReplicas ?? 1,
            LoadModel.Offered(loadGenerators),
            r.Spec.RestartToken ?? "baseline",
            accepted,
            available,
            rankedActions,
            definition is null ? "" : drillId,
            definition?.Title ?? "",
            definition?.Objective ?? "",
            definition is null ? "" : drillMode,
            stage is null ? 0 : stageIndex + 1,
            definition?.Stages.Count ?? 0,
            stage?.Title ?? "",
            stage?.Objective ?? "",
            stage?.Handoff ?? "",
            elapsedMs,
            (int)Math.Round(stageElapsed),
            definition?.ParSeconds ?? 0,
            // A drill ends when it is SOLVED. There is no deadline: the stage clock only staggers
            // when options unlock (so there is a baseline to judge against), and running past par is
            // a slower result, not a failed one.
            solved,
            solved,
            failed,
            failedMove,
            correctChosen,
            correctTotal,
            correctChosenAll,
            correctTotalAll,
            wrongChosen,
            options,
            [],
            heldSeconds,
            stage?.HoldSeconds ?? (int)RunBroker.GoalHold.TotalSeconds,
            generatedPlan is null ? null : RankedMatchBriefing.From(generatedPlan),
            generatedPlan is not null && (solved || failed)
                ? RankedMatchDebrief.From(generatedPlan)
                : null);
    }

    /// <summary>Stable, process-independent ordering key. String.GetHashCode is seeded per process,
    /// so with two api replicas it would deal the options differently depending on which one served
    /// the poll — the list would visibly reshuffle under the cursor twice a second.</summary>
    private static string ShuffleKey(string runId, string drillId, int stage, string optionId)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{runId}:{drillId}:{stage}:{optionId}"));
        return Convert.ToHexStringLower(bytes.AsSpan(0, 8));
    }

    private static DateTime? ParseTime(string? value) =>
        !string.IsNullOrEmpty(value) &&
        DateTime.TryParse(
            value, null,
            System.Globalization.DateTimeStyles.AdjustToUniversal |
            System.Globalization.DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;

    private static IReadOnlyList<AcceptedDecision> ReadAcceptedDecisions(
        LabRunResource resource,
        ScenarioDefinition? definition,
        DateTime? since)
    {
        if (resource.Metadata.Annotations is null) return [];

        return resource.Metadata.Annotations
            .Where(pair => pair.Key.StartsWith(RunBroker.DecisionAnnotationPrefix, StringComparison.Ordinal))
            .Select(pair =>
            {
                var acceptedAt = DateTime.TryParse(pair.Value, out var parsed)
                    ? parsed.ToUniversalTime()
                    : since ?? DateTime.UtcNow;
                var offset = since is null
                    ? 0
                    : Math.Max(0, (int)(acceptedAt - since.Value).TotalMilliseconds);

                // "decision-2-rollback" → stage 2, id "rollback". Keys written before drills had
                // stages carry no index; they belong to the only stage such a drill had.
                var suffix = pair.Key[RunBroker.DecisionAnnotationPrefix.Length..];
                var stage = 0;
                var dash = suffix.IndexOf('-');
                if (dash > 0 && int.TryParse(suffix[..dash], out var parsedStage))
                {
                    stage = parsedStage;
                    suffix = suffix[(dash + 1)..];
                }

                var label = definition is not null && stage < definition.Stages.Count
                    ? definition.Stages[stage].Decisions.FirstOrDefault(d => d.Id == suffix)?.Label ?? suffix
                    : suffix;
                return new AcceptedDecision(suffix, label, offset, stage);
            })
            .OrderBy(decision => decision.AcceptedAtMs)
            .ToArray();
    }

    private static IReadOnlyList<RankedAction> ReadRankedActions(
        LabRunResource resource,
        DateTime? since)
    {
        if (resource.Metadata.Annotations is null) return [];

        return resource.Metadata.Annotations
            .Where(pair => pair.Key.StartsWith(
                RunBroker.RankedActionAnnotationPrefix,
                StringComparison.Ordinal))
            .Select(pair =>
            {
                var parts = pair.Value.Split('|', 4);
                var acceptedAt = parts.Length > 0 && DateTime.TryParse(
                    parts[0],
                    null,
                    System.Globalization.DateTimeStyles.AdjustToUniversal |
                    System.Globalization.DateTimeStyles.AssumeUniversal,
                    out var parsed)
                    ? parsed
                    : since ?? DateTime.UtcNow;
                var offset = since is null
                    ? 0
                    : Math.Max(0, (int)(acceptedAt - since.Value).TotalMilliseconds);
                var stage = parts.Length > 3 && int.TryParse(parts[3], out var parsedStage)
                    ? Math.Max(1, parsedStage)
                    : 1;
                return new RankedAction(
                    pair.Key[RunBroker.RankedActionAnnotationPrefix.Length..],
                    parts.Length > 1 ? parts[1] : "operator command",
                    parts.Length > 2 ? parts[2] : "",
                    offset,
                    stage,
                    acceptedAt);
            })
            .OrderBy(action => action.AcceptedAtMs)
            .ToArray();
    }
}

public sealed record AcceptedDecision(string Id, string Label, int AcceptedAtMs, int Stage);
public sealed record RankedAction(
    string Id,
    string Command,
    string ActionId,
    int AcceptedAtMs,
    int Stage,
    DateTime AcceptedUtc);
