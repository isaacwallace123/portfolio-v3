using System.Globalization;
using System.Text.Json.Serialization;
using k8s;
using k8s.Autorest;

namespace IsaacWallace.Api.Runs;

// Public, deliberately sanitized inventory of the homelab. Resource identities are selected here;
// callers can never choose a namespace, selector, object name, or metric query.
public sealed class PlatformInventory
{
    private readonly IKubernetes _k8s;
    private readonly RunBrokerOptions _options;

    public PlatformInventory(IKubernetes k8s, Microsoft.Extensions.Options.IOptions<RunBrokerOptions> options)
    {
        _k8s = k8s;
        _options = options.Value;
    }

    public async Task<PlatformOverview> GetOverviewAsync(int activeRuns, CancellationToken ct)
    {
        var snapshot = await ReadSnapshotAsync(ct);
        var ready = snapshot.Nodes.Count(n => n.Ready);
        var desired = snapshot.Workloads.Sum(w => w.Desired);
        var available = snapshot.Workloads.Sum(w => w.Ready);
        var synced = snapshot.GitOps.Values.Count(a => a.Sync == "Synced" && a.Health == "Healthy");
        var slots = Math.Max(0, _options.MaxConcurrentRuns - activeRuns);

        return new PlatformOverview(
            ready == snapshot.Nodes.Count && available == desired ? "ready" : ready > 0 ? "degraded" : "offline",
            ready,
            snapshot.Nodes.Count,
            available,
            desired,
            snapshot.TotalPods,
            Percent(snapshot.Nodes.Sum(n => n.CpuUsed), snapshot.Nodes.Sum(n => n.CpuCapacity)),
            Percent(snapshot.Nodes.Sum(n => n.MemoryUsed), snapshot.Nodes.Sum(n => n.MemoryCapacity)),
            synced,
            snapshot.GitOps.Count,
            activeRuns,
            _options.MaxConcurrentRuns,
            slots,
            snapshot.ObservedAt);
    }

    public async Task<HomelabTopology> GetTopologyAsync(CancellationToken ct)
    {
        var snapshot = await ReadSnapshotAsync(ct);
        var workloads = snapshot.Workloads.ToDictionary(w => $"{w.Namespace}/{w.Name}", StringComparer.Ordinal);
        var graph = new List<TopologyNode>();

        for (var i = 0; i < snapshot.Nodes.Count; i++)
        {
            var node = snapshot.Nodes[i];
            var identity = node.Role switch
            {
                "control" => ("compute-control", "Control plane"),
                "apps" => ("compute-apps", "Application worker"),
                "infra" => ("compute-infra", "Infrastructure worker"),
                _ => ($"compute-{i + 1}", $"Compute node {i + 1}"),
            };
            graph.Add(new TopologyNode(
                identity.Item1,
                identity.Item2,
                "compute",
                "K3s node",
                node.Ready ? "healthy" : "degraded",
                node.Ready ? 1 : 0,
                1,
                (int)Math.Round(node.CpuUsed),
                (int)Math.Round(node.MemoryUsed),
                Percent(node.CpuUsed, node.CpuCapacity),
                Percent(node.MemoryUsed, node.MemoryCapacity),
                "Sanitized node identity. Names, addresses, labels, and hardware identifiers are not public.",
                node.ObservedAt));
        }

        foreach (var item in Catalog)
        {
            workloads.TryGetValue($"{item.Namespace}/{item.Resource}", out var live);
            snapshot.GitOps.TryGetValue(item.GitOpsApp, out var app);
            var status = live is null
                ? "unavailable"
                : live.Ready >= live.Desired && live.Desired > 0 &&
                  (app is null || app.Sync == "Synced" && app.Health == "Healthy")
                    ? "healthy"
                    : "degraded";
            graph.Add(new TopologyNode(
                item.Id,
                item.Label,
                item.Layer,
                item.Kind,
                status,
                live?.Ready ?? 0,
                live?.Desired ?? 0,
                live?.CpuMillicores ?? 0,
                live?.MemoryMiB ?? 0,
                null,
                null,
                item.Description,
                snapshot.ObservedAt,
                app?.Sync,
                app?.Health));
        }

        return new HomelabTopology(
            snapshot.ObservedAt,
            "Live Kubernetes API + metrics-server; relationships are the sanitized GitOps architecture.",
            graph,
            Edges);
    }

    private async Task<InventorySnapshot> ReadSnapshotAsync(CancellationToken ct)
    {
        var nodesTask = _k8s.CoreV1.ListNodeAsync(cancellationToken: ct);
        var deploymentsTask = _k8s.AppsV1.ListDeploymentForAllNamespacesAsync(cancellationToken: ct);
        var statefulSetsTask = _k8s.AppsV1.ListStatefulSetForAllNamespacesAsync(cancellationToken: ct);
        var daemonSetsTask = _k8s.AppsV1.ListDaemonSetForAllNamespacesAsync(cancellationToken: ct);
        var podMetricsTask = SafeCustomAsync(
            () => _k8s.CustomObjects.ListClusterCustomObjectAsync(
                "metrics.k8s.io", "v1beta1", "pods", cancellationToken: ct));
        var nodeMetricsTask = SafeCustomAsync(
            () => _k8s.CustomObjects.ListClusterCustomObjectAsync(
                "metrics.k8s.io", "v1beta1", "nodes", cancellationToken: ct));
        var gitOpsTask = SafeCustomAsync(
            () => _k8s.CustomObjects.ListNamespacedCustomObjectAsync(
                "argoproj.io", "v1alpha1", "argocd", "applications", cancellationToken: ct));

        await Task.WhenAll(
            nodesTask, deploymentsTask, statefulSetsTask, daemonSetsTask,
            podMetricsTask, nodeMetricsTask, gitOpsTask);

        var observedAt = DateTime.UtcNow;
        var nodeMetrics = Deserialize<NodeMetricsList>(nodeMetricsTask.Result)
            .Items.ToDictionary(x => x.Metadata.Name, StringComparer.Ordinal);
        var nodes = nodesTask.Result.Items.Select(node =>
        {
            nodeMetrics.TryGetValue(node.Metadata.Name, out var metric);
            var labels = node.Metadata.Labels ?? new Dictionary<string, string>();
            var role = labels.ContainsKey("node-role.kubernetes.io/control-plane")
                ? "control"
                : labels.ContainsKey("node-role.kubernetes.io/apps")
                    ? "apps"
                    : labels.ContainsKey("node-role.kubernetes.io/infra")
                        ? "infra"
                        : "compute";
            return new NodeFact(
                role,
                node.Status?.Conditions?.Any(c => c.Type == "Ready" && c.Status == "True") == true,
                ParseCpuMillicores(metric?.Usage.Cpu ?? "0"),
                ParseCpuCapacity(Quantity(node.Status?.Allocatable, "cpu")),
                ParseMemoryMiB(metric?.Usage.Memory ?? "0"),
                ParseMemoryMiB(Quantity(node.Status?.Allocatable, "memory")),
                metric?.Timestamp ?? observedAt);
        }).ToArray();

        var podMetrics = Deserialize<PodMetricsList>(podMetricsTask.Result).Items;
        var workloads = new List<WorkloadFact>();
        workloads.AddRange(deploymentsTask.Result.Items.Select(d => Workload(
            d.Metadata.NamespaceProperty, d.Metadata.Name,
            d.Status?.ReadyReplicas ?? 0, d.Spec?.Replicas ?? 0, podMetrics)));
        workloads.AddRange(statefulSetsTask.Result.Items.Select(s => Workload(
            s.Metadata.NamespaceProperty, s.Metadata.Name,
            s.Status?.ReadyReplicas ?? 0, s.Spec?.Replicas ?? 0, podMetrics)));
        workloads.AddRange(daemonSetsTask.Result.Items.Select(d => Workload(
            d.Metadata.NamespaceProperty, d.Metadata.Name,
            d.Status?.NumberReady ?? 0, d.Status?.DesiredNumberScheduled ?? 0, podMetrics)));

        var gitOps = Deserialize<GitOpsApplicationList>(gitOpsTask.Result).Items
            .ToDictionary(
                a => a.Metadata.Name,
                a => new GitOpsFact(a.Status.Sync.Status, a.Status.Health.Status),
                StringComparer.Ordinal);

        return new InventorySnapshot(
            observedAt, nodes, workloads, podMetrics.Count, gitOps);
    }

    private static WorkloadFact Workload(
        string ns, string name, int ready, int desired, IReadOnlyList<PodMetric> metrics)
    {
        var owned = metrics.Where(p =>
            p.Metadata.Namespace == ns &&
            (p.Metadata.Name == name || p.Metadata.Name.StartsWith($"{name}-", StringComparison.Ordinal)));
        double cpu = 0, memory = 0;
        foreach (var pod in owned)
            foreach (var container in pod.Containers)
            {
                cpu += ParseCpuMillicores(container.Usage.Cpu);
                memory += ParseMemoryMiB(container.Usage.Memory);
            }
        return new WorkloadFact(ns, name, ready, desired, (int)Math.Round(cpu), (int)Math.Round(memory));
    }

    private static async Task<object?> SafeCustomAsync(Func<Task<object>> call)
    {
        try { return await call(); }
        catch (HttpOperationException) { return null; }
    }

    private static T Deserialize<T>(object? raw) where T : new() =>
        raw is null
            ? new T()
            : KubernetesJson.Deserialize<T>(KubernetesJson.Serialize(raw));

    private static int Percent(double used, double capacity) =>
        capacity <= 0 ? 0 : Math.Clamp((int)Math.Round(used * 100 / capacity), 0, 100);

    private static string Quantity(
        IDictionary<string, k8s.Models.ResourceQuantity>? values, string key) =>
        values is not null && values.TryGetValue(key, out var value) ? value.ToString() : "0";

    internal static double ParseCpuMillicores(string q)
    {
        q = q.Trim();
        if (q.EndsWith('n')) return Number(q, 1) / 1_000_000.0;
        if (q.EndsWith('u')) return Number(q, 1) / 1_000.0;
        if (q.EndsWith('m')) return Number(q, 1);
        return double.TryParse(q, NumberStyles.Float, CultureInfo.InvariantCulture, out var cores)
            ? cores * 1000.0 : 0;
    }

    private static double ParseCpuCapacity(string q) => ParseCpuMillicores(q);

    internal static double ParseMemoryMiB(string q)
    {
        q = q.Trim();
        if (q.EndsWith("Ki")) return Number(q, 2) / 1024.0;
        if (q.EndsWith("Mi")) return Number(q, 2);
        if (q.EndsWith("Gi")) return Number(q, 2) * 1024.0;
        return double.TryParse(q, NumberStyles.Float, CultureInfo.InvariantCulture, out var bytes)
            ? bytes / (1024.0 * 1024.0) : 0;
    }

    private static double Number(string q, int suffix) =>
        double.TryParse(q[..^suffix], NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            ? value : 0;

    private static readonly TopologyDefinition[] Catalog =
    [
        new("metallb", "MetalLB", "network", "load balancer", "networking", "metallb-controller", "metallb", "Advertises service addresses on the homelab network."),
        new("envoy", "Envoy Gateway", "network", "gateway", "envoy-gateway-system", "envoy-gateway", "envoy-gateway", "Routes HTTP traffic into public services."),
        new("cloudflare", "Cloudflare Tunnel", "network", "edge tunnel", "networking", "cloudflared", "cloudflared", "Carries public traffic to the internal gateway without publishing an origin address."),
        new("dns", "CoreDNS", "network", "cluster DNS", "kube-system", "coredns", "root", "Resolves service discovery inside Kubernetes."),
        new("certs", "cert-manager", "platform", "certificate controller", "cert-manager", "cert-manager", "cert-manager", "Reconciles public TLS certificates."),
        new("gitops", "Argo CD", "platform", "GitOps controller", "argocd", "argocd-server", "argocd", "Reconciles this repository into the live cluster."),
        new("crossplane", "Crossplane", "platform", "control plane", "crossplane-system", "crossplane", "crossplane", "Composes isolated practice and scenario workspaces."),
        new("secrets", "Sealed Secrets", "platform", "secret controller", "secrets", "sealed-secrets-controller", "sealed-secrets", "Decrypts Git-safe sealed values only inside the cluster."),
        new("nfd", "Node Feature Discovery", "platform", "hardware discovery", "node-feature-discovery", "nfd-node-feature-discovery-master", "nfd", "Publishes schedulable hardware capabilities to Kubernetes."),
        new("gpu", "Intel GPU plugin", "platform", "device plugin", "kube-system", "intel-gpu-plugin-gpudeviceplugin-sample", "intel-gpu-plugin", "Advertises the application worker's GPU as a schedulable resource."),
        new("storage", "Longhorn", "data", "distributed storage", "longhorn-system", "longhorn-manager", "longhorn", "Provides replicated persistent storage and snapshot operations."),
        new("portfolio-db", "Portfolio Postgres", "data", "database", "portfolio", "postgres", "portfolio", "Persists portfolio authentication and application data."),
        new("prometheus", "Prometheus", "observe", "metrics", "monitoring", "prometheus", "monitoring", "Scrapes and stores infrastructure and application metrics."),
        new("grafana", "Grafana", "observe", "visualization", "monitoring", "grafana", "monitoring", "Explores metrics, logs, and operational dashboards."),
        new("loki", "Loki", "observe", "logs", "monitoring", "loki", "monitoring", "Indexes cluster and application logs."),
        new("alertmanager", "Alertmanager", "observe", "alert routing", "monitoring", "alertmanager", "monitoring", "Groups and routes active platform alerts."),
        new("metrics-server", "metrics-server", "observe", "resource metrics", "kube-system", "metrics-server", "root", "Supplies current CPU and memory usage to Kubernetes and this site."),
        new("node-exporter", "Node exporter", "observe", "host metrics", "monitoring", "node-exporter", "monitoring", "Exports sanitized host and operating-system metrics to Prometheus."),
        new("cadvisor", "cAdvisor", "observe", "container metrics", "monitoring", "cadvisor", "monitoring", "Exports container resource metrics to Prometheus."),
        new("promtail", "Promtail", "observe", "log agent", "monitoring", "promtail", "monitoring", "Ships cluster logs into Loki."),
        new("portfolio-web", "Portfolio", "apps", "web application", "portfolio", "web", "portfolio", "Main portfolio interface."),
        new("portfolio-api", "Portfolio API", "apps", "application API", "portfolio", "api", "portfolio", "Hosts authenticated APIs and the HomeOps control plane."),
        new("auth", "Identity service", "apps", "authentication", "portfolio", "auth-service", "portfolio", "Provides portfolio sign-in, sessions, roles, and API-key authority."),
        new("homeops", "HomeOps", "apps", "web application", "portfolio", "homelab-web", "portfolio", "This live homelab experience."),
        new("ailab", "AIOps", "apps", "web application", "portfolio", "ailab-web", "portfolio", "AI and applied-intelligence portfolio surface."),
        new("cyberlab", "CyberLab", "apps", "web application", "cyberlab", "cyberlab-web", "root", "Interactive security portfolio surface."),
        new("homepage", "Internal dashboard", "apps", "operations dashboard", "networking", "homepage", "homepage", "Private operational launchpad for the homelab."),
        new("media", "Media automation", "apps", "application stack", "media", "media-stack", "media-stack", "Coordinates the private media automation services."),
        new("plex", "Plex", "apps", "media service", "media", "plex", "plex", "Serves the homelab media library."),
        new("ntfy", "ntfy", "apps", "notification service", "networking", "ntfy", "ntfy", "Delivers internal operational notifications."),
    ];

    private static readonly TopologyEdge[] Edges =
    [
        new("cloudflare", "envoy", "traffic"),
        new("metallb", "envoy", "service"),
        new("certs", "envoy", "tls"),
        new("dns", "envoy", "discovery"),
        new("envoy", "portfolio-web", "route"),
        new("envoy", "homeops", "route"),
        new("envoy", "cyberlab", "route"),
        new("envoy", "plex", "route"),
        new("envoy", "ntfy", "route"),
        new("gitops", "crossplane", "reconcile"),
        new("gitops", "envoy", "reconcile"),
        new("gitops", "storage", "reconcile"),
        new("gitops", "secrets", "reconcile"),
        new("gitops", "nfd", "reconcile"),
        new("nfd", "gpu", "discover"),
        new("gitops", "prometheus", "reconcile"),
        new("crossplane", "homeops", "provision"),
        new("portfolio-web", "portfolio-api", "api"),
        new("storage", "portfolio-api", "volume"),
        new("portfolio-db", "portfolio-api", "data"),
        new("auth", "portfolio-db", "data"),
        new("storage", "media", "volume"),
        new("storage", "plex", "volume"),
        new("prometheus", "grafana", "query"),
        new("loki", "grafana", "query"),
        new("node-exporter", "prometheus", "scrape"),
        new("cadvisor", "prometheus", "scrape"),
        new("metrics-server", "homeops", "metrics"),
        new("promtail", "loki", "ship"),
        new("alertmanager", "prometheus", "alerts"),
        new("envoy", "auth", "route"),
        new("envoy", "ailab", "route"),
        new("envoy", "homepage", "private route"),
        new("compute-control", "gitops", "hosts"),
        new("compute-apps", "portfolio-web", "hosts"),
        new("compute-apps", "media", "hosts"),
        new("compute-infra", "prometheus", "hosts"),
        new("compute-infra", "storage", "hosts"),
    ];

    private sealed record TopologyDefinition(
        string Id, string Label, string Layer, string Kind,
        string Namespace, string Resource, string GitOpsApp, string Description);
    private sealed record NodeFact(
        string Role, bool Ready, double CpuUsed, double CpuCapacity,
        double MemoryUsed, double MemoryCapacity, DateTime ObservedAt);
    private sealed record WorkloadFact(
        string Namespace, string Name, int Ready, int Desired, int CpuMillicores, int MemoryMiB);
    private sealed record GitOpsFact(string Sync, string Health);
    private sealed record InventorySnapshot(
        DateTime ObservedAt, IReadOnlyList<NodeFact> Nodes, IReadOnlyList<WorkloadFact> Workloads,
        int TotalPods, IReadOnlyDictionary<string, GitOpsFact> GitOps);

    private sealed class ObjectMeta
    {
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("namespace")] public string Namespace { get; set; } = "";
    }
    private sealed class Usage
    {
        [JsonPropertyName("cpu")] public string Cpu { get; set; } = "0";
        [JsonPropertyName("memory")] public string Memory { get; set; } = "0";
    }
    private sealed class ContainerMetric
    {
        [JsonPropertyName("usage")] public Usage Usage { get; set; } = new();
    }
    private sealed class PodMetric
    {
        [JsonPropertyName("metadata")] public ObjectMeta Metadata { get; set; } = new();
        [JsonPropertyName("containers")] public List<ContainerMetric> Containers { get; set; } = [];
    }
    private sealed class PodMetricsList
    {
        [JsonPropertyName("items")] public List<PodMetric> Items { get; set; } = [];
    }
    private sealed class NodeMetric
    {
        [JsonPropertyName("metadata")] public ObjectMeta Metadata { get; set; } = new();
        [JsonPropertyName("usage")] public Usage Usage { get; set; } = new();
        [JsonPropertyName("timestamp")] public DateTime Timestamp { get; set; }
    }
    private sealed class NodeMetricsList
    {
        [JsonPropertyName("items")] public List<NodeMetric> Items { get; set; } = [];
    }
    private sealed class GitOpsApplication
    {
        [JsonPropertyName("metadata")] public ObjectMeta Metadata { get; set; } = new();
        [JsonPropertyName("status")] public GitOpsStatus Status { get; set; } = new();
    }
    private sealed class GitOpsStatus
    {
        [JsonPropertyName("sync")] public State Sync { get; set; } = new();
        [JsonPropertyName("health")] public State Health { get; set; } = new();
    }
    private sealed class State
    {
        [JsonPropertyName("status")] public string Status { get; set; } = "Unknown";
    }
    private sealed class GitOpsApplicationList
    {
        [JsonPropertyName("items")] public List<GitOpsApplication> Items { get; set; } = [];
    }
}

public sealed record PlatformOverview(
    string Cluster,
    int NodesReady,
    int NodesTotal,
    int WorkloadsReady,
    int WorkloadsDesired,
    int RunningPods,
    int CpuUtilizationPct,
    int MemoryUtilizationPct,
    int GitOpsHealthy,
    int GitOpsTotal,
    int ActiveRuns,
    int MaxConcurrentRuns,
    int SlotsAvailable,
    DateTime ObservedAt);

public sealed record HomelabTopology(
    DateTime ObservedAt,
    string Source,
    IReadOnlyList<TopologyNode> Nodes,
    IReadOnlyList<TopologyEdge> Edges);

public sealed record TopologyNode(
    string Id,
    string Label,
    string Layer,
    string Kind,
    string Status,
    int Ready,
    int Desired,
    int CpuMillicores,
    int MemoryMiB,
    int? CpuUtilizationPct,
    int? MemoryUtilizationPct,
    string Description,
    DateTime ObservedAt,
    string? GitOpsSync = null,
    string? GitOpsHealth = null);

public sealed record TopologyEdge(string Source, string Target, string Kind);
