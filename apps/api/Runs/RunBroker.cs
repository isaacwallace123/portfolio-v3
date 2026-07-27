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

    public async Task<BrokerResult> CreateRunAsync(string scenarioId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(scenarioId))
            return BrokerResult.Fail(400, "scenarioId is required.");
        if (!_options.Scenarios.Contains(scenarioId) ||
            !ScenarioDefinitions.All.TryGetValue(scenarioId, out var scenario))
            return BrokerResult.Fail(404, $"Unknown scenario '{scenarioId}'.");

        var active = (await ListAsync(ct)).Count(r => r.Status is "provisioning" or "ready");
        if (active >= _options.MaxConcurrentRuns)
            return BrokerResult.Fail(429, "No run slots are free. Try again shortly.");

        var runId = $"run-hl-{Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(5))}";
        var body = new LabRunResource
        {
            Metadata = new LabRunMetadata { Name = runId },
            Spec = new LabRunSpec
            {
                ScenarioId = scenarioId,
                RunId = runId,
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

    public async Task<BrokerResult> SubmitDecisionAsync(string runId, string decisionId, CancellationToken ct)
    {
        var resource = await GetResourceAsync(runId, ct);
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
    public async Task<BrokerResult> StartDrillAsync(string runId, string drillId, CancellationToken ct)
    {
        var resource = await GetResourceAsync(runId, ct);
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
        return await PatchRunAsync(runId, patchBody, $"start drill {drillId}", ct);
    }

    // End the active drill and return the cluster to open-sandbox baseline.
    public async Task<BrokerResult> EndDrillAsync(string runId, CancellationToken ct)
    {
        var resource = await GetResourceAsync(runId, ct);
        if (resource is null)
            return BrokerResult.Fail(404, "No such run.");

        var annotations = new Dictionary<string, string?>();
        foreach (var key in resource.Metadata.Annotations?.Keys ?? Enumerable.Empty<string>())
            if (key.StartsWith("homeops.isaacwallace.dev/decision-", StringComparison.Ordinal))
                annotations[key] = null;

        var patchBody = new
        {
            metadata = new { annotations },
            spec = new
            {
                drillId = "",
                drillStartedAt = "",
                releaseTrack = "stable",
                dataState = "healthy",
            },
        };
        return await PatchRunAsync(runId, patchBody, "end drill", ct);
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

    // Real Kubernetes Events from the run's namespace, sanitized to a small public shape. This is the
    // arena's event stream: actual scheduling, image pull, probe, and scaling activity.
    public async Task<IReadOnlyList<RunEventView>?> GetEventsAsync(string runId, CancellationToken ct)
    {
        var view = await GetRunAsync(runId, ct);
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

    public async Task<RunView?> GetRunAsync(string runId, CancellationToken ct)
    {
        var resource = await GetResourceAsync(runId, ct);
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
        string runId, string actionId, CancellationToken ct)
    {
        var resource = await GetResourceAsync(runId, ct);
        if (resource is null)
            return BrokerResult.Fail(404, "No such practice cluster.");
        if (resource.Spec.ScenarioId != "practice-cluster")
            return BrokerResult.Fail(409, "This run is not a practice cluster.");

        IReadOnlyDictionary<string, object> spec = actionId switch
        {
            "scale-1" => Patch(("apiReplicas", 1)),
            "scale-3" => Patch(("apiReplicas", 3)),
            "scale-6" => Patch(("apiReplicas", 6)),
            "cache-on" => Patch(("cacheReplicas", 1)),
            "cache-off" => Patch(("cacheReplicas", 0)),
            "release-candidate" => Patch(("releaseTrack", "candidate")),
            "release-stable" => Patch(("releaseTrack", "stable")),
            "move-apps" => Patch(("targetPool", "apps")),
            "move-infra" => Patch(("targetPool", "infra")),
            "traffic-on" => Patch(("loadReplicas", 1)),
            "traffic-off" => Patch(("loadReplicas", 0)),
            "restart" => Patch(("restartToken", Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(6)))),
            "reset" => Patch(
                ("apiReplicas", 2), ("cacheReplicas", 0), ("releaseTrack", "stable"),
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
            return BrokerResult.Accepted(RunView.From(Parse(updated)));
        }
        catch (HttpOperationException ex)
        {
            _log.LogError(ex, "Failed practice action {Action} on {RunId}.", actionId, runId);
            return BrokerResult.Fail(502, "The practice controller rejected the action.");
        }
    }

    private static IReadOnlyDictionary<string, object> Patch(
        params (string Key, object Value)[] fields) =>
        fields.ToDictionary(x => x.Key, x => x.Value, StringComparer.Ordinal);

    public async Task<RunTrace?> GetTraceAsync(string runId, CancellationToken ct)
    {
        var run = await GetRunAsync(runId, ct);
        if (run?.Namespace is null) return null;
        return await _traces.ScrapeAsync(runId, run.Namespace, ct);
    }

    public async Task<RunReport?> GetReportAsync(string runId, CancellationToken ct)
    {
        var run = await GetRunAsync(runId, ct);
        if (run is null || run.CreatedAt is null) return null;
        if (!ScenarioDefinitions.All.TryGetValue(run.ScenarioId, out var scenario)) return null;

        var elapsed = (DateTime.UtcNow - run.CreatedAt.Value).TotalSeconds - 16;
        if (elapsed < scenario.DurationSeconds) return RunReport.NotReady(runId, run.ScenarioId);

        var telemetry = await GetTelemetryAsync(runId, ct);
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
    public async Task<RunTelemetry?> GetTelemetryAsync(string runId, CancellationToken ct)
    {
        var run = await GetRunAsync(runId, ct);
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

    public async Task<bool> DeleteRunAsync(string runId, CancellationToken ct)
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
