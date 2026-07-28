using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json.Serialization;
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
    private readonly ILogger<RunBroker> _log;

    public RunBroker(
        IKubernetes k8s,
        IOptions<RunBrokerOptions> options,
        EnvoyScraper envoy,
        TraceScraper traces,
        PlatformInventory inventory,
        ILogger<RunBroker> log)
    {
        _k8s = k8s;
        _options = options.Value;
        _envoy = envoy;
        _traces = traces;
        _inventory = inventory;
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
        if (string.IsNullOrWhiteSpace(scenarioId))
            return BrokerResult.Fail(400, "scenarioId is required.");
        // Provisioning is never anonymous: the caller must present a resolved owner key.
        if (!IsValidOwner(owner))
            return BrokerResult.Fail(401, "Sign in to provision a cluster.");
        if (!_options.Scenarios.Contains(scenarioId) ||
            !ScenarioDefinitions.All.TryGetValue(scenarioId, out var scenario))
            return BrokerResult.Fail(404, $"Unknown scenario '{scenarioId}'.");

        var all = await ListAsync(ct);
        var live = all.Where(r => r.Status is "provisioning" or "ready").ToArray();

        // One cluster per person. Returning the existing cluster (rather than an error) makes the
        // page idempotent: a reload or a second tab lands back on the cluster you already own.
        var mine = live.FirstOrDefault(r => r.Owner == owner);
        if (mine is not null)
            return BrokerResult.Accepted(mine);

        if (live.Length >= _options.MaxConcurrentRuns)
            return BrokerResult.Fail(429, "No cluster slots are free. Try again shortly.");

        var runId = $"run-hl-{Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(5))}";
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
                ApiReplicas = scenario.InitialApiReplicas,
                CacheReplicas = scenario.InitialCacheReplicas,
                ReleaseTrack = scenario.InitialReleaseTrack,
                DataState = scenario.InitialDataState,
                TargetPool = scenario.InitialTargetPool,
                LoadReplicas = scenarioId == "practice-cluster" ? 0 : 1,
                RestartToken = "baseline",
            },
        };

        try
        {
            var created = await _k8s.CustomObjects.CreateClusterCustomObjectAsync(
                body, LabRun.Group, LabRun.Version, LabRun.Plural, cancellationToken: ct);
            return BrokerResult.Ok(RunView.From(Parse(created)));
        }
        catch (HttpOperationException ex)
        {
            _log.LogError(ex, "Failed to create LabRun {RunId}.", runId);
            return BrokerResult.Fail(502, "The run controller rejected the request.");
        }
    }

    // Owner keys are opaque hex digests issued by the front end after verifying the SSO session.
    private static bool IsValidOwner(string? owner) =>
        !string.IsNullOrEmpty(owner) &&
        owner.Length is >= 16 and <= 64 &&
        owner.All(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));

    // Fetch a cluster only if the caller owns it. Mismatches return null so the API answers 404 for
    // "not yours" exactly as it does for "does not exist" — a caller cannot probe for other people's
    // clusters. Clusters created before ownership existed have an empty owner and are unclaimable.
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

    public async Task<BrokerResult> SubmitDecisionAsync(string runId, string decisionId, string owner, CancellationToken ct)
    {
        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        if (resource is null)
            return BrokerResult.Fail(404, "No such run.");

        // Decisions belong to the drill currently running on this cluster, and unlock on the drill's
        // own clock — RunView is the single source of truth for both.
        var view = RunView.From(resource);
        if (view.DrillId.Length == 0)
            return BrokerResult.Fail(409, "No drill is running on this cluster.");
        if (!ScenarioDefinitions.All.TryGetValue(view.DrillId, out var scenario))
            return BrokerResult.Fail(404, "The scenario definition is not available.");
        var decision = scenario.Decisions.FirstOrDefault(d => d.Id == decisionId);
        if (decision is null)
            return BrokerResult.Fail(404, $"Decision '{decisionId}' is not available for this run.");

        const string annotationPrefix = "homeops.isaacwallace.dev/decision-";
        if (resource.Metadata.Annotations?.ContainsKey($"{annotationPrefix}{decisionId}") == true)
            return BrokerResult.Accepted(view);

        var elapsed = view.DrillElapsedSeconds;
        if (elapsed < decision.AvailableAfterSeconds)
            return BrokerResult.Fail(
                409,
                $"Decision '{decisionId}' unlocks after {decision.AvailableAfterSeconds} seconds of live traffic.");

        var patchBody = new
        {
            metadata = new
            {
                annotations = new Dictionary<string, string>
                {
                    [$"{annotationPrefix}{decisionId}"] = DateTime.UtcNow.ToString("O"),
                },
            },
            spec = decision.SpecPatch,
        };
        var patch = new k8s.Models.V1Patch(patchBody, k8s.Models.V1Patch.PatchType.MergePatch);
        try
        {
            var updated = await _k8s.CustomObjects.PatchClusterCustomObjectAsync(
                patch, LabRun.Group, LabRun.Version, LabRun.Plural, runId, cancellationToken: ct);
            await WriteThroughReplicasAsync(runId, decision.SpecPatch, ct);
            return BrokerResult.Accepted(RunView.From(Parse(updated)));
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
    public async Task<BrokerResult> StartDrillAsync(string runId, string drillId, string owner, CancellationToken ct)
    {
        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        if (resource is null)
            return BrokerResult.Fail(404, "No such run.");
        if (!ScenarioDefinitions.IsDrill(drillId) ||
            !ScenarioDefinitions.All.TryGetValue(drillId, out var drill))
            return BrokerResult.Fail(404, $"Unknown drill '{drillId}'.");

        // Clear any decision annotations from a previous drill so its decisions unlock again.
        var annotations = new Dictionary<string, string?>
        {
            ["homeops.isaacwallace.dev/drill-started"] = DateTime.UtcNow.ToString("O"),
        };
        foreach (var key in resource.Metadata.Annotations?.Keys ?? Enumerable.Empty<string>())
            if (key.StartsWith("homeops.isaacwallace.dev/decision-", StringComparison.Ordinal))
                annotations[key] = null; // null removes the annotation in a merge patch

        var patchBody = new
        {
            metadata = new { annotations },
            spec = new
            {
                drillId,
                drillStartedAt = DateTime.UtcNow.ToString("O"),
                apiReplicas = drill.InitialApiReplicas,
                cacheReplicas = drill.InitialCacheReplicas,
                releaseTrack = drill.InitialReleaseTrack,
                dataState = drill.InitialDataState,
                targetPool = drill.InitialTargetPool,
                loadReplicas = 1, // a drill always needs live traffic to measure against
            },
        };
        var started = await PatchRunAsync(runId, patchBody, $"start drill {drillId}", ct);
        await WriteThroughReplicasAsync(runId, Patch(
            ("apiReplicas", drill.InitialApiReplicas),
            ("cacheReplicas", drill.InitialCacheReplicas),
            ("loadReplicas", 1)), ct);
        return started;
    }

    // End the active drill and return the cluster to open-sandbox baseline.
    public async Task<BrokerResult> EndDrillAsync(string runId, string owner, CancellationToken ct)
    {
        var resource = await GetOwnedResourceAsync(runId, owner, ct);
        if (resource is null)
            return BrokerResult.Fail(404, "No such run.");

        var annotations = new Dictionary<string, string?>();
        foreach (var key in resource.Metadata.Annotations?.Keys ?? Enumerable.Empty<string>())
            if (key.StartsWith("homeops.isaacwallace.dev/decision-", StringComparison.Ordinal))
                annotations[key] = null;

        var patchBody = new
        {
            metadata = new { annotations },
            // Returns the cluster to open-sandbox baseline. These three replica counts are repeated
            // in the write-through below and must stay identical to it, or Crossplane's next
            // reconcile would undo the fast path.
            spec = new
            {
                drillId = "",
                drillStartedAt = "",
                releaseTrack = "stable",
                dataState = "healthy",
                apiReplicas = 1,
                cacheReplicas = 0,
                loadReplicas = 0,
            },
        };
        var ended = await PatchRunAsync(runId, patchBody, "end drill", ct);
        await WriteThroughReplicasAsync(runId, Patch(
            ("apiReplicas", 1), ("cacheReplicas", 0), ("loadReplicas", 0)), ct);
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

        // Measured usage per pod (metrics-server); absent for pods that have not been sampled yet.
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

        List<RunComponent> components = [];
        try
        {
            var deployments = await _k8s.AppsV1.ListNamespacedDeploymentAsync(ns, cancellationToken: ct);
            var pods = await _k8s.CoreV1.ListNamespacedPodAsync(ns, cancellationToken: ct);

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
                        detail);
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
        catch (HttpOperationException ex)
        {
            _log.LogDebug(ex, "Components unavailable for {RunId}.", runId);
        }

        return components;
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
            var list = await _k8s.CoreV1.ListNamespacedEventAsync(ns, cancellationToken: ct);
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
        catch (HttpOperationException ex)
        {
            _log.LogDebug(ex, "Events unavailable for {RunId}.", runId);
            return [];
        }
    }

    // Events are cluster-internal text; keep them short and free of image digests / node identities.
    private static string Sanitize(string message)
    {
        var text = message.Length <= 160 ? message : message[..160] + "…";
        return text.Replace("\n", " ").Trim();
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
                ("apiReplicas", 1), ("cacheReplicas", 0), ("releaseTrack", "stable"),
                ("dataState", "healthy"), ("targetPool", "apps"), ("loadReplicas", 0),
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
            await WriteThroughReplicasAsync(runId, spec, ct);
            return BrokerResult.Accepted(RunView.From(Parse(updated)));
        }
        catch (HttpOperationException ex)
        {
            _log.LogError(ex, "Failed practice action {Action} on {RunId}.", actionId, runId);
            return BrokerResult.Fail(502, "The practice controller rejected the action.");
        }
    }

    // The composed Object that owns each scalable tier. Kept in one place so the write-through below
    // cannot drift from the naming the Composition uses.
    private static readonly (string SpecField, string ObjectSuffix)[] ReplicaTiers =
    [
        ("apiReplicas", "checkout"),
        ("cacheReplicas", "redis"),
        ("loadReplicas", "k6"),
    ];

    // Make a replica change visible now rather than a minute from now.
    //
    // Changing a LabRun's spec should reach the Deployment immediately, and on a settled run it does
    // (~200ms). But Crossplane v2 guards realtime composition with a circuit breaker, and the twenty
    // composed Objects in a run churn their own status often enough to hold that breaker open — so a
    // spec change waits out the breaker's cooldown, up to a minute, which is most of a practice
    // cluster's useful life. Measured on a fresh run: 55s through Crossplane, 228ms written through.
    //
    // So the broker writes the replica count it just stored on the LabRun straight to the composed
    // Object as well. This is not a second source of truth: the LabRun still holds the value, and
    // when Crossplane does reconcile it writes the identical number, so there is nothing to diverge
    // and the workload cannot flap back. Best effort by design — if it fails, the run is exactly as
    // correct as before, just slower to show it.
    private async Task WriteThroughReplicasAsync(
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
        if (elapsed < scenario.DurationSeconds) return RunReport.NotReady(runId, run.ScenarioId);

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

        int pods = 0;
        double cpuMillis = 0, memMiB = 0, postgresCpuMillis = 0;
        try
        {
            var obj = await _k8s.CustomObjects.ListNamespacedCustomObjectAsync(
                "metrics.k8s.io", "v1beta1", ns, "pods", cancellationToken: ct);
            var list = KubernetesJson.Deserialize<PodMetricsList>(KubernetesJson.Serialize(obj));
            pods = list.Items.Count;
            foreach (var pod in list.Items)
                foreach (var c in pod.Containers)
                {
                    var containerCpu = ParseCpuMillicores(c.Usage.Cpu);
                    cpuMillis += containerCpu;
                    memMiB += ParseMemoryMiB(c.Usage.Memory);
                    if (pod.Metadata.Name.StartsWith("postgres-", StringComparison.Ordinal) ||
                        pod.Metadata.Name == "postgres")
                        postgresCpuMillis += containerCpu;
                }
        }
        catch (HttpOperationException)
        {
            // Metrics not available yet for this namespace — report zero usage.
        }

        // Real request metrics from the run's Envoy gateway (null while the workload is starting).
        var envoy = await _envoy.ScrapeAsync(runId, ns, ct);

        return new RunTelemetry(
            pods, (int)Math.Round(cpuMillis), (int)Math.Round(memMiB),
            Math.Clamp((int)Math.Round(postgresCpuMillis / 5.0), 0, 100),
            run.ApiReplicas, run.CacheEnabled,
            envoy?.RequestsPerSec ?? 0,
            envoy?.P95LatencyMs ?? 0,
            envoy?.ErrorRatePct ?? 0);
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

    // Owner-free teardown used by the TTL reaper (the platform, not a user, is acting).
    public async Task<bool> DeleteExpiredAsync(string runId, CancellationToken ct)
    {
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

    public async Task<bool> DeleteRunAsync(string runId, string owner, CancellationToken ct)
    {
        // Only the owner can tear a cluster down. The reaper uses DeleteExpiredAsync instead.
        if (await GetOwnedResourceAsync(runId, owner, ct) is null) return false;
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

    public async Task<IReadOnlyList<RunView>> ListAsync(CancellationToken ct)
    {
        var obj = await _k8s.CustomObjects.ListClusterCustomObjectAsync(
            LabRun.Group, LabRun.Version, LabRun.Plural, cancellationToken: ct);
        var list = KubernetesJson.Deserialize<LabRunList>(KubernetesJson.Serialize(obj));
        return list.Items.Select(RunView.From).ToList();
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

public sealed record BrokerResult(RunView? Run, int Status, string? Error)
{
    public static BrokerResult Ok(RunView run) => new(run, 201, null);
    public static BrokerResult Accepted(RunView run) => new(run, 200, null);
    public static BrokerResult Fail(int status, string error) => new(null, status, error);
}
