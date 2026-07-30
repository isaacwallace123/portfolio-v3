using IsaacWallace.Api.Data;
using IsaacWallace.Api.Ranked;

namespace IsaacWallace.Api.Runs;

/// <summary>
/// Binds the ranked launch to the real platform: Crossplane LabRuns through the broker, and rated
/// attempts through the ranked store.
///
/// Everything here is translation. The launch's decisions — which phase an environment is in, when
/// an attempt may be opened, when the clock may start — live in the orchestrator, where they can be
/// proven without a cluster. This class only knows how to ask the cluster a question and how to
/// shape the answer, which is why it holds no state and makes no choices.
/// </summary>
public sealed class RankedLaunchEnvironment(
    RunBroker broker,
    RankedStore ranked,
    ILogger<RankedLaunchEnvironment> log) : IRankedLaunchEnvironment
{
    /// <summary>The scenario a ranked arena is provisioned as. A ranked cluster starts as the open
    /// sandbox and the drawn incident is layered onto it at activation, so the operator never sees
    /// which match they drew from the shape of the namespace that was built for it.</summary>
    public const string ArenaScenarioId = ScenarioDefinitions.SandboxId;

    public async Task<RankedLaunchCluster?> FindClusterAsync(string owner, CancellationToken ct)
    {
        var resource = await broker.FindLiveOwnedResourceAsync(owner, ct);
        return resource is null ? null : Cluster(resource);
    }

    public async Task<RankedLaunchCluster?> ReadClusterAsync(
        string runId, string owner, CancellationToken ct)
    {
        var resource = await broker.GetOwnedAsync(runId, owner, ct);
        return resource is null ? null : Cluster(resource);
    }

    public async Task<RankedLaunchProvision> ProvisionClusterAsync(
        string owner, CancellationToken ct)
    {
        var provision = await broker.ProvisionAsync(ArenaScenarioId, owner, ct);
        return new RankedLaunchProvision(
            provision.Resource is null ? null : Cluster(provision.Resource),
            provision.Status,
            provision.Error);
    }

    public async Task<RankedLaunchReadiness> ReadReadinessAsync(
        RankedLaunchCluster cluster, CancellationToken ct)
    {
        // Readiness is measured against the resource, not the summary the launch is holding: the
        // namespace it reads has to be the one the cluster reports right now.
        var resource = await broker.GetOwnedAsync(cluster.RunId, cluster.Owner, ct);
        if (resource is null) return RankedLaunchReadiness.None;
        try
        {
            return await broker.ReadLaunchReadinessAsync(resource, ct);
        }
        catch (Exception ex)
        {
            // A namespace that cannot be read is a namespace that is not ready. Reporting nothing
            // keeps the launch waiting instead of activating on a frame that never arrived.
            log.LogDebug(ex, "Launch readiness unavailable for {RunId}.", cluster.RunId);
            return RankedLaunchReadiness.None;
        }
    }

    public async Task<RankedLaunchCluster?> AnnotateAsync(
        string runId,
        string owner,
        string expectedVersion,
        IReadOnlyDictionary<string, string?> annotations,
        CancellationToken ct)
    {
        var updated = await broker.PatchLaunchStateAsync(
            runId, owner, expectedVersion, annotations, ct);
        return updated is null ? null : Cluster(updated);
    }

    public async Task<RankedLaunchCluster?> StartTrafficAsync(
        string runId, string owner, string expectedVersion, CancellationToken ct)
    {
        var started = await broker.StartRankedTrafficAsync(runId, owner, expectedVersion, ct);
        return started is null ? null : Cluster(started);
    }

    public async Task<RankedLaunchCluster?> ActivateAsync(
        RankedLaunchActivation activation, CancellationToken ct)
    {
        var activated = await broker.ActivateRankedIncidentAsync(activation, ct);
        return activated is null ? null : Cluster(activated);
    }

    public Task<bool> DiscardClusterAsync(string runId, string owner, CancellationToken ct) =>
        broker.DeleteRunAsync(runId, owner, "", ct);

    public Task<RankedDraw?> DrawIncidentAsync(string owner, CancellationToken ct) =>
        broker.DrawRankedIncidentAsync(owner, ct);

    public Task<RankedAttemptView?> ReadAttemptAsync(
        string attemptId, string owner, CancellationToken ct) =>
        ranked.GetAttemptAsync(attemptId, owner, ct);

    public Task<RankedAttemptView?> ActiveAttemptAsync(string owner, CancellationToken ct) =>
        ranked.ActiveForOwnerAsync(owner, ct);

    public async Task<RankedAttemptView?> OpenAttemptAsync(
        string runId,
        string drillId,
        string owner,
        string displayName,
        DateTime startedUtc,
        CancellationToken ct)
    {
        try
        {
            return await ranked.BeginAsync(runId, drillId, owner, displayName, startedUtc, ct);
        }
        catch (InvalidOperationException)
        {
            // The store's own one-active-attempt-per-operator rule, enforced in a serializable
            // transaction. Null is not a failure here: it is the guard reporting that somebody else
            // opened this operator's attempt first, and the caller adopts theirs.
            return null;
        }
    }

    public async Task VoidAttemptAsync(
        string attemptId, string owner, string displayName, CancellationToken ct) =>
        await ranked.FinalizeAsync(
            attemptId, owner, RankedOutcomes.Void, 0, 0, "", displayName, ct);

    private static RankedLaunchCluster Cluster(LabRunResource resource)
    {
        var view = RunView.From(resource);
        var annotations = resource.Metadata.Annotations;
        var synced = resource.Status?.Conditions?.FirstOrDefault(
            condition => condition.Type == "Synced");

        return new RankedLaunchCluster(
            view.RunId,
            resource.Metadata.ResourceVersion ?? "",
            view.Owner,
            // A missing Synced condition is a composition that has not reported yet, which is
            // ordinary during provisioning. Only an explicit not-True is a reconcile problem.
            Reconciled: synced is null || synced.Status == "True",
            Provisioned: view.Status == "ready",
            NamespaceAssigned: !string.IsNullOrWhiteSpace(resource.Status?.Namespace),
            Deleting: resource.Metadata.DeletionTimestamp is not null || view.Status == "deleting",
            LaunchId: Annotation(annotations, RankedLaunchOrchestrator.LaunchIdAnnotation),
            LaunchStartedUtc: ParseTime(
                Annotation(annotations, RankedLaunchOrchestrator.LaunchStartedAnnotation)),
            LaunchPhase: Annotation(annotations, RankedLaunchOrchestrator.LaunchPhaseAnnotation),
            LaunchFailure: Annotation(
                annotations, RankedLaunchOrchestrator.LaunchFailureAnnotation),
            LaunchFailurePhase: Annotation(
                annotations, RankedLaunchOrchestrator.LaunchFailurePhaseAnnotation),
            IncidentDrillId: Annotation(
                annotations, RankedLaunchOrchestrator.LaunchIncidentAnnotation),
            LaunchAttemptId: Annotation(
                annotations, RankedLaunchOrchestrator.LaunchAttemptAnnotation),
            // The clock is spec.drillStartedAt and nothing else. A launch is pre-activation exactly
            // as long as this is empty, which is what makes "no ranked time before activation" a
            // property of the resource rather than of anybody's bookkeeping.
            ClockStarted: !string.IsNullOrWhiteSpace(resource.Spec.DrillStartedAt),
            ActiveDrillId: view.DrillId,
            DrillMode: view.DrillMode,
            MatchElapsedMs: view.DrillElapsedMs);
    }

    private static string Annotation(IReadOnlyDictionary<string, string>? annotations, string key) =>
        annotations?.GetValueOrDefault(key) ?? "";

    private static DateTime? ParseTime(string value) =>
        value.Length > 0 &&
        DateTime.TryParse(
            value,
            null,
            System.Globalization.DateTimeStyles.AdjustToUniversal |
            System.Globalization.DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
}
