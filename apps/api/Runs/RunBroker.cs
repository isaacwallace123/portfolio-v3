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
    private readonly ILogger<RunBroker> _log;

    public RunBroker(IKubernetes k8s, IOptions<RunBrokerOptions> options, ILogger<RunBroker> log)
    {
        _k8s = k8s;
        _options = options.Value;
        _log = log;
    }

    public IReadOnlyList<string> Scenarios => _options.Scenarios;

    public async Task<BrokerResult> CreateRunAsync(string scenarioId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(scenarioId))
            return BrokerResult.Fail(400, "scenarioId is required.");
        if (!_options.Scenarios.Contains(scenarioId))
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

    // Allowlisted operator decisions per scenario, each a merge-patch fragment on the LabRun spec.
    // The decisions are code-coupled to the Composition's spec fields, so they live here rather than
    // in loose config. A caller may only apply a decision this map defines for the run's scenario.
    private static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, object>> Decisions =
        new Dictionary<string, IReadOnlyDictionary<string, object>>
        {
            ["checkout-traffic-spike"] = new Dictionary<string, object>
            {
                ["scale"] = new { apiReplicas = 6 },
                ["cache"] = new { cacheReplicas = 1 },
            },
        };

    public async Task<BrokerResult> SubmitDecisionAsync(string runId, string decisionId, CancellationToken ct)
    {
        var run = await GetRunAsync(runId, ct);
        if (run is null)
            return BrokerResult.Fail(404, "No such run.");
        if (!Decisions.TryGetValue(run.ScenarioId, out var allowed) ||
            !allowed.TryGetValue(decisionId, out var specPatch))
            return BrokerResult.Fail(404, $"Decision '{decisionId}' is not available for this run.");

        var patch = new k8s.Models.V1Patch(new { spec = specPatch }, k8s.Models.V1Patch.PatchType.MergePatch);
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

    public async Task<RunView?> GetRunAsync(string runId, CancellationToken ct)
    {
        try
        {
            var obj = await _k8s.CustomObjects.GetClusterCustomObjectAsync(
                LabRun.Group, LabRun.Version, LabRun.Plural, runId, cancellationToken: ct);
            return RunView.From(Parse(obj));
        }
        catch (HttpOperationException ex) when (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
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
        double cpuMillis = 0, memMiB = 0;
        try
        {
            var obj = await _k8s.CustomObjects.ListNamespacedCustomObjectAsync(
                "metrics.k8s.io", "v1beta1", ns, "pods", cancellationToken: ct);
            var list = KubernetesJson.Deserialize<PodMetricsList>(KubernetesJson.Serialize(obj));
            pods = list.Items.Count;
            foreach (var pod in list.Items)
                foreach (var c in pod.Containers)
                {
                    cpuMillis += ParseCpuMillicores(c.Usage.Cpu);
                    memMiB += ParseMemoryMiB(c.Usage.Memory);
                }
        }
        catch (HttpOperationException)
        {
            // Metrics not available yet for this namespace — report zero usage.
        }

        return new RunTelemetry(
            pods, (int)Math.Round(cpuMillis), (int)Math.Round(memMiB),
            run.ApiReplicas, run.CacheEnabled);
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
        [JsonPropertyName("containers")] public List<ContainerMetrics> Containers { get; set; } = [];
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

public sealed record BrokerResult(RunView? Run, int Status, string? Error)
{
    public static BrokerResult Ok(RunView run) => new(run, 201, null);
    public static BrokerResult Accepted(RunView run) => new(run, 200, null);
    public static BrokerResult Fail(int status, string error) => new(null, status, error);
}
