using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json.Serialization;
using IsaacWallace.Api.Data;
using IsaacWallace.Api.Learning;
using IsaacWallace.Api.Ranked;
using k8s;
using k8s.Autorest;
using Microsoft.Extensions.Options;

namespace IsaacWallace.Api.Runs;

// Translates the public run contract into Crossplane LabRun objects. This is the only component that
// holds cluster access, and it can do exactly one thing — CRUD LabRuns (scoped ServiceAccount +
// homeops-broker ClusterRole). Everything a run becomes is decided by the Composition in the homelab
// repo; the broker never supplies images, commands, or manifests, only an allowlisted scenario id.
public sealed class RunBroker
{
    private readonly IKubernetes _k8s;
    private readonly RunBrokerOptions _options;
    private readonly EnvoyScraper _envoy;
    private readonly TraceScraper _traces;
    private readonly PlatformInventory _inventory;
    private readonly DrillResultStore _results;
    private readonly RankedStore _ranked;
    private readonly LearningProgressStore _learning;
    private readonly ILogger<RunBroker> _log;

    public RunBroker(
        IKubernetes k8s,
        IOptions<RunBrokerOptions> options,
        EnvoyScraper envoy,
        TraceScraper traces,
        PlatformInventory inventory,
        DrillResultStore results,
        RankedStore ranked,
        LearningProgressStore learning,
        ILogger<RunBroker> log)
    {
        _k8s = k8s;
        _options = options.Value;
        _envoy = envoy;
        _traces = traces;
        _inventory = inventory;
        _results = results;
        _ranked = ranked;
        _learning = learning;
        _log = log;
    }

    public IReadOnlyList<ScenarioDefinition> Scenarios =>
        _options.Scenarios
            .Select(id => ScenarioDefinitions.All.GetValueOrDefault(id))
            .OfType<ScenarioDefinition>()
            .ToArray();

    public async Task<BrokerResult> CreateRunAsync(
        string scenarioId, string owner, CancellationToken ct)
    {
        var provision = await ProvisionAsync(scenarioId, owner, ct);
        return provision.Resource is null
            ? BrokerResult.Fail(provision.Status, provision.Error ?? "The cluster could not be provisioned.")
            : new BrokerResult(RunView.From(provision.Resource), provision.Status, null);
    }

    /// <summary>
    /// Create or reuse the caller's cluster, handing back the resource rather than its projection.
    ///
    /// The ranked launch needs the LabRun itself — its annotations carry the launch's own state and
    /// its resourceVersion is what every subsequent write is checked against — so provisioning is
    /// factored to return the object and <see cref="CreateRunAsync"/> projects it, rather than the
    /// launch re-fetching a run it has just created.
    /// </summary>
    public async Task<ClusterProvision> ProvisionAsync(
        string scenarioId, string owner, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(scenarioId))
            return ClusterProvision.Fail(400, "scenarioId is required.");
        // Provisioning is never anonymous: the caller must present a resolved owner key.
        if (!IsValidOwner(owner))
            return ClusterProvision.Fail(401, "Sign in to provision a cluster.");
        if (!_options.Scenarios.Contains(scenarioId) ||
            !ScenarioDefinitions.All.TryGetValue(scenarioId, out var scenario))
            return ClusterProvision.Fail(404, $"Unknown scenario '{scenarioId}'.");

        var all = await ListResourcesAsync(ct);
        var live = all
            .Where(r => RunView.From(r).Status is "provisioning" or "ready")
            .ToArray();

        // One cluster per person. Returning the existing cluster (rather than an error) makes the
        // page idempotent: a reload or a second tab lands back on the cluster you already own.
        var mine = live.FirstOrDefault(r => r.Spec.Owner == owner);
        if (mine is not null)
            return new ClusterProvision(mine, 200, null);

        if (live.Length >= _options.MaxConcurrentRuns)
            return ClusterProvision.Fail(429, "No cluster slots are free. Try again shortly.");

        var runId = $"run-hl-{Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(5))}";
        var setup = scenario.Setup;
        var body = new LabRunResource
        {
            Metadata = new LabRunMetadata { Name = runId },
            Spec = new LabRunSpec
            {
                ScenarioId = scenarioId,
                RunId = runId,
                Owner = owner,
                ResourceClass = "standard",
                TtlSeconds = _options.DefaultTtlSeconds,
                ApiReplicas = SetupInt(setup, "apiReplicas", 1),
                CanaryReplicas = SetupInt(setup, "canaryReplicas", 0),
                CacheReplicas = SetupInt(setup, "cacheReplicas", 0),
                ReleaseTrack = SetupString(setup, "releaseTrack", "stable"),
                DataState = SetupString(setup, "dataState", "healthy"),
                DbMaxConns = SetupInt(setup, "dbMaxConns", 8),
                NetworkMode = SetupString(setup, "networkMode", "normal"),
                TargetPool = SetupString(setup, "targetPool", "apps"),
                LoadReplicas = SetupInt(setup, "loadReplicas", 0),
                GatewayReplicas = SetupInt(setup, "gatewayReplicas", 1),
                RestartToken = "baseline",
            },
        };

        try
        {
            var created = await _k8s.CustomObjects.CreateClusterCustomObjectAsync(
                body, LabRun.Group, LabRun.Version, LabRun.Plural, cancellationToken: ct);
            return new ClusterProvision(Parse(created), 201, null);
        }
        catch (HttpOperationException ex)
        {
            _log.LogError(ex, "Failed to create LabRun {RunId}.", runId);
            return ClusterProvision.Fail(502, "The run controller rejected the request.");
        }
    }

    /// <summary>The caller's own live cluster, or null. The launch is owner-addressed rather than
    /// run-addressed: there is exactly one per operator, so a caller never names a run id and can
    /// never name somebody else's.</summary>
    public async Task<LabRunResource?> FindLiveOwnedResourceAsync(
        string owner, CancellationToken ct)
    {
        if (!IsValidOwner(owner)) return null;
        var all = await ListResourcesAsync(ct);
        return all.FirstOrDefault(r =>
            string.Equals(r.Spec.Owner, owner, StringComparison.Ordinal) &&
            RunView.From(r).Status is "provisioning" or "ready");
    }

    // Owner keys are opaque hex digests issued by the front end after verifying the SSO session.
    private static bool IsValidOwner(string? owner) =>
        !string.IsNullOrEmpty(owner) &&
        owner.Length is >= 16 and <= 64 &&
        owner.All(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));

    // Fetch a cluster only if the caller owns it. Mismatches return null so the API answers 404 for
    // "not yours" exactly as it does for "does not exist" — a caller cannot probe for other people's
    // clusters. Clusters created before ownership existed have an empty owner and are unclaimable.
    /// <summary>The caller's own LabRun, or null. Public so a caller that needs both the resource and
    /// its telemetry (the snapshot) can fetch the resource once.</summary>
    public Task<LabRunResource?> GetOwnedAsync(string runId, string owner, CancellationToken ct) =>
        GetOwnedResourceAsync(runId, owner, ct);

    private async Task<LabRunResource?> GetOwnedResourceAsync(
        string runId, string owner, CancellationToken ct)
    {
        var resource = await GetResourceAsync(runId, ct);
        if (resource is null) return null;
        if (!IsValidOwner(owner)) return null;
        return string.Equals(resource.Spec.Owner, owner, StringComparison.Ordinal)
            ? resource
            : null;
    }

    public async Task<BrokerResult> SubmitDecisionAsync(
        string runId,
        string decisionId,
        string owner,
        string displayName,
        CancellationToken ct)
    {
        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        if (resource is null)
            return BrokerResult.Fail(404, "No such run.");

        // Decisions belong to the stage currently running on this cluster, and unlock on that
        // stage's own clock — RunView is the single source of truth for both.
        var view = RunView.From(resource);
        if (view.DrillId.Length == 0)
            return BrokerResult.Fail(409, "No drill is running on this cluster.");
        if (view.DrillSolved)
            return BrokerResult.Fail(409, "This drill is already resolved.");
        if (view.DrillFailed)
            return BrokerResult.Fail(409, "This ranked attempt is over.");
        if (view.DrillMode == "ranked")
            return BrokerResult.Fail(
                409,
                "Ranked incidents accept only audited operator commands.");
        var scenario = ScenarioDefinitions.Find(view.DrillId);
        if (scenario is null)
            return BrokerResult.Fail(404, "The scenario definition is not available.");

        var stageIndex = Math.Max(0, view.DrillStage - 1);
        if (stageIndex >= scenario.Stages.Count)
            return BrokerResult.Fail(409, "This drill has no stage in progress.");
        var stage = scenario.Stages[stageIndex];

        var decision = stage.Decisions.FirstOrDefault(d => d.Id == decisionId);
        if (decision is null)
            return BrokerResult.Fail(404, $"Decision '{decisionId}' is not available at this stage.");

        // Scoped to the stage, so a cascade that offers "roll back" twice records two separate
        // answers instead of the second stage opening with the first one already filled in.
        var annotationKey = $"{DecisionAnnotationPrefix}{stageIndex}-{decisionId}";
        if (resource.Metadata.Annotations?.ContainsKey(annotationKey) == true)
            return BrokerResult.Accepted(view);

        if (view.DrillStageElapsedSeconds < decision.AvailableAfterSeconds)
            return BrokerResult.Fail(
                409,
                $"Decision '{decisionId}' unlocks after {decision.AvailableAfterSeconds} seconds of live traffic.");

        // A ranked attempt is one shot. The move is still APPLIED — the cluster really takes the
        // damage, and being able to watch what a wrong call does to a live workload is the entire
        // teaching value — but the attempt stops counting from here. Practice drills are unaffected:
        // that is where you are meant to be wrong.
        var decisionAt = DateTime.UtcNow;
        var annotations = new Dictionary<string, string>
        {
            [annotationKey] = decisionAt.ToString("O"),
        };
        var ranked = resource.Metadata.Annotations?.GetValueOrDefault(DrillModeAnnotation) == "ranked";
        if (ranked && !decision.IsCorrect)
        {
            annotations[DrillFailedAnnotation] = decisionAt.ToString("O");
            annotations[DrillFailedMoveAnnotation] = decision.Id;
        }

        var patchBody = new
        {
            metadata = new { annotations },
            spec = decision.SpecPatch,
        };
        var patch = new k8s.Models.V1Patch(patchBody, k8s.Models.V1Patch.PatchType.MergePatch);
        try
        {
            var updated = await _k8s.CustomObjects.PatchClusterCustomObjectAsync(
                patch, LabRun.Group, LabRun.Version, LabRun.Plural, runId, cancellationToken: ct);
            var updatedResource = Parse(updated);
            await WriteThroughSpecAsync(runId, decision.SpecPatch, ct);
            if (ranked && !decision.IsCorrect)
                await TryFinalizeRankedAsync(
                    updatedResource,
                    RunView.From(updatedResource),
                    RankedOutcomes.Failed,
                    displayName,
                    ct);
            return BrokerResult.Accepted(RunView.From(updatedResource));
        }
        catch (HttpOperationException ex)
        {
            _log.LogError(ex, "Failed to apply decision {Decision} to {RunId}.", decisionId, runId);
            return BrokerResult.Fail(502, "The run controller rejected the decision.");
        }
    }

    // Start a drill ON an already-running cluster: set the objective/clock and reset the workload to
    // the drill's starting conditions. The namespace and its workload are untouched, so the drill
    // begins against live traffic instead of waiting out another provisioning cycle.
    //
    // Practice only. Ranked used to be a mode flag here, which meant one request drew an incident,
    // opened a rated attempt, and stamped the match clock — against a cluster that might still be
    // provisioning. Ranked now goes through the launch lifecycle, which verifies the environment is
    // playable before any of that happens; see RankedLaunchOrchestrator.
    public async Task<BrokerResult> StartDrillAsync(
        string runId,
        string drillId,
        string mode,
        string learningUnitId,
        string owner,
        CancellationToken ct)
    {
        if (string.Equals(mode, "ranked", StringComparison.OrdinalIgnoreCase))
            return BrokerResult.Fail(
                409,
                "Ranked matches start through POST /v1/ranked/launch, which verifies the arena "
                + "before the clock starts.");

        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        if (resource is null)
            return BrokerResult.Fail(404, "No such run.");
        var current = RunView.From(resource);
        if (current.DrillId.Length > 0)
            return BrokerResult.Fail(409, "End the current incident before starting another.");

        if (RankedScenarioSeed.IsToken(drillId))
            return BrokerResult.Fail(404, $"Unknown drill '{drillId}'.");

        var drill = ScenarioDefinitions.Find(drillId);
        if (!ScenarioDefinitions.IsDrill(drillId) || drill is null)
            return BrokerResult.Fail(404, $"Unknown drill '{drillId}'.");

        CourseManifest? learningCourse = null;
        if (!string.IsNullOrWhiteSpace(learningUnitId))
        {
            learningCourse = CourseManifests.All.Values.FirstOrDefault(
                course => course.Contains(learningUnitId));
            var unitDrillId = learningUnitId.StartsWith("assessment:", StringComparison.Ordinal)
                ? learningUnitId["assessment:".Length..]
                : learningUnitId.StartsWith("drill:", StringComparison.Ordinal)
                    ? learningUnitId.Split(':').Last()
                    : "";
            if (learningCourse is null || !string.Equals(unitDrillId, drillId, StringComparison.Ordinal))
                return BrokerResult.Fail(409, "That Academy unit does not match this drill.");
        }

        // Clear the previous drill's state so its decisions unlock again and, crucially, so its
        // completion does not carry over — a recorded solve is a fact about one drill, not the run.
        var startedAt = DateTime.UtcNow;
        var now = startedAt.ToString("O");
        var annotations = new Dictionary<string, string?>
        {
            ["homeops.isaacwallace.dev/drill-started"] = now,
            [DrillStageAnnotation] = "0",
            [DrillStageStartedAnnotation] = now,
            [DrillModeAnnotation] = "practice",
            [DrillSolvedAnnotation] = null, // null removes the annotation in a merge patch
            [DrillFailedAnnotation] = null,
            [DrillFailedMoveAnnotation] = null,
            [DrillVoidedAnnotation] = null,
            [InfrastructureUnhealthySinceAnnotation] = null,
            [InfrastructureUnhealthyReasonAnnotation] = null,
            [DrillGoalsMetSinceAnnotation] = null,
            [DrillRecordedAnnotation] = null,
            [RankedAttemptIdAnnotation] = null,
            [LearningCourseAnnotation] = learningCourse?.CourseId,
            [LearningCourseVersionAnnotation] = learningCourse?.CourseVersion.ToString(CultureInfo.InvariantCulture),
            [LearningUnitAnnotation] = learningCourse is null ? null : learningUnitId,
        };
        foreach (var key in resource.Metadata.Annotations?.Keys ?? Enumerable.Empty<string>())
            if (key.StartsWith(DecisionAnnotationPrefix, StringComparison.Ordinal) ||
                key.StartsWith(RankedActionAnnotationPrefix, StringComparison.Ordinal) ||
                key.StartsWith(DelayedStageAppliedAnnotationPrefix, StringComparison.Ordinal))
                annotations[key] = null; // null removes the annotation in a merge patch

        // The first stage's Setup is the opening fault. A drill always needs live traffic to measure
        // against, so a stage that forgets to ask for load still gets some.
        var setup = new Dictionary<string, object>(drill.Stages[0].Setup, StringComparer.Ordinal);
        if (!setup.ContainsKey("loadReplicas")) setup["loadReplicas"] = 1;
        FreshenRestartToken(setup);
        var spec = new Dictionary<string, object>(setup, StringComparer.Ordinal)
        {
            ["drillId"] = drillId,
            ["drillStartedAt"] = now,
        };

        var started = await PatchRunAsync(
            runId, new { metadata = new { annotations }, spec }, $"start drill {drillId}", ct);
        await WriteThroughSpecAsync(runId, setup, ct);
        return started;
    }

    /// <summary>
    /// The activation boundary of a ranked launch, as one write.
    ///
    /// The opening fault, the drill id, the match clock, and the attempt id all land together under
    /// the resourceVersion the caller verified. Null means the version moved — another replica
    /// activated the same launch — and the caller re-reads rather than writing over it.
    /// </summary>
    public async Task<LabRunResource?> ActivateRankedIncidentAsync(
        RankedLaunchActivation activation, CancellationToken ct)
    {
        var resource = await GetOwnedResourceAsync(activation.RunId, activation.Owner, ct);
        if (resource is null) return null;

        var drill = ScenarioDefinitions.Find(activation.DrillId);
        if (drill is null || drill.Stages.Count == 0 || !drill.IsRanked) return null;

        var startedAt = activation.ActivatedUtc.ToString("O");
        var annotations = new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["homeops.isaacwallace.dev/drill-started"] = startedAt,
            [DrillStageAnnotation] = "0",
            [DrillStageStartedAnnotation] = startedAt,
            [DrillModeAnnotation] = "ranked",
            [DrillSolvedAnnotation] = null,
            [DrillFailedAnnotation] = null,
            [DrillFailedMoveAnnotation] = null,
            [DrillVoidedAnnotation] = null,
            [InfrastructureUnhealthySinceAnnotation] = null,
            [InfrastructureUnhealthyReasonAnnotation] = null,
            [DrillGoalsMetSinceAnnotation] = null,
            [DrillRecordedAnnotation] = null,
            [RankedAttemptIdAnnotation] = activation.AttemptId,
            [LastRankedDrillAnnotation] = activation.DrillId,
            [RankedLaunchOrchestrator.LaunchAttemptAnnotation] = activation.AttemptId,
            [RankedLaunchOrchestrator.LaunchPhaseAnnotation] = RankedLaunchPhases.Active,
            [RankedLaunchOrchestrator.LaunchFailureAnnotation] = null,
            [RankedLaunchOrchestrator.LaunchFailurePhaseAnnotation] = null,
            // Academy progress is never attached to ranked play.
            [LearningCourseAnnotation] = null,
            [LearningCourseVersionAnnotation] = null,
            [LearningUnitAnnotation] = null,
        };
        foreach (var key in resource.Metadata.Annotations?.Keys ?? Enumerable.Empty<string>())
            if (key.StartsWith(DecisionAnnotationPrefix, StringComparison.Ordinal) ||
                key.StartsWith(RankedActionAnnotationPrefix, StringComparison.Ordinal) ||
                key.StartsWith(DelayedStageAppliedAnnotationPrefix, StringComparison.Ordinal))
                annotations[key] = null;

        var setup = new Dictionary<string, object>(drill.Stages[0].Setup, StringComparer.Ordinal);
        if (!setup.ContainsKey("loadReplicas")) setup["loadReplicas"] = 1;
        FreshenRestartToken(setup);
        var spec = new Dictionary<string, object>(setup, StringComparer.Ordinal)
        {
            ["drillId"] = activation.DrillId,
            ["drillStartedAt"] = startedAt,
            // The reaper counts from cluster creation. Give the activated match a full normal
            // window instead of charging it for the platform's provisioning time.
            ["ttlSeconds"] = RankedLaunchTtl.AtActivation(
                resource.Metadata.CreationTimestamp,
                activation.ActivatedUtc,
                resource.Spec.TtlSeconds,
                _options.DefaultTtlSeconds),
        };

        var activated = await CompareAndSetAsync(
            activation.RunId,
            activation.ExpectedVersion,
            new { metadata = new { annotations }, spec },
            "activate ranked incident",
            ct);
        if (activated is null) return null;

        await WriteThroughSpecAsync(activation.RunId, setup, ct);
        return activated;
    }

    /// <summary>
    /// Start the arena's load generator ahead of a ranked launch.
    ///
    /// A cluster is provisioned as the open sandbox, which starts with no traffic at all — and every
    /// generated objective is measured against served load, so a match started against a silent
    /// gateway would have nothing to judge. This is the only write a launch makes to the workload
    /// before activation, and it is on the safe side of the boundary: it changes what the cluster is
    /// doing, never what the operator is being timed on.
    /// </summary>
    public async Task<LabRunResource?> StartRankedTrafficAsync(
        string runId, string owner, string expectedVersion, CancellationToken ct)
    {
        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        if (resource is null) return null;
        if (resource.Spec.LoadReplicas is > 0) return resource;

        var setup = Patch(("loadReplicas", 1));
        var started = await CompareAndSetAsync(
            runId, expectedVersion, new { spec = setup }, "start ranked arena traffic", ct);
        if (started is null) return null;

        await WriteThroughSpecAsync(runId, setup, ct);
        return started;
    }

    /// <summary>Draw a generated incident for this operator, without touching a cluster. Separate
    /// from activation so a launch records what it drew before it opens anything rated.</summary>
    public async Task<RankedDraw?> DrawRankedIncidentAsync(string owner, CancellationToken ct)
    {
        var context = await _ranked.DrawContextAsync(owner, ct);
        return RankedMatchmaker.Draw(
            context.Rating,
            context.RecentFamilies,
            context.PlayedSeedIds,
            calibrationAdjustments: context.FamilyAdjustments);
    }

    /// <summary>Write launch bookkeeping onto the cluster under the version the caller read. Null
    /// means the write did not land and the caller must re-read.</summary>
    public Task<LabRunResource?> PatchLaunchStateAsync(
        string runId,
        string owner,
        string expectedVersion,
        IReadOnlyDictionary<string, string?> annotations,
        CancellationToken ct) =>
        PatchOwnedLaunchStateAsync(runId, owner, expectedVersion, annotations, ct);

    private async Task<LabRunResource?> PatchOwnedLaunchStateAsync(
        string runId,
        string owner,
        string expectedVersion,
        IReadOnlyDictionary<string, string?> annotations,
        CancellationToken ct)
    {
        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        if (resource is null) return null;
        return await CompareAndSetAsync(
            runId,
            expectedVersion,
            new { metadata = new { annotations } },
            "record ranked launch state",
            ct);
    }

    /// <summary>
    /// A merge patch that carries the resourceVersion it expects.
    ///
    /// The API server rejects the patch with 409 when the stored version has moved, which is the
    /// only primitive available here that makes "check then write" atomic across replicas. A losing
    /// writer gets null and re-reads; it never retries blindly, because the thing it lost the race
    /// to may have been the activation.
    /// </summary>
    private async Task<LabRunResource?> CompareAndSetAsync(
        string runId,
        string expectedVersion,
        object patchBody,
        string what,
        CancellationToken ct)
    {
        var guarded = expectedVersion.Length == 0
            ? patchBody
            : Merge(patchBody, expectedVersion);
        var patch = new k8s.Models.V1Patch(guarded, k8s.Models.V1Patch.PatchType.MergePatch);
        try
        {
            var updated = await _k8s.CustomObjects.PatchClusterCustomObjectAsync(
                patch, LabRun.Group, LabRun.Version, LabRun.Plural, runId, cancellationToken: ct);
            return Parse(updated);
        }
        catch (HttpOperationException ex)
            when (ex.Response.StatusCode == System.Net.HttpStatusCode.Conflict)
        {
            _log.LogDebug("Lost the race to {What} on {RunId}.", what, runId);
            return null;
        }
        catch (HttpOperationException ex)
        {
            _log.LogError(ex, "Failed to {What} on {RunId}.", what, runId);
            return null;
        }
    }

    /// <summary>Fold the expected version into a patch body without every caller having to build
    /// the metadata block twice. Round-tripped through the Kubernetes client's own serializer, so
    /// the merged document is byte-for-byte the one the client would otherwise have produced.
    /// </summary>
    private static object Merge(object patchBody, string expectedVersion)
    {
        var json = System.Text.Json.Nodes.JsonNode
            .Parse(KubernetesJson.Serialize(patchBody))?.AsObject() ?? [];
        if (json["metadata"] is not System.Text.Json.Nodes.JsonObject metadata)
        {
            metadata = [];
            json["metadata"] = metadata;
        }
        metadata["resourceVersion"] = expectedVersion;
        return json;
    }

    /// <summary>What a ranked launch is allowed to gate on: the required workloads and whether the
    /// platform can actually measure them yet. One frame, the same single pass over the namespace
    /// the live page already takes.</summary>
    public async Task<RankedLaunchReadiness> ReadLaunchReadinessAsync(
        LabRunResource resource, CancellationToken ct)
    {
        var frame = await GetFrameAsync(resource, ct);
        var view = RunView.From(resource);
        return new RankedLaunchReadiness(
            frame.Components
                .Select(component => new RankedLaunchWorkload(
                    component.Name, component.Desired, component.Ready))
                .ToArray(),
            frame.Telemetry?.PodCount ?? 0,
            frame.GatewayReporting,
            frame.Telemetry?.RequestsPerSec ?? 0,
            view.OfferedRequestsPerSec);
    }

    // End the active drill and return the cluster to open-sandbox baseline.
    public async Task<BrokerResult> EndDrillAsync(
        string runId,
        string owner,
        string displayName,
        CancellationToken ct)
    {
        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        if (resource is null)
            return BrokerResult.Fail(404, "No such run.");
        var view = RunView.From(resource);
        if (view.DrillMode == "ranked")
        {
            try
            {
                await PersistRankedActionsAsync(resource, view, ct);
                await FinalizeRankedAsync(
                    resource,
                    view,
                    TerminalOutcome(view, RankedOutcomes.Forfeited),
                    displayName,
                    ct);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Could not forfeit ranked attempt on {RunId}.", runId);
                return BrokerResult.Fail(
                    503, "The ranked result could not be sealed. Try again.");
            }
        }

        var annotations = new Dictionary<string, string?>
        {
            [DrillSolvedAnnotation] = null,
            [DrillFailedAnnotation] = null,
            [DrillFailedMoveAnnotation] = null,
            [DrillVoidedAnnotation] = null,
            [InfrastructureUnhealthySinceAnnotation] = null,
            [InfrastructureUnhealthyReasonAnnotation] = null,
            [DrillGoalsMetSinceAnnotation] = null,
            [DrillStageAnnotation] = null,
            [DrillStageStartedAnnotation] = null,
            [DrillModeAnnotation] = null,
            [DrillRecordedAnnotation] = null,
            [RankedAttemptIdAnnotation] = null,
            [LearningCourseAnnotation] = null,
            [LearningCourseVersionAnnotation] = null,
            [LearningUnitAnnotation] = null,
        };
        // The cluster goes back to being an open sandbox, so the launch that produced the match is
        // over too. Leaving its bookkeeping behind would make the next ranked launch resume onto a
        // finished match's incident and attempt.
        foreach (var key in RankedLaunchOrchestrator.LaunchAnnotations) annotations[key] = null;
        foreach (var key in resource.Metadata.Annotations?.Keys ?? Enumerable.Empty<string>())
            if (key.StartsWith(DecisionAnnotationPrefix, StringComparison.Ordinal) ||
                key.StartsWith(RankedActionAnnotationPrefix, StringComparison.Ordinal) ||
                key.StartsWith(DelayedStageAppliedAnnotationPrefix, StringComparison.Ordinal))
                annotations[key] = null;

        var patchBody = new
        {
            metadata = new { annotations },
            // Returns the cluster to open-sandbox baseline. These replica counts are repeated in the
            // write-through below and must stay identical to it, or Crossplane's next reconcile
            // would undo the fast path.
            spec = new
            {
                drillId = "",
                drillStartedAt = "",
                releaseTrack = "stable",
                dataState = "healthy",
                dbMaxConns = 8,
                networkMode = "normal",
                targetPool = "apps",
                apiReplicas = 1,
                canaryReplicas = 0,
                cacheReplicas = 0,
                loadReplicas = 0,
                gatewayReplicas = 1,
            },
        };
        var ended = await PatchRunAsync(runId, patchBody, "end drill", ct);
        await WriteThroughSpecAsync(runId, Patch(
            ("apiReplicas", 1), ("canaryReplicas", 0), ("cacheReplicas", 0),
            ("releaseTrack", "stable"), ("dataState", "healthy"), ("dbMaxConns", 8),
            ("networkMode", "normal"), ("targetPool", "apps"),
            ("loadReplicas", 0), ("gatewayReplicas", 1)), ct);
        return ended;
    }

    private async Task<BrokerResult> PatchRunAsync(
        string runId, object patchBody, string what, CancellationToken ct)
    {
        var patch = new k8s.Models.V1Patch(patchBody, k8s.Models.V1Patch.PatchType.MergePatch);
        try
        {
            var updated = await _k8s.CustomObjects.PatchClusterCustomObjectAsync(
                patch, LabRun.Group, LabRun.Version, LabRun.Plural, runId, cancellationToken: ct);
            return BrokerResult.Accepted(RunView.From(Parse(updated)));
        }
        catch (HttpOperationException ex)
        {
            _log.LogError(ex, "Failed to {What} on {RunId}.", what, runId);
            return BrokerResult.Fail(502, "The run controller rejected the request.");
        }
    }

    // Per-component, per-pod view of the caller's cluster: what is running, whether it is ready, and
    // the CPU/memory each pod is actually using. This is what the request-path flowchart renders, so
    // every tier shows measured numbers rather than a static diagram. Pod names are reduced to their
    // short suffix and node placement is never exposed.
    public async Task<IReadOnlyList<RunComponent>?> GetComponentsAsync(
        string runId, string owner, CancellationToken ct)
    {
        var run = await GetRunAsync(runId, owner, ct);
        if (run is null) return null;
        var ns = run.Namespace ?? runId;

        var usage = await UsageAsync(ns, ct);
        try
        {
            var deployments = await _k8s.AppsV1.ListNamespacedDeploymentAsync(ns, cancellationToken: ct);
            var pods = await _k8s.CoreV1.ListNamespacedPodAsync(ns, cancellationToken: ct);
            return BuildComponents(deployments, pods, usage);
        }
        catch (HttpOperationException ex)
        {
            _log.LogDebug(ex, "Components unavailable for {RunId}.", runId);
            return [];
        }
    }

    /// <summary>Measured usage per pod (metrics-server); absent for pods not yet sampled.</summary>
    private async Task<Dictionary<string, (int Cpu, int Mem)>> UsageAsync(
        string ns, CancellationToken ct)
    {
        var usage = new Dictionary<string, (int Cpu, int Mem)>(StringComparer.Ordinal);
        try
        {
            var raw = await _k8s.CustomObjects.ListNamespacedCustomObjectAsync(
                "metrics.k8s.io", "v1beta1", ns, "pods", cancellationToken: ct);
            var list = KubernetesJson.Deserialize<PodMetricsList>(KubernetesJson.Serialize(raw));
            foreach (var pod in list.Items)
            {
                double cpu = 0, mem = 0;
                foreach (var c in pod.Containers)
                {
                    cpu += ParseCpuMillicores(c.Usage.Cpu);
                    mem += ParseMemoryMiB(c.Usage.Memory);
                }
                usage[pod.Metadata?.Name ?? ""] = ((int)Math.Round(cpu), (int)Math.Round(mem));
            }
        }
        catch (HttpOperationException) { /* metrics not ready yet */ }
        return usage;
    }

    /// <summary>Pure projection, so the snapshot can build tiers from lists it already has rather
    /// than fetching the namespace a second time.</summary>
    private static IReadOnlyList<RunComponent> BuildComponents(
        k8s.Models.V1DeploymentList deployments,
        k8s.Models.V1PodList pods,
        Dictionary<string, (int Cpu, int Mem)> usage)
    {
        List<RunComponent> components = [];
        {
            foreach (var d in deployments.Items.OrderBy(d => d.Metadata.Name, StringComparer.Ordinal))
            {
                var app = d.Metadata.Name;
                var mine = pods.Items
                    .Where(p => p.Metadata.Labels is { } l &&
                                l.TryGetValue("app", out var a) && a == app)
                    .ToArray();

                var podViews = mine.Select(p =>
                {
                    var name = p.Metadata.Name ?? "";
                    var shortName = name.Length > 5 ? name[^5..] : name;
                    var statuses = p.Status?.ContainerStatuses;
                    var containerReady = statuses?.All(c => c.Ready) ?? false;
                    var restarts = statuses?.Sum(c => c.RestartCount) ?? 0;
                    var u = usage.GetValueOrDefault(name);
                    var phase = p.Status?.Phase ?? "Pending";
                    // Prefer the container's own waiting reason; it is the specific one.
                    var detail =
                        statuses?.Select(c => c.State?.Waiting?.Reason)
                                 .FirstOrDefault(r => !string.IsNullOrEmpty(r))
                        ?? (phase == "Pending" ? "Scheduling"
                            : containerReady ? "" : "Starting");
                    return new RunPod(
                        shortName,
                        phase,
                        containerReady,
                        restarts,
                        u.Cpu,
                        u.Mem,
                        detail,
                        PoolOf(p.Spec?.NodeName));
                }).ToArray();

                components.Add(new RunComponent(
                    app,
                    d.Spec?.Replicas ?? 0,
                    d.Status?.ReadyReplicas ?? 0,
                    podViews.Sum(p => p.CpuMillicores),
                    podViews.Sum(p => p.MemoryMiB),
                    // Per-replica CPU ceiling, so the UI can show saturation honestly.
                    ParseCpuLimit(d),
                    podViews));
            }
        }

        return components;
    }

    // Which worker pool a pod actually landed on, in the same two-word vocabulary the drills already
    // use publicly for spec.targetPool. Deliberately NOT the node name: the pool is the thing an
    // exercise is about, and the identity of the machine underneath it is nobody's business. This is
    // measured placement rather than desired placement, which is the whole point during a migration
    // — a fleet half-moved genuinely shows half its pods on each pool.
    private static string PoolOf(string? nodeName)
    {
        if (string.IsNullOrEmpty(nodeName)) return "";
        if (nodeName.Contains("infra", StringComparison.OrdinalIgnoreCase)) return "infra";
        if (nodeName.Contains("apps", StringComparison.OrdinalIgnoreCase)) return "apps";
        return "";
    }

    private static int ParseCpuLimit(k8s.Models.V1Deployment d)
    {
        var limits = d.Spec?.Template?.Spec?.Containers?.FirstOrDefault()?.Resources?.Limits;
        if (limits is null || !limits.TryGetValue("cpu", out var q) || q is null) return 0;
        return (int)Math.Round(ParseCpuMillicores(q.ToString() ?? "0"));
    }

    // Real Kubernetes Events from the run's namespace, sanitized to a small public shape. This is the
    // arena's event stream: actual scheduling, image pull, probe, and scaling activity.
    public async Task<IReadOnlyList<RunEventView>?> GetEventsAsync(string runId, string owner, CancellationToken ct)
    {
        var view = await GetRunAsync(runId, owner, ct);
        if (view is null) return null;
        var ns = view.Namespace ?? runId;

        try
        {
            return BuildEvents(await _k8s.CoreV1.ListNamespacedEventAsync(ns, cancellationToken: ct));
        }
        catch (HttpOperationException ex)
        {
            _log.LogDebug(ex, "Events unavailable for {RunId}.", runId);
            return [];
        }
    }

    /// <summary>Pure projection over an already-fetched event list.</summary>
    private static IReadOnlyList<RunEventView> BuildEvents(k8s.Models.Corev1EventList list)
    {
        {
            return list.Items
                .Select(e => new
                {
                    At = e.LastTimestamp ?? e.EventTime ?? e.FirstTimestamp ?? e.Metadata.CreationTimestamp,
                    Event = e,
                })
                .Where(x => x.At is not null)
                .OrderBy(x => x.At)
                .TakeLast(40)
                .Select(x => new RunEventView(
                    x.Event.Metadata.Uid ?? $"{x.Event.Metadata.Name}",
                    x.At!.Value,
                    // Source is the controller that acted (scheduler, kubelet, deployment-controller).
                    x.Event.ReportingComponent is { Length: > 0 } rc ? rc : x.Event.Source?.Component ?? "kubernetes",
                    x.Event.Reason ?? "Event",
                    Sanitize(x.Event.Message ?? ""),
                    string.Equals(x.Event.Type, "Warning", StringComparison.OrdinalIgnoreCase)
                        ? "warning"
                        : "info",
                    // The object kind/name the event is about (Pod, Deployment, ...).
                    $"{x.Event.InvolvedObject?.Kind}".ToLowerInvariant()))
                .ToArray();
        }
    }

    // Events are cluster-internal text; keep them short and free of image digests / node identities.
    private static string Sanitize(string message)
    {
        var text = message.Length <= 160 ? message : message[..160] + "…";
        return text.Replace("\n", " ").Trim();
    }

    // Everything the live page needs for one frame, gathered once.
    //
    // Assembled from the four public read methods, this cost five GETs of the same LabRun (each of
    // them re-fetched it to find the namespace), two identical metrics-server listings, and two pod
    // listings — per poll, at 1.2s, per viewer. The run is already in hand here and every namespace
    // listing is taken exactly once, so a frame is now: pods, metrics, deployments, events, a trace
    // and a gateway scrape. The pod list does double duty as the components view and as the source
    // of the gateway IPs to scrape.
    public async Task<RunFrame> GetFrameAsync(LabRunResource resource, CancellationToken ct)
    {
        var view = RunView.From(resource);
        var runId = view.RunId;
        var ns = view.Namespace ?? runId;

        var podsTask = ListPodsAsync(ns, ct);
        var usageTask = UsageAsync(ns, ct);
        var deploymentsTask = ListDeploymentsAsync(ns, ct);
        var eventsTask = ListEventsAsync(ns, ct);
        var traceTask = ScrapeTraceAsync(runId, ns, ct);

        // The gateway scrape needs pod IPs, so it starts as soon as the pod list lands rather than
        // waiting for the rest of the frame.
        var pods = await podsTask;
        var gatewayIps = pods is null
            ? []
            : pods.Items
                .Where(p => p.Metadata?.Labels is { } l &&
                            l.TryGetValue("app", out var a) && a == "envoy" &&
                            p.Status?.PodIP is { Length: > 0 })
                .Select(p => p.Status.PodIP)
                .ToArray();
        var envoyTask = _envoy.ScrapeAsync(runId, ns, gatewayIps, ct);

        await Task.WhenAll(usageTask, deploymentsTask, eventsTask, traceTask, envoyTask);

        var usage = await usageTask;
        var deployments = await deploymentsTask;
        var events = await eventsTask;
        var envoy = await envoyTask;

        var components = deployments is null || pods is null
            ? []
            : BuildComponents(deployments, pods, usage);

        var telemetry = BuildTelemetry(view, usage, envoy);

        return new RunFrame(
            telemetry,
            components,
            events is null ? [] : BuildEvents(events),
            await traceTask,
            // Whether the gateway answered at all, which the aggregate telemetry cannot express: a
            // gateway that has never been scraped and a gateway serving nothing both read as zero
            // requests a second, and only one of them is an environment a match can be judged in.
            envoy is not null);
    }

    /// <summary>
    /// Protects rating from failures outside the generated incident. A single failed Kubernetes
    /// read is treated as transient; the same missing substrate must persist for a full grace
    /// window before the attempt is sealed void with no ELO mutation.
    /// </summary>
    public async Task<LabRunResource> VoidRankedInfrastructureFailureAsync(
        LabRunResource resource,
        RunFrame frame,
        string displayName,
        CancellationToken ct)
    {
        var view = RunView.From(resource);
        if (view.DrillMode != "ranked" || view.DrillSolved || view.DrillFailed)
            return resource;

        var reason = InfrastructureProblem(resource, frame);
        var annotations = resource.Metadata.Annotations;
        var sinceText = annotations?.GetValueOrDefault(
            InfrastructureUnhealthySinceAnnotation);
        if (reason is null)
        {
            if (string.IsNullOrEmpty(sinceText)) return resource;
            return await SetAnnotationsAsync(
                view.RunId,
                new()
                {
                    [InfrastructureUnhealthySinceAnnotation] = null,
                    [InfrastructureUnhealthyReasonAnnotation] = null,
                },
                ct) ?? resource;
        }

        var now = DateTime.UtcNow;
        var since = ParseAnnotationTime(sinceText);
        if (since is null)
        {
            return await SetAnnotationsAsync(
                view.RunId,
                new()
                {
                    [InfrastructureUnhealthySinceAnnotation] = now.ToString("O"),
                    [InfrastructureUnhealthyReasonAnnotation] = reason,
                },
                ct) ?? resource;
        }
        if (now - since.Value < InfrastructureFailureGrace) return resource;

        var voided = await SetAnnotationsAsync(
            view.RunId,
            new()
            {
                [DrillVoidedAnnotation] = now.ToString("O"),
                [InfrastructureUnhealthyReasonAnnotation] = reason,
                [DrillGoalsMetSinceAnnotation] = null,
            },
            ct) ?? resource;
        var voidedView = RunView.From(voided);
        await TryFinalizeRankedAsync(
            voided,
            voidedView,
            RankedOutcomes.Void,
            displayName,
            ct);
        return voided;
    }

    private static string? InfrastructureProblem(
        LabRunResource resource,
        RunFrame? frame)
    {
        var synced = resource.Status?.Conditions?.FirstOrDefault(condition =>
            condition.Type == "Synced");
        if (synced is { Status: not "True" })
            return "The platform could not reconcile the disposable cluster.";
        if (string.IsNullOrWhiteSpace(resource.Status?.Namespace))
            return "The disposable namespace was not assigned.";
        if (frame is null) return null;

        string[] required = ["checkout", "envoy", "k6", "postgres", "redis"];
        var present = frame.Components
            .Select(component => component.Name)
            .ToHashSet(StringComparer.Ordinal);
        var missing = required.Where(component => !present.Contains(component)).ToArray();
        return missing.Length == 0
            ? null
            : $"Required platform substrate is unavailable: {string.Join(", ", missing)}.";
    }

    // Namespace listings, each tolerant of a namespace that is still being composed. Returning null
    // rather than throwing keeps one missing piece from blanking the whole frame.
    private async Task<k8s.Models.V1PodList?> ListPodsAsync(string ns, CancellationToken ct)
    {
        try { return await _k8s.CoreV1.ListNamespacedPodAsync(ns, cancellationToken: ct); }
        catch (HttpOperationException ex)
        {
            _log.LogDebug(ex, "Pods unavailable in {Namespace}.", ns);
            return null;
        }
    }

    private async Task<k8s.Models.V1DeploymentList?> ListDeploymentsAsync(string ns, CancellationToken ct)
    {
        try { return await _k8s.AppsV1.ListNamespacedDeploymentAsync(ns, cancellationToken: ct); }
        catch (HttpOperationException ex)
        {
            _log.LogDebug(ex, "Deployments unavailable in {Namespace}.", ns);
            return null;
        }
    }

    private async Task<k8s.Models.Corev1EventList?> ListEventsAsync(string ns, CancellationToken ct)
    {
        try { return await _k8s.CoreV1.ListNamespacedEventAsync(ns, cancellationToken: ct); }
        catch (HttpOperationException ex)
        {
            _log.LogDebug(ex, "Events unavailable in {Namespace}.", ns);
            return null;
        }
    }

    private async Task<RunTrace?> ScrapeTraceAsync(string runId, string ns, CancellationToken ct)
    {
        try { return await _traces.ScrapeAsync(runId, ns, ct); }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Trace unavailable for {RunId}.", runId);
            return null;
        }
    }

    /// <summary>Sum the namespace's measured usage and pair it with the gateway's request metrics.
    /// Pure, so the snapshot builds it from lists it already holds.</summary>
    private static RunTelemetry BuildTelemetry(
        RunView view,
        Dictionary<string, (int Cpu, int Mem)> usage,
        EnvoyMetrics? envoy)
    {
        double cpuMillis = 0, memMiB = 0, postgresCpuMillis = 0;
        foreach (var (name, u) in usage)
        {
            cpuMillis += u.Cpu;
            memMiB += u.Mem;
            if (name.StartsWith("postgres-", StringComparison.Ordinal) || name == "postgres")
                postgresCpuMillis += u.Cpu;
        }

        return new RunTelemetry(
            // Pods that metrics-server has actually sampled, NOT pods that exist. The page reads a
            // non-zero count as "this cluster is serving" and flips out of its provisioning state on
            // it, so counting scheduled-but-not-running pods here would call a starting namespace
            // ready.
            usage.Count,
            (int)Math.Round(cpuMillis), (int)Math.Round(memMiB),
            Math.Clamp((int)Math.Round(postgresCpuMillis / 5.0), 0, 100),
            view.ApiReplicas, view.CacheEnabled,
            envoy?.RequestsPerSec ?? 0,
            envoy?.P95LatencyMs ?? 0,
            envoy?.ErrorRatePct ?? 0);
    }

    public async Task<RunView?> GetRunAsync(string runId, string owner, CancellationToken ct)
    {
        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        return resource is null ? null : RunView.From(resource);
    }

    private async Task<LabRunResource?> GetResourceAsync(string runId, CancellationToken ct)
    {
        try
        {
            var obj = await _k8s.CustomObjects.GetClusterCustomObjectAsync(
                LabRun.Group, LabRun.Version, LabRun.Plural, runId, cancellationToken: ct);
            return Parse(obj);
        }
        catch (HttpOperationException ex) when (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<PlatformStatus> GetPlatformStatusAsync(CancellationToken ct)
    {
        var nodes = await _k8s.CoreV1.ListNodeAsync(cancellationToken: ct);
        var ready = nodes.Items.Count(node =>
            node.Status?.Conditions?.Any(c => c.Type == "Ready" && c.Status == "True") == true);
        var active = (await ListAsync(ct)).Count(run => run.Status is "provisioning" or "ready");
        var slots = Math.Max(0, _options.MaxConcurrentRuns - active);
        var freePct = _options.MaxConcurrentRuns == 0
            ? 0
            : (int)Math.Round(slots * 100.0 / _options.MaxConcurrentRuns);

        return new PlatformStatus(
            ready == nodes.Items.Count ? "ready" : ready > 0 ? "degraded" : "offline",
            ready,
            nodes.Items.Count,
            active,
            _options.MaxConcurrentRuns,
            slots,
            freePct);
    }

    public async Task<PlatformOverview> GetOverviewAsync(CancellationToken ct)
    {
        var active = (await ListAsync(ct)).Count(run => run.Status is "provisioning" or "ready");
        return await _inventory.GetOverviewAsync(active, ct);
    }

    public Task<HomelabTopology> GetTopologyAsync(CancellationToken ct) =>
        _inventory.GetTopologyAsync(ct);

    public async Task<BrokerResult> SubmitPracticeActionAsync(
        string runId, string actionId, string owner, CancellationToken ct)
    {
        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        if (resource is null)
            return BrokerResult.Fail(404, "No such practice cluster.");
        if (resource.Spec.ScenarioId != "practice-cluster")
            return BrokerResult.Fail(409, "This run is not a practice cluster.");

        // Sliders send an exact value ("scale-4", "load-2"). Parsing is bounded to the same range the
        // XRD enforces, so an arbitrary number still cannot reach the cluster.
        IReadOnlyDictionary<string, object> spec =
            TryRangedAction(actionId, "scale-", 1, 6, out var replicas)
                ? Patch(("apiReplicas", replicas))
            : TryRangedAction(actionId, "load-", 0, 4, out var load)
                ? Patch(("loadReplicas", load))
            : TryRangedAction(actionId, "gateway-", 1, 3, out var gateways)
                ? Patch(("gatewayReplicas", gateways))
            : TryRangedAction(actionId, "canary-", 0, 3, out var canaries)
                ? Patch(("canaryReplicas", canaries))
            : actionId switch
            {
                "cache-on" => Patch(("cacheReplicas", 1)),
                "cache-off" => Patch(("cacheReplicas", 0)),
                "release-candidate" => Patch(("releaseTrack", "candidate")),
                "release-stable" => Patch(("releaseTrack", "stable")),
                "move-apps" => Patch(("targetPool", "apps")),
                "move-infra" => Patch(("targetPool", "infra")),
                "traffic-on" => Patch(("loadReplicas", 1)),
                "cache-scale" => Patch(("cacheReplicas", 1)),
                "traffic-off" => Patch(("loadReplicas", 0)),
                "restart" => Patch(("restartToken", Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(6)))),
                "reset" => Patch(
                    ("apiReplicas", 1), ("canaryReplicas", 0), ("cacheReplicas", 0),
                    ("releaseTrack", "stable"), ("dataState", "healthy"), ("dbMaxConns", 8),
                    ("networkMode", "normal"), ("targetPool", "apps"),
                    ("loadReplicas", 0), ("gatewayReplicas", 1),
                    ("restartToken", Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(6)))),
                _ => new Dictionary<string, object>(),
            };
        if (spec.Count == 0)
            return BrokerResult.Fail(404, $"Unknown practice action '{actionId}'.");

        var patchBody = new
        {
            metadata = new
            {
                annotations = new Dictionary<string, string>
                {
                    ["homeops.isaacwallace.dev/practice-action"] = actionId,
                    ["homeops.isaacwallace.dev/practice-action-at"] = DateTime.UtcNow.ToString("O"),
                },
            },
            spec,
        };
        var patch = new k8s.Models.V1Patch(patchBody, k8s.Models.V1Patch.PatchType.MergePatch);
        try
        {
            var updated = await _k8s.CustomObjects.PatchClusterCustomObjectAsync(
                patch, LabRun.Group, LabRun.Version, LabRun.Plural, runId, cancellationToken: ct);
            await WriteThroughSpecAsync(runId, spec, ct);
            return BrokerResult.Accepted(RunView.From(Parse(updated)));
        }
        catch (HttpOperationException ex)
        {
            _log.LogError(ex, "Failed practice action {Action} on {RunId}.", actionId, runId);
            return BrokerResult.Fail(502, "The practice controller rejected the action.");
        }
    }

    /// <summary>
    /// Apply one command from the competitive operator allowlist. The caller supplies operator
    /// vocabulary, never a patch; RankedCommand is the complete translation boundary. Unlike the
    /// old decision endpoint, an ineffective action does not end the match. The measured stage
    /// objective remains the only path to progression.
    /// </summary>
    public async Task<BrokerResult> SubmitRankedCommandAsync(
        string runId, string input, string owner, CancellationToken ct)
    {
        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        if (resource is null)
            return BrokerResult.Fail(404, "No such ranked arena.");

        var view = RunView.From(resource);
        if (view.DrillMode != "ranked" || view.DrillId.Length == 0)
            return BrokerResult.Fail(409, "No ranked match is active on this cluster.");
        if (view.DrillSolved || view.DrillFailed)
            return BrokerResult.Fail(409, "This ranked match is already sealed.");
        if (view.RankedActions.Count >= RankedRules.MaxActionsPerAttempt)
            return BrokerResult.Fail(429, "The action limit for this ranked match was reached.");

        if (!RankedCommand.TryParse(input, out var command, out var error) || command is null)
            return BrokerResult.Fail(400, error);

        var acceptedAt = DateTime.UtcNow;
        var entryId = Guid.NewGuid().ToString("n");
        var actionKey = $"{RankedActionAnnotationPrefix}{entryId}";
        var actionValue =
            $"{acceptedAt:O}|{command.Canonical}|{command.ActionId}|{view.DrillStage}";
        var patchBody = new
        {
            metadata = new
            {
                annotations = new Dictionary<string, string>
                {
                    [actionKey] = actionValue,
                },
            },
            spec = command.SpecPatch,
        };

        var patch = new k8s.Models.V1Patch(
            patchBody,
            k8s.Models.V1Patch.PatchType.MergePatch);
        try
        {
            var updated = await _k8s.CustomObjects.PatchClusterCustomObjectAsync(
                patch, LabRun.Group, LabRun.Version, LabRun.Plural, runId, cancellationToken: ct);
            await WriteThroughSpecAsync(runId, command.SpecPatch, ct);
            var updatedView = RunView.From(Parse(updated));
            var attemptId = resource.Metadata.Annotations?
                .GetValueOrDefault(RankedAttemptIdAnnotation) ?? "";
            try
            {
                await _ranked.RecordActionAsync(
                    entryId,
                    attemptId,
                    runId,
                    owner,
                    command.Canonical,
                    command.ActionId,
                    view.DrillStage,
                    acceptedAt,
                    ct);
            }
            catch (Exception ex)
            {
                // The LabRun annotation is the retry source. Snapshot evaluation copies it into the
                // database later, so a brief store outage never turns an applied action into a lie.
                _log.LogError(
                    ex,
                    "Could not persist ranked action {ActionEntryId} for {RunId}.",
                    entryId,
                    runId);
            }
            return BrokerResult.Accepted(updatedView);
        }
        catch (HttpOperationException ex)
        {
            _log.LogError(
                ex,
                "Failed ranked command {Command} on {RunId}.",
                command.Canonical,
                runId);
            return BrokerResult.Fail(502, "The ranked controller rejected the command.");
        }
    }

    /// <summary>
    /// Executes one read-only investigation from the ranked allowlist and records that evidence
    /// before returning it. Unlike the old client-only console, the post-match debrief can now prove
    /// which signals the operator actually consulted.
    /// </summary>
    public async Task<RankedInspectionBrokerResult> InspectRankedAsync(
        string runId,
        string input,
        string owner,
        CancellationToken ct)
    {
        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        if (resource is null)
            return RankedInspectionBrokerResult.Fail(404, "No such ranked arena.");
        var view = RunView.From(resource);
        if (view.DrillMode != "ranked" || view.DrillId.Length == 0)
            return RankedInspectionBrokerResult.Fail(
                409, "No ranked match is active on this cluster.");
        if (view.DrillSolved || view.DrillFailed)
            return RankedInspectionBrokerResult.Fail(
                409, "This ranked match is already sealed.");
        if (!RankedInspection.TryParse(input, out var inspection, out var error) ||
            inspection is null)
            return RankedInspectionBrokerResult.Fail(400, error);

        IReadOnlyList<string> lines;
        try
        {
            lines = inspection.Kind switch
            {
                "metrics" => await InspectMetricsAsync(resource, view, inspection, ct),
                "events" => InspectEvents(
                    await GetEventsAsync(runId, owner, ct) ?? [],
                    inspection.WarningsOnly),
                "pods" => InspectPods(
                    await GetComponentsAsync(runId, owner, ct) ?? [],
                    inspection.Service),
                "logs" => await InspectLogsAsync(resource, inspection.Service, ct),
                "deployments" => await InspectDeploymentsAsync(resource, ct),
                "trace" => InspectTrace(await GetTraceAsync(runId, owner, ct)),
                "history" => InspectHistory(view),
                _ => [],
            };
        }
        catch (HttpOperationException ex)
        {
            _log.LogDebug(
                ex,
                "Ranked inspection {Inspection} failed for {RunId}.",
                inspection.Canonical,
                runId);
            return RankedInspectionBrokerResult.Fail(
                503, "That cluster evidence is temporarily unavailable.");
        }

        if (lines.Count == 0) lines = ["No matching evidence is available yet."];
        var observedUtc = DateTime.UtcNow;
        var evidenceId = Guid.NewGuid().ToString("n");
        var attemptId = resource.Metadata.Annotations?
            .GetValueOrDefault(RankedAttemptIdAnnotation) ?? "";
        RankedEvidenceView? saved;
        try
        {
            saved = await _ranked.RecordEvidenceAsync(
                evidenceId,
                attemptId,
                runId,
                owner,
                inspection.Canonical,
                inspection.Kind,
                string.Join(" | ", lines.Take(3)),
                view.DrillStage,
                observedUtc,
                ct);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Could not persist ranked evidence for {RunId}.", runId);
            return RankedInspectionBrokerResult.Fail(
                503, "The evidence audit is temporarily unavailable.");
        }
        if (saved is null)
            return RankedInspectionBrokerResult.Fail(
                429, "The evidence limit for this ranked match was reached.");

        return RankedInspectionBrokerResult.Accepted(
            new RankedInspectionResult(
                evidenceId,
                inspection.Canonical,
                inspection.Kind,
                view.DrillStage,
                observedUtc,
                lines));
    }

    private async Task<IReadOnlyList<string>> InspectMetricsAsync(
        LabRunResource resource,
        RunView view,
        RankedInspection inspection,
        CancellationToken ct)
    {
        if (inspection.Service is not null)
        {
            var components = await GetComponentsAsync(view.RunId, view.Owner, ct) ?? [];
            var component = components.FirstOrDefault(candidate =>
                candidate.Name == inspection.Service);
            if (component is null)
                return [$"No measured service matches '{inspection.Service}'."];
            var limit = component.CpuLimitMillicoresPerPod <= 0
                ? ""
                : $" / {component.CpuLimitMillicoresPerPod * Math.Max(1, component.Desired)}m limit";
            return
            [
                $"{component.Name}: {component.Ready}/{component.Desired} ready",
                $"cpu {component.CpuMillicores}m{limit} · memory {component.MemoryMiB}Mi",
                $"restarts {component.Pods.Sum(pod => pod.Restarts)}",
            ];
        }

        var telemetry = await GetTelemetryAsync(view.RunId, view.Owner, ct);
        if (telemetry is null) return ["No request telemetry is available yet."];
        var visibility = RankedScenarioCatalog.TryPlan(view.DrillId)?.Telemetry;
        var served = visibility?.Throughput == false
            ? "served [withheld]"
            : $"served {telemetry.RequestsPerSec}/s";
        var latency = visibility?.Latency == false
            ? "p95 [withheld]"
            : $"p95 {telemetry.P95LatencyMs:0.#}ms";
        var errors = visibility?.Errors == false
            ? "errors [withheld]"
            : $"errors {telemetry.ErrorRatePct:0.00}%";
        return
        [
            $"{served} · offered {view.OfferedRequestsPerSec}/s",
            $"{latency} · objective is judged server-side",
            $"{errors} · live gauges follow match visibility",
            $"checkout {view.ApiReplicas} · gateway {view.GatewayReplicas} · canary {view.CanaryReplicas}",
        ];
    }

    private static IReadOnlyList<string> InspectEvents(
        IReadOnlyList<RunEventView> events,
        bool warningsOnly)
    {
        var visible = (warningsOnly
                ? events.Where(item => item.Severity == "warning")
                : events)
            .TakeLast(8)
            .Select(item =>
                $"{(item.Severity == "warning" ? "WARN" : "INFO")} {item.Reason} · {item.Message}")
            .ToArray();
        return visible.Length == 0
            ? [warningsOnly
                ? "No Kubernetes warnings in the current event window."
                : "No Kubernetes events are available yet."]
            : visible;
    }

    private static IReadOnlyList<string> InspectPods(
        IReadOnlyList<RunComponent> components,
        string? service)
    {
        var selected = service is null
            ? components
            : components.Where(component => component.Name == service).ToArray();
        if (service is not null && selected.Count == 0)
            return [$"No measured service matches '{service}'."];
        var lines = selected
            .SelectMany(component => component.Pods.Select(pod =>
                $"{component.Name}/{pod.Name} {(pod.Ready ? "ready" : pod.Detail.Length > 0 ? pod.Detail : pod.Phase)} "
                + $"pool={(pod.Pool.Length > 0 ? pod.Pool : "pending")} cpu={pod.CpuMillicores}m mem={pod.MemoryMiB}Mi"))
            .TakeLast(24)
            .ToArray();
        return lines.Length == 0 ? ["No pods are visible yet."] : lines;
    }

    private async Task<IReadOnlyList<string>> InspectLogsAsync(
        LabRunResource resource,
        string? service,
        CancellationToken ct)
    {
        var ns = resource.Status?.Namespace ?? resource.Spec.RunId;
        var app = service ?? "checkout";
        var pods = await _k8s.CoreV1.ListNamespacedPodAsync(
            ns,
            labelSelector: $"app={app}",
            cancellationToken: ct);
        var selected = pods.Items
            .Where(pod => pod.Metadata?.Name is { Length: > 0 })
            .OrderByDescending(pod =>
                pod.Status?.ContainerStatuses?.All(container => container.Ready) == true)
            .Take(2)
            .ToArray();
        if (selected.Length == 0) return [$"No {app} pod is available for logs."];

        var lines = new List<string>();
        foreach (var pod in selected)
        {
            await using var stream = await _k8s.CoreV1.ReadNamespacedPodLogAsync(
                pod.Metadata.Name,
                ns,
                tailLines: 24,
                timestamps: true,
                cancellationToken: ct);
            using var reader = new StreamReader(stream);
            var text = await RankedLogSanitizer.ReadBoundedAsync(reader, ct: ct);
            lines.AddRange(text
                .Split('\n', StringSplitOptions.RemoveEmptyEntries)
                .Select(RankedLogSanitizer.Sanitize)
                .Where(line => line.Length > 0));
        }
        return lines.TakeLast(32).ToArray();
    }

    private async Task<IReadOnlyList<string>> InspectDeploymentsAsync(
        LabRunResource resource,
        CancellationToken ct)
    {
        var ns = resource.Status?.Namespace ?? resource.Spec.RunId;
        var deployments = await _k8s.AppsV1.ListNamespacedDeploymentAsync(
            ns, cancellationToken: ct);
        return deployments.Items
            .OrderBy(deployment => deployment.Metadata?.Name, StringComparer.Ordinal)
            .Select(deployment =>
            {
                var name = deployment.Metadata?.Name ?? "deployment";
                var desired = deployment.Spec?.Replicas ?? 0;
                var updated = deployment.Status?.UpdatedReplicas ?? 0;
                var ready = deployment.Status?.ReadyReplicas ?? 0;
                var unavailable = deployment.Status?.UnavailableReplicas ?? 0;
                var generation = deployment.Metadata?.Generation ?? 0;
                var observed = deployment.Status?.ObservedGeneration ?? 0;
                var condition = deployment.Status?.Conditions?
                    .OrderByDescending(item => item.LastUpdateTime)
                    .FirstOrDefault();
                var state = condition is null
                    ? "waiting for controller status"
                    : $"{condition.Type}={condition.Status} {condition.Reason}";
                return $"{name}: generation {observed}/{generation} · updated {updated}/{desired} · "
                    + $"ready {ready}/{desired} · unavailable {unavailable} · {state}";
            })
            .ToArray();
    }

    private static IReadOnlyList<string> InspectTrace(RunTrace? trace) =>
        trace is null
            ? ["No distributed trace has been captured yet."]
            :
            [
                $"trace {trace.TraceId[..Math.Min(12, trace.TraceId.Length)]} · {trace.DurationMs}ms · release {trace.Release}",
                .. trace.Spans.Select(span =>
                    $"{(span.Status == "error" ? "ERR " : "OK  ")} {span.Service}/{span.Name} {span.DurationMs}ms"),
            ];

    private static IReadOnlyList<string> InspectHistory(RunView view)
    {
        var lines = view.RankedActions
            .Select(action =>
                $"{TimeSpan.FromMilliseconds(action.AcceptedAtMs):mm\\:ss}  {action.Command}")
            .ToArray();
        return lines.Length == 0 ? ["No mutations accepted yet."] : lines;
    }

    private static string SanitizeLogLine(string line)
    {
        var cleaned = line.Replace('\r', ' ').Replace('\t', ' ').Trim();
        if (cleaned.Length > 180) cleaned = cleaned[..180] + "…";
        return cleaned;
    }

    // The composed Object that owns each scalable tier. Kept in one place so the write-through below
    // cannot drift from the naming the Composition uses.
    private static readonly (string SpecField, string ObjectSuffix)[] ReplicaTiers =
    [
        ("apiReplicas", "checkout"),
        ("canaryReplicas", "checkout-canary"),
        ("cacheReplicas", "redis"),
        ("loadReplicas", "k6"),
        ("gatewayReplicas", "envoy"),
    ];

    // Make an operator change visible now rather than a minute from now.
    //
    // Changing a LabRun's spec should reach the Deployment immediately, and on a settled run it does
    // (~200ms). But Crossplane v2 guards realtime composition with a circuit breaker, and the twenty
    // composed Objects in a run churn their own status often enough to hold that breaker open — so a
    // spec change waits out the breaker's cooldown, up to a minute, which is most of a practice
    // cluster's useful life. Measured on a fresh run: 55s through Crossplane, 228ms written through.
    //
    // So the broker writes the allowlisted state it just stored on the LabRun straight to the
    // composed Object as well. This is not a second source of truth: the LabRun still holds it, and
    // when Crossplane does reconcile it writes the identical number, so there is nothing to diverge
    // and the workload cannot flap back. Best effort by design — if it fails, the run is exactly as
    // correct as before, just slower to show it.
    private async Task WriteThroughSpecAsync(
        string runId, IReadOnlyDictionary<string, object> spec, CancellationToken ct)
    {
        foreach (var (field, suffix) in ReplicaTiers)
        {
            if (!spec.TryGetValue(field, out var raw) || raw is not int replicas) continue;
            var patch = new k8s.Models.V1Patch(
                new { spec = new { forProvider = new { manifest = new { spec = new { replicas } } } } },
                k8s.Models.V1Patch.PatchType.MergePatch);
            try
            {
                await _k8s.CustomObjects.PatchClusterCustomObjectAsync(
                    patch, "kubernetes.crossplane.io", "v1alpha2", "objects",
                    $"{runId}-{suffix}", cancellationToken: ct);
            }
            catch (HttpOperationException ex)
            {
                _log.LogDebug(ex, "Write-through to {RunId}-{Suffix} failed.", runId, suffix);
            }
        }

        var workloadChanges = new Dictionary<string, List<object>>(StringComparer.Ordinal);
        void Replace(string suffix, string path, object value)
        {
            if (!workloadChanges.TryGetValue(suffix, out var operations))
            {
                operations = [];
                workloadChanges[suffix] = operations;
            }
            operations.Add(new { op = "replace", path, value });
        }
        void ReplaceBoth(string path, object value)
        {
            Replace("checkout", path, value);
            Replace("checkout-canary", path, value);
        }

        if (spec.TryGetValue("dbMaxConns", out var dbMaxConns) && dbMaxConns is int connections)
            ReplaceBoth(
                "/spec/forProvider/manifest/spec/template/spec/containers/0/env/4/value",
                connections.ToString(CultureInfo.InvariantCulture));
        if (spec.TryGetValue("networkMode", out var networkMode) && networkMode is string network)
            ReplaceBoth(
                "/spec/forProvider/manifest/spec/template/metadata/labels/homeops-db-network",
                network);
        if (spec.TryGetValue("targetPool", out var targetPool) && targetPool is string pool)
        {
            var hostname = pool switch
            {
                "apps" => "k3s-worker-apps",
                "infra" => "k3s-worker-infra",
                "unavailable" => "homeops-no-such-worker",
                _ => "",
            };
            if (hostname.Length > 0)
                ReplaceBoth(
                    "/spec/forProvider/manifest/spec/template/spec/nodeSelector/kubernetes.io~1hostname",
                    hostname);
        }
        if (spec.TryGetValue("restartToken", out var restartToken) && restartToken is string token)
            ReplaceBoth(
                "/spec/forProvider/manifest/spec/template/metadata/annotations/homeops.isaacwallace.dev~1restart-token",
                token);
        if (spec.TryGetValue("releaseTrack", out var releaseTrack) && releaseTrack is string release)
            Replace(
                "checkout",
                "/spec/forProvider/manifest/spec/template/spec/containers/0/env/5/value",
                release);
        if (spec.TryGetValue("dataState", out var dataState) && dataState is string data)
            ReplaceBoth(
                "/spec/forProvider/manifest/spec/template/spec/containers/0/env/6/value",
                data);

        foreach (var (suffix, operations) in workloadChanges)
        {
            var patch = new k8s.Models.V1Patch(
                operations,
                k8s.Models.V1Patch.PatchType.JsonPatch);
            try
            {
                await _k8s.CustomObjects.PatchClusterCustomObjectAsync(
                    patch, "kubernetes.crossplane.io", "v1alpha2", "objects",
                    $"{runId}-{suffix}", cancellationToken: ct);
            }
            catch (HttpOperationException ex)
            {
                _log.LogDebug(
                    ex,
                    "Workload write-through to {RunId}-{Suffix} failed.",
                    runId,
                    suffix);
            }
        }
    }

    // "scale-4" -> 4, bounded to [min,max]. Anything outside the range is not a valid action.
    private static bool TryRangedAction(
        string actionId, string prefix, int min, int max, out int value)
    {
        value = 0;
        if (!actionId.StartsWith(prefix, StringComparison.Ordinal)) return false;
        if (!int.TryParse(actionId[prefix.Length..], out var parsed)) return false;
        if (parsed < min || parsed > max) return false;
        value = parsed;
        return true;
    }

    private static IReadOnlyDictionary<string, object> Patch(
        params (string Key, object Value)[] fields) =>
        fields.ToDictionary(x => x.Key, x => x.Value, StringComparer.Ordinal);

    public async Task<RunTrace?> GetTraceAsync(string runId, string owner, CancellationToken ct)
    {
        var run = await GetRunAsync(runId, owner, ct);
        if (run?.Namespace is null) return null;
        return await _traces.ScrapeAsync(runId, run.Namespace, ct);
    }

    public async Task<RunReport?> GetReportAsync(string runId, string owner, CancellationToken ct)
    {
        var run = await GetRunAsync(runId, owner, ct);
        if (run is null || run.CreatedAt is null) return null;
        if (!ScenarioDefinitions.All.TryGetValue(run.ScenarioId, out var scenario)) return null;

        var elapsed = (DateTime.UtcNow - run.CreatedAt.Value).TotalSeconds - 16;
        if (elapsed < scenario.ParSeconds) return RunReport.NotReady(runId, run.ScenarioId);

        var telemetry = await GetTelemetryAsync(runId, owner, ct);
        var passedState = run.ScenarioId switch
        {
            "checkout-bad-release" => run.ReleaseTrack == "stable",
            "catalogue-data-recovery" => run.DataState == "recovered",
            "worker-evacuation" => run.TargetPool == "infra",
            _ => run.ApiReplicas >= 6 || run.CacheEnabled,
        };
        var inBudget = telemetry is not null &&
            telemetry.P95LatencyMs <= 120 &&
            telemetry.ErrorRatePct <= 1;
        var outcome = passedState && inBudget ? "passed" : passedState ? "degraded" : "failed";
        var score = outcome == "passed" ? 100 : outcome == "degraded" ? 65 : 30;
        var findings = new List<ReportFinding>
        {
            new(
                "Scenario objective",
                passedState ? "The required platform state was reached." : "The required platform state was not reached.",
                passedState ? "success" : "critical"),
            new(
                "Final SLO window",
                inBudget
                    ? "Measured p95 latency and error rate were inside the objective."
                    : "The final measured window remained outside the objective.",
                inBudget ? "success" : "warning"),
        };

        return new RunReport(
            true,
            run.RunId,
            run.ScenarioId,
            outcome,
            score,
            scenario.Objective,
            outcome == "passed"
                ? "The operator recovered the real workload and preserved the final SLO window."
                : "The run completed with unresolved or late recovery signals.",
            run.AcceptedDecisions,
            findings,
            DateTime.UtcNow);
    }

    // Real telemetry: sum the run namespace's actual CPU/memory usage from metrics-server, plus the
    // decision-driven state. Returns null only when the run itself is gone; if metrics aren't ready
    // yet (pods still starting), usage reads as zero rather than failing.
    public async Task<RunTelemetry?> GetTelemetryAsync(string runId, string owner, CancellationToken ct)
    {
        var run = await GetRunAsync(runId, owner, ct);
        if (run is null) return null;
        var ns = run.Namespace ?? runId;

        // Same single-pass shape as a frame, minus the parts a mutation response does not render.
        var podsTask = ListPodsAsync(ns, ct);
        var usageTask = UsageAsync(ns, ct);
        await Task.WhenAll(podsTask, usageTask);

        var pods = await podsTask;
        // Every gateway replica, by pod IP. The gateway is a scalable tier and each replica only
        // counts the requests it served, so the run's throughput is the sum across them — via the
        // Service it would be whichever single pod kube-proxy happened to pick.
        var gatewayIps = pods is null
            ? []
            : pods.Items
                .Where(p => p.Metadata?.Labels is { } l &&
                            l.TryGetValue("app", out var a) && a == "envoy" &&
                            p.Status?.PodIP is { Length: > 0 })
                .Select(p => p.Status.PodIP)
                .ToArray();

        // Real request metrics from the run's Envoy gateways (null while the workload is starting).
        var envoy = await _envoy.ScrapeAsync(runId, ns, gatewayIps, ct);
        return BuildTelemetry(run, await usageTask, envoy);
    }

    // metrics-server reports CPU in nanocores ("n") by convention; also handle m/u/cores.
    private static double ParseCpuMillicores(string q)
    {
        q = q.Trim();
        if (q.EndsWith('n')) return double.Parse(q[..^1], CultureInfo.InvariantCulture) / 1_000_000.0;
        if (q.EndsWith('u')) return double.Parse(q[..^1], CultureInfo.InvariantCulture) / 1_000.0;
        if (q.EndsWith('m')) return double.Parse(q[..^1], CultureInfo.InvariantCulture);
        return double.Parse(q, CultureInfo.InvariantCulture) * 1000.0;
    }

    private static double ParseMemoryMiB(string q)
    {
        q = q.Trim();
        double v(int n) => double.Parse(q[..^n], CultureInfo.InvariantCulture);
        if (q.EndsWith("Ki")) return v(2) / 1024.0;
        if (q.EndsWith("Mi")) return v(2);
        if (q.EndsWith("Gi")) return v(2) * 1024.0;
        return double.Parse(q, CultureInfo.InvariantCulture) / (1024.0 * 1024.0); // bytes
    }

    public const string DrillSolvedAnnotation = "homeops.isaacwallace.dev/drill-solved-at";
    public const string DrillGoalsMetSinceAnnotation = "homeops.isaacwallace.dev/drill-goals-met-since";
    public const string DrillStageAnnotation = "homeops.isaacwallace.dev/drill-stage";
    public const string DrillStageStartedAnnotation = "homeops.isaacwallace.dev/drill-stage-started";
    public const string DrillModeAnnotation = "homeops.isaacwallace.dev/drill-mode";
    public const string DrillRecordedAnnotation = "homeops.isaacwallace.dev/drill-recorded";
    public const string DecisionAnnotationPrefix = "homeops.isaacwallace.dev/decision-";
    // A ranked attempt is one shot: the first wrong move ends it. Recorded on the cluster rather
    // than inferred, so a reload lands on the same verdict and a second api replica agrees with it.
    public const string DrillFailedAnnotation = "homeops.isaacwallace.dev/drill-failed-at";
    public const string DrillFailedMoveAnnotation = "homeops.isaacwallace.dev/drill-failed-move";
    public const string DrillVoidedAnnotation = "homeops.isaacwallace.dev/drill-voided-at";
    public const string InfrastructureUnhealthySinceAnnotation =
        "homeops.isaacwallace.dev/infra-unhealthy-since";
    public const string InfrastructureUnhealthyReasonAnnotation =
        "homeops.isaacwallace.dev/infra-unhealthy-reason";
    public const string InfrastructureVoidMove = "infrastructure-void";
    public const string RankedAttemptIdAnnotation = "homeops.isaacwallace.dev/ranked-attempt-id";
    public const string LastRankedDrillAnnotation = "homeops.isaacwallace.dev/last-ranked-drill";
    public const string RankedActionAnnotationPrefix = "homeops.isaacwallace.dev/ranked-action-";
    public const string DelayedStageAppliedAnnotationPrefix =
        "homeops.isaacwallace.dev/ranked-delayed-stage-";
    public const string LearningCourseAnnotation = "homeops.isaacwallace.dev/learning-course";
    public const string LearningCourseVersionAnnotation = "homeops.isaacwallace.dev/learning-course-version";
    public const string LearningUnitAnnotation = "homeops.isaacwallace.dev/learning-unit";

    /// <summary>How long the objective must hold continuously before a stage counts as resolved.</summary>
    public static readonly TimeSpan GoalHold = TimeSpan.FromSeconds(15);
    public static readonly TimeSpan InfrastructureFailureGrace = TimeSpan.FromSeconds(30);

    // Judge the active stage against what the cluster is measurably doing, then either open the next
    // stage of the cascade or record the drill as solved.
    //
    // Completion used to mean "every correct option has been clicked", which announced success
    // before the workload had recovered. It now means the objective itself holds — and holds, which
    // is the important word: measured signals are noisy, and a single sampling window can read well
    // in the middle of a rollout while the service is still saturated. So the clock starts when
    // every condition is first met and the stage is only resolved if they are all still met
    // GoalHold later; one bad reading in between resets it. Once recorded, a later dip cannot
    // retract a result the operator has already earned.
    public async Task<DrillEvaluation> EvaluateDrillAsync(
        LabRunResource resource, RunTelemetry telemetry, string displayName, CancellationToken ct)
    {
        var view = RunView.From(resource);
        if (view.DrillId.Length == 0 ||
            ScenarioDefinitions.Find(view.DrillId) is not { } drill ||
            drill.Stages.Count == 0)
            return new DrillEvaluation([], resource);

        var stageIndex = Math.Clamp(view.DrillStage - 1, 0, drill.Stages.Count - 1);
        var stage = drill.Stages[stageIndex];
        if (stage.Goals.Count == 0) return new DrillEvaluation([], resource);

        var goals = ScenarioDefinitions.Evaluate(stage, telemetry, resource.Spec);
        await TryPersistRankedActionsAsync(resource, view, ct);
        await TryRecordRankedTelemetryAsync(resource, view, telemetry, stage, goals, ct);
        var annotations = resource.Metadata.Annotations;
        // Terminal receipts take precedence over delayed activation. A decided attempt may keep
        // rendering measured goals, but the platform must never introduce another fault afterwards.
        if (annotations?.ContainsKey(DrillSolvedAnnotation) == true)
        {
            await TryRecordAcademyAsync(resource, view, displayName, ct);
            await TryFinalizeRankedAsync(
                resource, view, RankedOutcomes.Completed, displayName, ct);
            return new DrillEvaluation(goals, resource);
        }
        if (annotations?.ContainsKey(DrillVoidedAnnotation) == true)
        {
            await TryFinalizeRankedAsync(
                resource, view, RankedOutcomes.Void, displayName, ct);
            return new DrillEvaluation(goals, resource);
        }
        if (annotations?.ContainsKey(DrillFailedAnnotation) == true)
        {
            await TryFinalizeRankedAsync(
                resource, view, RankedOutcomes.Failed, displayName, ct);
            return new DrillEvaluation(goals, resource);
        }

        var delayed = stage.DelayedSetup;
        var delayedKey = $"{DelayedStageAppliedAnnotationPrefix}{stageIndex}";
        if (delayed is { Count: > 0 } &&
            annotations?.ContainsKey(delayedKey) != true)
        {
            var pending = new DrillGoalState(
                "Incident activation",
                $"after {stage.ActivationDelaySeconds}s",
                view.DrillStageElapsedSeconds < stage.ActivationDelaySeconds
                    ? "developing"
                    : "applying",
                false);
            if (view.DrillStageElapsedSeconds < stage.ActivationDelaySeconds)
                return new DrillEvaluation([.. goals, pending], resource);

            var activated = await ApplyDelayedStageSetupAsync(
                view.RunId,
                stageIndex,
                delayedKey,
                delayed,
                ct);
            return new DrillEvaluation([.. goals, pending], activated ?? resource);
        }
        var heldSince = annotations?.GetValueOrDefault(DrillGoalsMetSinceAnnotation);
        var now = DateTime.UtcNow;

        if (!goals.All(g => g.Met))
        {
            // Lost it. Whatever streak was building does not count.
            if (!string.IsNullOrEmpty(heldSince))
                resource = await SetAnnotationsAsync(
                    view.RunId, new() { [DrillGoalsMetSinceAnnotation] = null }, ct) ?? resource;
            return new DrillEvaluation(goals, resource);
        }

        if (string.IsNullOrEmpty(heldSince))
        {
            resource = await SetAnnotationsAsync(
                view.RunId,
                new() { [DrillGoalsMetSinceAnnotation] = now.ToString("O") },
                ct) ?? resource;
            return new DrillEvaluation(goals, resource);
        }

        if (!DateTime.TryParse(
                heldSince, null,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                out var since) ||
            now - since < TimeSpan.FromSeconds(stage.HoldSeconds))
            return new DrillEvaluation(goals, resource);

        // The stage is genuinely resolved. The moment that counts is when the objective was FIRST
        // met, not when the hold finished confirming it — the hold is evidence that the recovery was
        // real, and charging the operator fifteen seconds for the platform's own caution would make
        // every recorded time fifteen seconds slower than the work took.
        //
        // The updated resource is handed back so the caller renders the transition in the SAME frame
        // it happened. Returning the pre-patch one would show a stage whose every condition is met
        // and which has not moved on — for a solve, that is the finished drill still reading as
        // unfinished for another poll.
        if (stageIndex + 1 < drill.Stages.Count)
        {
            resource = await AdvanceStageAsync(view, drill, stageIndex + 1, since, ct) ?? resource;
            // The next stage has its own objective, and nothing has been measured against it yet.
            var next = drill.Stages[Math.Min(stageIndex + 1, drill.Stages.Count - 1)];
            goals = ScenarioDefinitions.Evaluate(next, telemetry, resource.Spec);
        }
        else
        {
            resource = await ResolveDrillAsync(resource, view, drill, since, displayName, ct)
                ?? resource;
        }

        return new DrillEvaluation(goals, resource);
    }

    private async Task<LabRunResource?> ApplyDelayedStageSetupAsync(
        string runId,
        int stageIndex,
        string annotationKey,
        IReadOnlyDictionary<string, object> setup,
        CancellationToken ct)
    {
        try
        {
            var applied = new Dictionary<string, object>(setup, StringComparer.Ordinal);
            FreshenRestartToken(applied);
            var annotations = new Dictionary<string, string?>
            {
                [annotationKey] = DateTime.UtcNow.ToString("O"),
                [DrillGoalsMetSinceAnnotation] = null,
            };
            var patch = new k8s.Models.V1Patch(
                new { metadata = new { annotations }, spec = applied },
                k8s.Models.V1Patch.PatchType.MergePatch);
            var updated = await _k8s.CustomObjects.PatchClusterCustomObjectAsync(
                patch,
                LabRun.Group,
                LabRun.Version,
                LabRun.Plural,
                runId,
                cancellationToken: ct);
            await WriteThroughSpecAsync(runId, applied, ct);
            return Parse(updated);
        }
        catch (HttpOperationException ex)
        {
            _log.LogError(
                ex,
                "Could not activate delayed ranked fault for {RunId} stage {Stage}.",
                runId,
                stageIndex + 1);
            return null;
        }
    }

    // Open the next stage: record where the cascade has got to, and apply the consequence. This is
    // what makes a multi-stage drill worth doing — the incident the operator is about to see is one
    // their own fix caused, applied to the same live workload they just repaired.
    private async Task<LabRunResource?> AdvanceStageAsync(
        RunView view, ScenarioDefinition drill, int nextIndex, DateTime solvedAt, CancellationToken ct)
    {
        var next = drill.Stages[nextIndex];
        var setup = new Dictionary<string, object>(next.Setup, StringComparer.Ordinal);
        // A stage can ask for a rollout as part of its problem; the token has to be new every time
        // or the Deployment sees no change and nothing restarts.
        FreshenRestartToken(setup);

        var annotations = new Dictionary<string, string?>
        {
            [DrillStageAnnotation] = nextIndex.ToString(CultureInfo.InvariantCulture),
            [DrillStageStartedAnnotation] = solvedAt.ToString("O"),
            [$"homeops.isaacwallace.dev/drill-stage-{nextIndex - 1}-solved"] = solvedAt.ToString("O"),
            // The next stage has its own objective, so the streak that resolved the last one is not
            // evidence about this one.
            [DrillGoalsMetSinceAnnotation] = null,
        };

        try
        {
            var patch = new k8s.Models.V1Patch(
                new { metadata = new { annotations }, spec = setup },
                k8s.Models.V1Patch.PatchType.MergePatch);
            var updated = await _k8s.CustomObjects.PatchClusterCustomObjectAsync(
                patch, LabRun.Group, LabRun.Version, LabRun.Plural, view.RunId, cancellationToken: ct);
            await WriteThroughSpecAsync(view.RunId, setup, ct);
            return Parse(updated);
        }
        catch (HttpOperationException ex)
        {
            _log.LogError(ex, "Could not advance {RunId} to stage {Stage}.", view.RunId, nextIndex);
            return null;
        }
    }

    // The last stage is done, so the drill is done. Stamp the solve time on the cluster and write the
    // result — every solve, practice and ranked, because an average solve time is only meaningful if
    // it is an average over everyone's attempts rather than over the ones someone chose to count.
    private async Task<LabRunResource?> ResolveDrillAsync(
        LabRunResource resource,
        RunView view,
        ScenarioDefinition drill,
        DateTime solvedAt,
        string displayName,
        CancellationToken ct)
    {
        var updated = await SetAnnotationsAsync(
            view.RunId,
            new()
            {
                [DrillSolvedAnnotation] = solvedAt.ToString("O"),
                [DrillGoalsMetSinceAnnotation] = null,
                [DrillRecordedAnnotation] = "1",
            },
            ct);

        var startedAt = ParseAnnotationTime(resource.Spec.DrillStartedAt)
            ?? resource.Metadata.CreationTimestamp
            ?? solvedAt;
        var elapsedMs = (long)Math.Max(0, (solvedAt - startedAt).TotalMilliseconds);
        var mode = resource.Metadata.Annotations?.GetValueOrDefault(DrillModeAnnotation) == "ranked"
            ? "ranked"
            : "practice";

        await _results.RecordAsync(new DrillResult
        {
            RunId = view.RunId,
            DrillId = drill.Id,
            Mode = mode,
            OwnerKey = view.Owner,
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? "operator" : displayName.Trim(),
            StageCount = drill.Stages.Count,
            ElapsedMs = elapsedMs,
            Missteps = view.DrillWrongChosen,
            CorrectChosen = view.DrillCorrectChosenAll,
            CorrectTotal = view.DrillCorrectTotalAll,
            StartedUtc = startedAt,
            CompletedUtc = solvedAt,
        }, ct);

        await TryRecordAcademyAsync(updated ?? resource, RunView.From(updated ?? resource), displayName, ct);

        if (mode == "ranked")
        {
            try
            {
                await FinalizeRankedAsync(
                    updated ?? resource,
                    RunView.From(updated ?? resource),
                    RankedOutcomes.Completed,
                    displayName,
                    ct,
                    elapsedMs,
                    drill.Stages.Count);
            }
            catch (Exception ex)
            {
                // The solve itself is already durable on the LabRun. Snapshot evaluation retries
                // finalization, so a brief database outage cannot erase the operator's result.
                _log.LogError(ex, "Could not finalize ranked solve on {RunId}.", view.RunId);
            }
        }

        return updated;
    }

    private async Task TryRecordAcademyAsync(
        LabRunResource resource,
        RunView view,
        string displayName,
        CancellationToken ct)
    {
        var annotations = resource.Metadata.Annotations;
        var unitId = annotations?.GetValueOrDefault(LearningUnitAnnotation) ?? "";
        var courseId = annotations?.GetValueOrDefault(LearningCourseAnnotation) ?? "";
        var versionText = annotations?.GetValueOrDefault(LearningCourseVersionAnnotation) ?? "";
        if (unitId.Length == 0 ||
            !int.TryParse(versionText, CultureInfo.InvariantCulture, out var version))
            return;

        var course = CourseManifests.Find(courseId, version);
        if (course is null || !course.Contains(unitId)) return;

        var solvedAt = ParseAnnotationTime(
            annotations?.GetValueOrDefault(DrillSolvedAnnotation));
        if (solvedAt is null) return;
        var startedAt = ParseAnnotationTime(resource.Spec.DrillStartedAt) ?? solvedAt.Value;
        var elapsedMs = (long)Math.Max(0, (solvedAt.Value - startedAt).TotalMilliseconds);

        try
        {
            await _learning.CompleteClusterUnitAsync(
                view.Owner,
                course,
                unitId,
                new UnitCompletion(
                    UnitType: unitId.StartsWith("assessment:", StringComparison.Ordinal)
                        ? "assessment"
                        : "drill",
                    Score: null,
                    ElapsedMs: elapsedMs,
                    Clean: view.DrillWrongChosen == 0,
                    Mastered: false,
                    RunId: view.RunId,
                    Presentation: unitId.StartsWith("assessment:", StringComparison.Ordinal)
                        ? "assessment"
                        : "guided",
                    Missteps: view.DrillWrongChosen),
                ct);
        }
        catch (Exception ex)
        {
            // The solve remains stamped on the LabRun. Every later snapshot retries this write.
            _log.LogError(
                ex,
                "Could not record Academy unit {UnitId} for {RunId} ({DisplayName}).",
                unitId,
                view.RunId,
                displayName);
        }
    }

    private async Task TryFinalizeRankedAsync(
        LabRunResource resource,
        RunView view,
        string outcome,
        string displayName,
        CancellationToken ct)
    {
        if (view.DrillMode != "ranked") return;
        try
        {
            await FinalizeRankedAsync(resource, view, outcome, displayName, ct);
        }
        catch (Exception ex)
        {
            // Terminal state stays on the cluster and is observed again on the next snapshot.
            _log.LogError(
                ex,
                "Could not finalize ranked attempt on {RunId} as {Outcome}.",
                view.RunId,
                outcome);
        }
    }

    private async Task TryPersistRankedActionsAsync(
        LabRunResource resource,
        RunView view,
        CancellationToken ct)
    {
        try
        {
            await PersistRankedActionsAsync(resource, view, ct);
        }
        catch (Exception ex)
        {
            // Annotations remain on the live match, so the next measured snapshot retries the copy.
            _log.LogError(ex, "Could not synchronize ranked actions for {RunId}.", view.RunId);
        }
    }

    private async Task TryRecordRankedTelemetryAsync(
        LabRunResource resource,
        RunView view,
        RunTelemetry telemetry,
        DrillStage stage,
        IReadOnlyList<DrillGoalState> goals,
        CancellationToken ct)
    {
        if (view.DrillMode != "ranked") return;
        var attemptId = resource.Metadata.Annotations?
            .GetValueOrDefault(RankedAttemptIdAnnotation) ?? "";
        if (attemptId.Length == 0) return;

        var evaluated = stage.Goals.Zip(goals).ToArray();
        var slo = evaluated
            .Where(pair => pair.First.Metric is "throughput" or "p95" or "errors")
            .ToArray();
        try
        {
            var recorded = await _ranked.RecordTelemetryAsync(
                new RankedTelemetryObservation(
                    attemptId,
                    view.RunId,
                    view.Owner,
                    DateTime.UtcNow,
                    view.DrillStage,
                    view.OfferedRequestsPerSec,
                    telemetry.RequestsPerSec,
                    telemetry.P95LatencyMs,
                    telemetry.ErrorRatePct,
                    evaluated.Count(pair => pair.Second.Met),
                    evaluated.Length,
                    slo.Count(pair => pair.Second.Met),
                    slo.Length,
                    view.DrillHeldSeconds),
                ct);
            if (!recorded)
                throw new InvalidOperationException(
                    $"Ranked telemetry could not be attached to attempt '{attemptId}'.");
        }
        catch (Exception ex)
        {
            // A completed match is not rated without at least one durable sample. The solve stays on
            // the LabRun, so the next snapshot can retry both this bucket and finalization.
            _log.LogError(ex, "Could not record ranked telemetry for {RunId}.", view.RunId);
        }
    }

    private async Task PersistRankedActionsAsync(
        LabRunResource resource,
        RunView view,
        CancellationToken ct)
    {
        if (view.DrillMode != "ranked" || view.RankedActions.Count == 0) return;
        var attemptId = resource.Metadata.Annotations?
            .GetValueOrDefault(RankedAttemptIdAnnotation) ?? "";
        if (attemptId.Length == 0) return;

        foreach (var action in view.RankedActions)
        {
            var recorded = await _ranked.RecordActionAsync(
                action.Id,
                attemptId,
                view.RunId,
                view.Owner,
                action.Command,
                action.ActionId,
                action.Stage,
                action.AcceptedUtc,
                ct);
            if (!recorded)
                throw new InvalidOperationException(
                    $"Ranked action '{action.Id}' could not be attached to its attempt.");
        }
    }

    private async Task<RankedAttemptView?> FinalizeRankedAsync(
        LabRunResource resource,
        RunView view,
        string outcome,
        string displayName,
        CancellationToken ct,
        long? elapsedMs = null,
        int? stageReached = null)
    {
        if (view.DrillMode != "ranked") return null;

        // Rating must explain every mutation the cluster accepted. If the durable action copy is
        // unavailable, keep the attempt active and retry from the LabRun annotations next poll.
        await PersistRankedActionsAsync(resource, view, ct);

        var attemptId = resource.Metadata.Annotations?
            .GetValueOrDefault(RankedAttemptIdAnnotation);
        if (string.IsNullOrWhiteSpace(attemptId))
        {
            var active = await _ranked.ActiveForRunAsync(view.RunId, view.Owner, ct);
            attemptId = active?.Id;
        }
        if (string.IsNullOrWhiteSpace(attemptId)) return null;

        return await _ranked.FinalizeAsync(
            attemptId,
            view.Owner,
            outcome,
            elapsedMs ?? view.DrillElapsedMs,
            stageReached ?? view.DrillStage,
            view.DrillFailedMove,
            displayName,
            ct);
    }

    private static string TerminalOutcome(RunView view, string interruptedOutcome) =>
        view.DrillSolved
            ? RankedOutcomes.Completed
            : view.DrillFailedMove == InfrastructureVoidMove
                ? RankedOutcomes.Void
            : view.DrillFailed
                ? RankedOutcomes.Failed
                : interruptedOutcome;

    private static DateTime? ParseAnnotationTime(string? value) =>
        !string.IsNullOrEmpty(value) &&
        DateTime.TryParse(
            value, null,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;

    private static void FreshenRestartToken(IDictionary<string, object> setup)
    {
        if (setup.TryGetValue("restartToken", out var token) &&
            token as string == ScenarioDefinitions.FreshRestartToken)
            setup["restartToken"] =
                Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(6));
    }

    private static int SetupInt(
        IReadOnlyDictionary<string, object> setup, string key, int fallback) =>
        setup.TryGetValue(key, out var value) && value is int number ? number : fallback;

    private static string SetupString(
        IReadOnlyDictionary<string, object> setup, string key, string fallback) =>
        setup.TryGetValue(key, out var value) && value is string text ? text : fallback;

    // Best effort by design: the next poll evaluates again, so failing to record progress now costs
    // nothing but a little time. Returns the updated resource so a caller can render the change in
    // the same frame, or null if the patch did not land.
    private async Task<LabRunResource?> SetAnnotationsAsync(
        string runId, Dictionary<string, string?> annotations, CancellationToken ct)
    {
        var patch = new k8s.Models.V1Patch(
            new { metadata = new { annotations } },
            k8s.Models.V1Patch.PatchType.MergePatch);
        try
        {
            var updated = await _k8s.CustomObjects.PatchClusterCustomObjectAsync(
                patch, LabRun.Group, LabRun.Version, LabRun.Plural, runId, cancellationToken: ct);
            return Parse(updated);
        }
        catch (HttpOperationException ex)
        {
            _log.LogDebug(ex, "Could not update drill annotations on {RunId}.", runId);
            return null;
        }
    }

    // One extension, on request, before the cluster expires.
    //
    // A cluster is deliberately short-lived, but having it vanish mid-drill is worse than the cost of
    // keeping it. The owner may buy one more window and only one: after that the run is guaranteed to
    // end, so a forgotten tab cannot hold a slot indefinitely. The cap is enforced here rather than in
    // the page, since the page is not something the platform gets to trust.
    public const int RenewalSeconds = 900;
    public const string RenewedAnnotation = "homeops.isaacwallace.dev/renewed-at";

    public async Task<BrokerResult> RenewRunAsync(string runId, string owner, CancellationToken ct)
    {
        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        if (resource is null)
            return BrokerResult.Fail(404, "No such cluster.");
        if (resource.Metadata.Annotations?.ContainsKey(RenewedAnnotation) == true)
            return BrokerResult.Fail(409, "This cluster has already been extended once.");

        var ttl = resource.Spec.TtlSeconds > 0 ? resource.Spec.TtlSeconds : 900;
        var patchBody = new
        {
            metadata = new
            {
                annotations = new Dictionary<string, string>
                {
                    [RenewedAnnotation] = DateTime.UtcNow.ToString("O"),
                },
            },
            spec = new { ttlSeconds = ttl + RenewalSeconds },
        };
        return await PatchRunAsync(runId, patchBody, "renew cluster", ct);
    }

    /// <summary>
    /// Seal an attempt a ranked launch opened but never activated.
    ///
    /// Between opening the attempt and stamping the clock there is a row with no match behind it.
    /// If the cluster is torn down in that window the row would otherwise stay active forever and
    /// block the operator's next launch. Void is terminal and unrated, so cleaning it up cannot
    /// move anybody's rating — which is the point: nothing that happened before activation may.
    /// </summary>
    private async Task VoidUnactivatedLaunchAttemptAsync(
        LabRunResource resource, string displayName, CancellationToken ct)
    {
        var view = RunView.From(resource);
        if (view.DrillMode == "ranked") return;
        var attemptId = resource.Metadata.Annotations?
            .GetValueOrDefault(RankedLaunchOrchestrator.LaunchAttemptAnnotation);
        if (string.IsNullOrEmpty(attemptId)) return;

        try
        {
            await _ranked.FinalizeAsync(
                attemptId, view.Owner, RankedOutcomes.Void, 0, 0, "", displayName, ct);
        }
        catch (Exception ex)
        {
            _log.LogError(
                ex,
                "Could not void the unactivated ranked attempt on {RunId}.",
                view.RunId);
        }
    }

    // Owner-free teardown used by the TTL reaper (the platform, not a user, is acting).
    public async Task<bool> DeleteExpiredAsync(string runId, CancellationToken ct)
    {
        var resource = await GetResourceAsync(runId, ct);
        if (resource is null) return false;
        var view = RunView.From(resource);
        await VoidUnactivatedLaunchAttemptAsync(resource, "", ct);
        if (view.DrillMode == "ranked")
        {
            await PersistRankedActionsAsync(resource, view, ct);
            var frame = await GetFrameAsync(resource, ct);
            var infrastructureFailed = InfrastructureProblem(resource, frame) is not null;
            await FinalizeRankedAsync(
                resource,
                view,
                infrastructureFailed
                    ? RankedOutcomes.Void
                    : TerminalOutcome(view, RankedOutcomes.Expired),
                "",
                ct);
        }

        try
        {
            await _k8s.CustomObjects.DeleteClusterCustomObjectAsync(
                LabRun.Group, LabRun.Version, LabRun.Plural, runId, cancellationToken: ct);
            return true;
        }
        catch (HttpOperationException ex) when (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return false;
        }
    }

    public async Task<bool> DeleteRunAsync(
        string runId,
        string owner,
        string displayName,
        CancellationToken ct)
    {
        // Only the owner can tear a cluster down. The reaper uses DeleteExpiredAsync instead.
        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        if (resource is null) return false;
        var view = RunView.From(resource);
        await VoidUnactivatedLaunchAttemptAsync(resource, displayName, ct);
        if (view.DrillMode == "ranked")
        {
            await PersistRankedActionsAsync(resource, view, ct);
            await FinalizeRankedAsync(
                resource,
                view,
                TerminalOutcome(view, RankedOutcomes.Forfeited),
                displayName,
                ct);
        }

        try
        {
            await _k8s.CustomObjects.DeleteClusterCustomObjectAsync(
                LabRun.Group, LabRun.Version, LabRun.Plural, runId, cancellationToken: ct);
            return true;
        }
        catch (HttpOperationException ex) when (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return false;
        }
    }

    public async Task<IReadOnlyList<RunView>> ListAsync(CancellationToken ct) =>
        (await ListResourcesAsync(ct)).Select(RunView.From).ToList();

    private async Task<IReadOnlyList<LabRunResource>> ListResourcesAsync(CancellationToken ct)
    {
        var obj = await _k8s.CustomObjects.ListClusterCustomObjectAsync(
            LabRun.Group, LabRun.Version, LabRun.Plural, cancellationToken: ct);
        var list = KubernetesJson.Deserialize<LabRunList>(KubernetesJson.Serialize(obj));
        return list.Items;
    }

    // The custom-objects API returns loosely-typed JSON; round-trip it through the typed model.
    private static LabRunResource Parse(object raw)
        => KubernetesJson.Deserialize<LabRunResource>(KubernetesJson.Serialize(raw));

    private sealed class LabRunList
    {
        [JsonPropertyName("items")] public List<LabRunResource> Items { get; set; } = [];
    }

    // metrics.k8s.io PodMetrics shape (only the fields we sum).
    private sealed class PodMetricsList
    {
        [JsonPropertyName("items")] public List<PodMetrics> Items { get; set; } = [];
    }

    private sealed class PodMetrics
    {
        [JsonPropertyName("metadata")] public MetricMetadata Metadata { get; set; } = new();
        [JsonPropertyName("containers")] public List<ContainerMetrics> Containers { get; set; } = [];
    }

    private sealed class MetricMetadata
    {
        [JsonPropertyName("name")] public string Name { get; set; } = "";
    }

    private sealed class ContainerMetrics
    {
        [JsonPropertyName("usage")] public Usage Usage { get; set; } = new();
    }

    private sealed class Usage
    {
        [JsonPropertyName("cpu")] public string Cpu { get; set; } = "0";
        [JsonPropertyName("memory")] public string Memory { get; set; } = "0";
    }
}

/// <summary>A judged drill frame: the current stage's goals, and the run they were judged against —
/// which is the POST-transition run when the evaluation advanced a stage or resolved the drill.</summary>
public sealed record DrillEvaluation(
    IReadOnlyList<DrillGoalState> Goals,
    LabRunResource Resource);

/// <summary>One frame of a run: everything the live page renders, gathered from a single pass over
/// the namespace.</summary>
public sealed record RunFrame(
    RunTelemetry? Telemetry,
    IReadOnlyList<RunComponent> Components,
    IReadOnlyList<RunEventView> Events,
    RunTrace? Trace,
    /// <summary>Whether the run's Envoy gateways answered this frame's scrape.</summary>
    bool GatewayReporting = false);

public sealed record PlatformStatus(
    string Cluster,
    int NodesReady,
    int NodesTotal,
    int ActiveRuns,
    int MaxConcurrentRuns,
    int SlotsAvailable,
    int CapacityFreePct);

public sealed record ReportFinding(string Label, string Detail, string Severity);

public sealed record RunReport(
    bool Ready,
    string RunId,
    string ScenarioId,
    string Outcome,
    int Score,
    string Objective,
    string Summary,
    IReadOnlyList<AcceptedDecision> Decisions,
    IReadOnlyList<ReportFinding> Findings,
    DateTime SealedAt)
{
    public static RunReport NotReady(string runId, string scenarioId) =>
        new(false, runId, scenarioId, "pending", 0, "", "", [], [], DateTime.MinValue);
}

/// <summary>Provisioning as the launch needs it: the LabRun itself, or the broker's own refusal
/// status so an owner-key or capacity problem surfaces identically on both entry points.</summary>
public sealed record ClusterProvision(LabRunResource? Resource, int Status, string? Error)
{
    public static ClusterProvision Fail(int status, string error) => new(null, status, error);
}

public sealed record BrokerResult(RunView? Run, int Status, string? Error)
{
    public static BrokerResult Ok(RunView run) => new(run, 201, null);
    public static BrokerResult Accepted(RunView run) => new(run, 200, null);
    public static BrokerResult Fail(int status, string error) => new(null, status, error);
}

public sealed record RankedInspectionBrokerResult(
    RankedInspectionResult? Inspection,
    int Status,
    string? Error)
{
    public static RankedInspectionBrokerResult Accepted(RankedInspectionResult inspection) =>
        new(inspection, 200, null);

    public static RankedInspectionBrokerResult Fail(int status, string error) =>
        new(null, status, error);
}
