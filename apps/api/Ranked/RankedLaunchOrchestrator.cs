using System.Collections.Concurrent;
using IsaacWallace.Api.Data;
using IsaacWallace.Api.Runs;

namespace IsaacWallace.Api.Ranked;

/// <summary>
/// The disposable cluster a launch is driving, reduced to the facts the lifecycle decides on.
///
/// <paramref name="Version"/> is the resource's own optimistic-concurrency token. Every write the
/// launch makes carries the version it read, so two API replicas advancing the same launch cannot
/// both believe they are the one activating it.
/// </summary>
public sealed record RankedLaunchCluster(
    string RunId,
    string Version,
    string Owner,
    /// <summary>The composition is not reporting a failed sync.</summary>
    bool Reconciled,
    /// <summary>The run reports ready.</summary>
    bool Provisioned,
    bool NamespaceAssigned,
    bool Deleting,
    string LaunchId,
    DateTime? LaunchStartedUtc,
    string LaunchPhase,
    string LaunchFailure,
    /// <summary>The phase a failed launch died in, which decides whether a retry may reuse the
    /// cluster or has to replace it.</summary>
    string LaunchFailurePhase,
    /// <summary>The incident this launch drew, recorded before the attempt exists so a retry
    /// resumes the same match instead of redrawing a friendlier one.</summary>
    string IncidentDrillId,
    /// <summary>The attempt this launch opened, recorded before the clock is stamped so a crash
    /// between the two is resumable rather than an orphan.</summary>
    string LaunchAttemptId,
    /// <summary>Whether spec.drillStartedAt is set — the match clock itself.</summary>
    bool ClockStarted,
    string ActiveDrillId,
    string DrillMode,
    long MatchElapsedMs)
{
    /// <summary>A launch is finished when, and only when, the cluster is running a ranked incident
    /// on a stamped clock. Anything short of all three is still a launch.</summary>
    public bool IsLiveRankedMatch =>
        ClockStarted && ActiveDrillId.Length > 0 &&
        string.Equals(DrillMode, "ranked", StringComparison.Ordinal);
}

/// <summary>Provisioning outcome, carrying the broker's own status for capacity and auth refusals
/// so the launch endpoint answers 401/429 exactly as /v1/runs does.</summary>
public sealed record RankedLaunchProvision(RankedLaunchCluster? Cluster, int Status, string? Error);

/// <summary>
/// The single write that turns a verified environment into a live match: the incident's opening
/// fault, the drill id, the match clock, and the attempt id, applied together under the version the
/// caller verified. Split across two writes there is a window in which the fault is live and the
/// clock is not, or the clock is running and the fault is not — both of which the operator pays for.
/// </summary>
public sealed record RankedLaunchActivation(
    string RunId,
    string Owner,
    string ExpectedVersion,
    string DrillId,
    string AttemptId,
    DateTime ActivatedUtc);

/// <summary>
/// Everything the launch needs from the world, as a port.
///
/// The orchestrator is the part that must be provably correct under retries, reloads, and two
/// simultaneous clicks, and none of that is provable against a real Kubernetes cluster. The broker
/// implements this against Crossplane and the ranked store; the tests implement it against an
/// in-memory cluster and a real store.
/// </summary>
public interface IRankedLaunchEnvironment
{
    /// <summary>The caller's own live cluster, or null. Never anyone else's.</summary>
    Task<RankedLaunchCluster?> FindClusterAsync(string owner, CancellationToken ct);

    Task<RankedLaunchCluster?> ReadClusterAsync(string runId, string owner, CancellationToken ct);

    Task<RankedLaunchProvision> ProvisionClusterAsync(string owner, CancellationToken ct);

    Task<RankedLaunchReadiness> ReadReadinessAsync(
        RankedLaunchCluster cluster, CancellationToken ct);

    /// <summary>Compare-and-set launch bookkeeping onto the cluster. Null means the write did not
    /// land — either the version moved or the platform refused — and the caller re-reads.</summary>
    Task<RankedLaunchCluster?> AnnotateAsync(
        string runId,
        string owner,
        string expectedVersion,
        IReadOnlyDictionary<string, string?> annotations,
        CancellationToken ct);

    /// <summary>Start the arena's load generator. The only pre-activation write that touches the
    /// workload, and deliberately so: without offered load there is nothing for the launch to
    /// verify and nothing for the match to be judged against. Idempotent.</summary>
    Task<RankedLaunchCluster?> StartTrafficAsync(
        string runId, string owner, string expectedVersion, CancellationToken ct);

    /// <summary>The activation boundary. Null means another writer got there first.</summary>
    Task<RankedLaunchCluster?> ActivateAsync(
        RankedLaunchActivation activation, CancellationToken ct);

    Task<bool> DiscardClusterAsync(string runId, string owner, CancellationToken ct);

    /// <summary>Draw an incident for this operator. Null means none could be drawn safely.</summary>
    Task<RankedDraw?> DrawIncidentAsync(string owner, CancellationToken ct);

    Task<RankedAttemptView?> ReadAttemptAsync(
        string attemptId, string owner, CancellationToken ct);

    Task<RankedAttemptView?> ActiveAttemptAsync(string owner, CancellationToken ct);

    /// <summary>Open the rated attempt. Null means the store already holds an active attempt for
    /// this operator, which is the store's own one-match-at-a-time guarantee refusing a duplicate.
    /// </summary>
    Task<RankedAttemptView?> OpenAttemptAsync(
        string runId,
        string drillId,
        string owner,
        string displayName,
        DateTime startedUtc,
        CancellationToken ct);

    /// <summary>Seal an attempt as void — terminal, and never rated.</summary>
    Task VoidAttemptAsync(
        string attemptId, string owner, string displayName, CancellationToken ct);
}

/// <summary>
/// Drives a ranked launch from "nothing" to "live match", one bounded step per call.
///
/// No call blocks waiting for a cluster. Provisioning a namespace and getting five workloads to
/// serve traffic takes minutes, and holding an HTTP request open for it would make every retry,
/// reload, and load-balancer timeout a source of duplicate clusters and duplicate attempts. Instead
/// each call advances the launch as far as the environment currently allows and returns the phase,
/// so the page polls a state machine rather than waiting on a promise. Resuming is therefore the
/// same code path as starting, which is what makes a reload free.
///
/// The launch's state lives on the LabRun itself rather than in memory: it must survive an api
/// restart, and two replicas polling the same launch must agree about it.
/// </summary>
public sealed class RankedLaunchOrchestrator(
    IRankedLaunchEnvironment environment,
    RankedLaunchBudget budget,
    TimeProvider clock,
    ILogger logger)
{
    public const string LaunchIdAnnotation = "homeops.isaacwallace.dev/ranked-launch-id";
    public const string LaunchStartedAnnotation = "homeops.isaacwallace.dev/ranked-launch-started";
    public const string LaunchPhaseAnnotation = "homeops.isaacwallace.dev/ranked-launch-phase";
    public const string LaunchFailureAnnotation = "homeops.isaacwallace.dev/ranked-launch-failure";
    public const string LaunchFailurePhaseAnnotation =
        "homeops.isaacwallace.dev/ranked-launch-failed-phase";
    public const string LaunchIncidentAnnotation =
        "homeops.isaacwallace.dev/ranked-launch-incident";
    public const string LaunchAttemptAnnotation = "homeops.isaacwallace.dev/ranked-launch-attempt";

    /// <summary>Every launch annotation, for the paths that clear a launch. Kept in one place so a
    /// new key cannot be added to the lifecycle and forgotten by teardown.</summary>
    public static readonly IReadOnlyList<string> LaunchAnnotations =
    [
        LaunchIdAnnotation,
        LaunchStartedAnnotation,
        LaunchPhaseAnnotation,
        LaunchFailureAnnotation,
        LaunchFailurePhaseAnnotation,
        LaunchIncidentAnnotation,
        LaunchAttemptAnnotation,
    ];

    // Two clicks on "Start ranked" land as two requests, and on one replica they would otherwise
    // interleave between reading "no launch yet" and writing one — two clusters, or two attempts.
    // Serializing per owner closes that window inside a process; the version check on every write
    // and the store's own active-attempt rule close it between processes. The orchestrator is built
    // per request from services that are already registered, so its mutual exclusion has to be
    // process-wide state rather than an injected singleton.
    private static readonly ConcurrentDictionary<string, LaunchGate> Gates =
        new(StringComparer.Ordinal);

    /// <summary>Start a ranked launch, or resume the one already in progress.
    ///
    /// Idempotent by construction: the caller names no run and no incident, so there is exactly one
    /// launch per operator and a second request can only ever find the first one.</summary>
    public async Task<RankedLaunchResult> LaunchAsync(
        string owner,
        string displayName,
        bool retry,
        CancellationToken ct)
    {
        using var gate = await LaunchGate.EnterAsync(owner, ct);
        try
        {
            var cluster = await environment.FindClusterAsync(owner, ct);

            // Already playing. A reload, a second tab, and a retried POST all land here, and none of
            // them may restart a clock that is running.
            if (cluster is not null && cluster.IsLiveRankedMatch)
                return RankedLaunchResult.Ok(LiveView(cluster));

            if (retry && cluster is { LaunchFailure.Length: > 0 })
                cluster = await ResetAsync(cluster, owner, displayName, ct);

            if (cluster is null)
            {
                var provision = await environment.ProvisionClusterAsync(owner, ct);
                if (provision.Cluster is null)
                    return RankedLaunchResult.Fail(
                        provision.Status,
                        provision.Error ?? "The arena could not be provisioned.");
                cluster = provision.Cluster;
            }

            if (cluster.Deleting)
                return RankedLaunchResult.Fail(
                    409, "The disposable cluster is being torn down. Try again shortly.");

            // Some other incident is already layered on this cluster — a practice drill, or a ranked
            // one that has been decided but not cleared. Either way it is a different lifecycle, and
            // silently replacing it would discard work the operator is in the middle of or a result
            // they have not read yet.
            if (cluster.ActiveDrillId.Length > 0)
                return RankedLaunchResult.Fail(
                    409, "End the current incident before starting a ranked match.");

            cluster = await OpenLaunchAsync(cluster, owner, ct);
            if (cluster is null)
                return RankedLaunchResult.Fail(
                    503, "The launch could not be recorded. Try again.");
            if (cluster.LaunchFailure.Length > 0)
                return RankedLaunchResult.Ok(FailedView(cluster));

            return await AdvanceAsync(cluster, owner, displayName, ct);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Nothing above this point rates anything, so an unexpected failure costs the caller a
            // retry and never a match. The launch state on the cluster is unchanged.
            logger.LogError(ex, "Ranked launch failed for an operator before activation.");
            return RankedLaunchResult.Fail(503, "The ranked launch is unavailable right now.");
        }
    }

    /// <summary>Read the launch without advancing it. Owner-scoped: an operator with no cluster of
    /// their own has no launch to observe, whoever else is playing.</summary>
    public async Task<RankedLaunchResult> ObserveAsync(string owner, CancellationToken ct)
    {
        var cluster = await environment.FindClusterAsync(owner, ct);
        if (cluster is null)
            return RankedLaunchResult.Fail(404, "No ranked launch is in progress.");
        if (cluster.IsLiveRankedMatch) return RankedLaunchResult.Ok(LiveView(cluster));
        if (cluster.LaunchId.Length == 0)
            return RankedLaunchResult.Fail(404, "No ranked launch is in progress.");
        if (cluster.LaunchFailure.Length > 0)
            return RankedLaunchResult.Ok(FailedView(cluster));

        var readiness = await ReadinessOf(cluster, ct);
        var gate = RankedLaunchGate.Evaluate(
            cluster.Reconciled, cluster.NamespaceAssigned, cluster.Provisioned, readiness);
        return RankedLaunchResult.Ok(View(cluster, gate.Phase, gate.Blocker, gate.Checks));
    }

    /// <summary>Abandon a launch that has not activated, and tear down what it provisioned.
    ///
    /// Deliberately refuses once the match is live: a live ranked match ends through the existing
    /// forfeit path, which rates it. Letting a cancel button reach a running match would make
    /// "leave when it is going badly" a strictly better move than playing it out.</summary>
    public async Task<RankedLaunchResult> AbandonAsync(
        string owner, string displayName, CancellationToken ct)
    {
        using var gate = await LaunchGate.EnterAsync(owner, ct);
        var cluster = await environment.FindClusterAsync(owner, ct);
        if (cluster is null)
            return RankedLaunchResult.Fail(404, "No ranked launch is in progress.");
        if (cluster.IsLiveRankedMatch)
            return RankedLaunchResult.Fail(
                409,
                "A live ranked match cannot be abandoned. Forfeit it to seal the result.");

        // This endpoint tears down a cluster, so it may only ever act on a cluster a ranked launch
        // actually owns. A sandbox somebody is practising on is not one, and a practice drill on a
        // cluster with leftover launch bookkeeping is not one either — both belong to the run
        // endpoints, and neither is this button's to delete.
        if (cluster.LaunchId.Length == 0 || cluster.ActiveDrillId.Length > 0)
            return RankedLaunchResult.Fail(404, "No ranked launch is in progress.");

        await VoidLaunchAttemptAsync(cluster, owner, displayName, ct);
        await environment.DiscardClusterAsync(cluster.RunId, owner, ct);

        var cancelled = cluster with
        {
            LaunchFailure = "The launch was cancelled before activation.",
            LaunchFailurePhase = cluster.LaunchPhase,
        };
        return RankedLaunchResult.Ok(FailedView(cancelled));
    }

    // ── the state machine ────────────────────────────────────────────────────────────────────

    private async Task<RankedLaunchResult> AdvanceAsync(
        RankedLaunchCluster cluster,
        string owner,
        string displayName,
        CancellationToken ct)
    {
        var readiness = await ReadinessOf(cluster, ct);
        var gate = RankedLaunchGate.Evaluate(
            cluster.Reconciled, cluster.NamespaceAssigned, cluster.Provisioned, readiness);
        var elapsed = ElapsedSince(cluster.LaunchStartedUtc);

        if (!gate.ReadyToActivate)
        {
            if (elapsed > budget.DeadlineFor(gate.Phase))
                return RankedLaunchResult.Ok(await FailAsync(
                    cluster, owner, displayName, gate.Phase, gate.Blocker, ct));

            // An arena is provisioned quiet. Turning the traffic on is the launch's own job, and
            // stays entirely on this side of the activation boundary: it changes what the cluster is
            // doing, not what the operator is being timed on.
            if (gate.TrafficStopped)
                cluster = await environment.StartTrafficAsync(
                    cluster.RunId, owner, cluster.Version, ct) ?? cluster;

            cluster = await RecordPhaseAsync(cluster, owner, gate.Phase, ct);
            return RankedLaunchResult.Ok(
                View(cluster, gate.Phase, gate.Blocker, gate.Checks));
        }

        if (elapsed > budget.Total)
            return RankedLaunchResult.Ok(await FailAsync(
                cluster,
                owner,
                displayName,
                RankedLaunchPhases.ActivatingIncident,
                "The launch ran out of time before the incident could be activated.",
                ct));

        cluster = await RecordPhaseAsync(
            cluster, owner, RankedLaunchPhases.ActivatingIncident, ct);
        return await ActivateAsync(cluster, owner, displayName, gate, ct);
    }

    /// <summary>
    /// The activation boundary, in the only order that is safe.
    ///
    /// Draw and record the incident, then open the attempt, then commit the clock — each step
    /// recorded before the next begins, so an interruption anywhere resumes onto the same incident
    /// and the same attempt rather than drawing a second one. The clock is last because it is the
    /// only step the operator is charged for.
    /// </summary>
    private async Task<RankedLaunchResult> ActivateAsync(
        RankedLaunchCluster cluster,
        string owner,
        string displayName,
        RankedLaunchGateResult gate,
        CancellationToken ct)
    {
        var drillId = cluster.IncidentDrillId;
        if (drillId.Length == 0)
        {
            RankedDraw? draw;
            try
            {
                draw = await environment.DrawIncidentAsync(owner, ct);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Could not draw a ranked incident for {RunId}.", cluster.RunId);
                return RankedLaunchResult.Fail(
                    503, "Ranked matchmaking is unavailable right now.");
            }
            if (draw is null)
                return RankedLaunchResult.Fail(
                    503, "A unique ranked incident could not be generated safely. Try again.");

            var armed = await environment.AnnotateAsync(
                cluster.RunId,
                owner,
                cluster.Version,
                new Dictionary<string, string?>(StringComparer.Ordinal)
                {
                    [LaunchIncidentAnnotation] = draw.Plan.DrillId,
                },
                ct);
            if (armed is null) return await ResyncAsync(cluster, owner, gate, ct);
            cluster = armed;
            drillId = draw.Plan.DrillId;
        }

        var definition = ScenarioDefinitions.Find(drillId);
        if (definition is null || definition.Stages.Count == 0)
            return RankedLaunchResult.Ok(await FailAsync(
                cluster,
                owner,
                displayName,
                RankedLaunchPhases.ActivatingIncident,
                "The drawn ranked incident could not be materialized.",
                ct));

        var attempt = await ResolveAttemptAsync(cluster, owner, displayName, drillId, ct);
        if (attempt.Refusal is not null) return attempt.Refusal;
        if (attempt.Attempt is null)
            return RankedLaunchResult.Fail(
                503, "The ranked attempt could not be opened. Try again.");

        if (!string.Equals(cluster.LaunchAttemptId, attempt.Attempt.Id, StringComparison.Ordinal))
        {
            var marked = await environment.AnnotateAsync(
                cluster.RunId,
                owner,
                cluster.Version,
                new Dictionary<string, string?>(StringComparer.Ordinal)
                {
                    [LaunchAttemptAnnotation] = attempt.Attempt.Id,
                },
                ct);
            if (marked is null) return await ResyncAsync(cluster, owner, gate, ct);
            cluster = marked;
        }

        // The clock is the attempt's own start, not "now". A launch that opened its attempt and then
        // failed to commit would otherwise hand back the seconds between the two on every retry.
        var activated = await environment.ActivateAsync(
            new RankedLaunchActivation(
                cluster.RunId,
                owner,
                cluster.Version,
                drillId,
                attempt.Attempt.Id,
                attempt.Attempt.StartedUtc),
            ct);
        if (activated is null) return await ResyncAsync(cluster, owner, gate, ct);

        return RankedLaunchResult.Ok(LiveView(activated));
    }

    /// <summary>The attempt this launch owns, opened at most once across every request that ever
    /// touches it.</summary>
    private async Task<AttemptResolution> ResolveAttemptAsync(
        RankedLaunchCluster cluster,
        string owner,
        string displayName,
        string drillId,
        CancellationToken ct)
    {
        if (cluster.LaunchAttemptId.Length > 0)
        {
            var recorded = await environment.ReadAttemptAsync(
                cluster.LaunchAttemptId, owner, ct);
            if (recorded is { Outcome: RankedOutcomes.Active })
                return new AttemptResolution(recorded, null);

            // The attempt this launch opened has already been sealed — by a reaper, a teardown, or
            // another replica. It cannot be reopened, and reusing the launch would rate a match
            // against a decided attempt.
            return new AttemptResolution(
                null,
                RankedLaunchResult.Ok(await FailAsync(
                    cluster,
                    owner,
                    displayName,
                    RankedLaunchPhases.ActivatingIncident,
                    "The ranked attempt for this launch was already sealed.",
                    ct)));
        }

        var active = await environment.ActiveAttemptAsync(owner, ct);
        if (active is not null)
        {
            // Opened by an earlier request for this same launch, whose clock write never landed.
            if (string.Equals(active.RunId, cluster.RunId, StringComparison.Ordinal))
                return new AttemptResolution(active, null);

            // An active row on some other cluster. If that cluster is gone or never started its
            // clock, the row cannot represent a playable match: seal it void, which is terminal and
            // unrated, exactly as the previous start path did. A cluster that IS mid-match is
            // someone's real work and is never touched.
            var other = await environment.ReadClusterAsync(active.RunId, owner, ct);
            if (other is not null && other.IsLiveRankedMatch)
                return new AttemptResolution(
                    null,
                    RankedLaunchResult.Fail(
                        409, "A ranked match is already in progress on another cluster."));
            await environment.VoidAttemptAsync(active.Id, owner, displayName, ct);
        }

        var opened = await environment.OpenAttemptAsync(
            cluster.RunId, drillId, owner, displayName, clock.GetUtcNow().UtcDateTime, ct);
        if (opened is not null) return new AttemptResolution(opened, null);

        // The store refused: an attempt became active between the read above and this write. That
        // is the concurrency guard doing its job — whoever won owns the launch, and this request
        // adopts their attempt rather than opening a second one.
        var winner = await environment.ActiveAttemptAsync(owner, ct);
        if (winner is not null &&
            string.Equals(winner.RunId, cluster.RunId, StringComparison.Ordinal))
            return new AttemptResolution(winner, null);

        return new AttemptResolution(
            null,
            RankedLaunchResult.Fail(409, "A ranked match is already in progress."));
    }

    private sealed record AttemptResolution(
        RankedAttemptView? Attempt, RankedLaunchResult? Refusal);

    // ── bookkeeping ──────────────────────────────────────────────────────────────────────────

    private async Task<RankedLaunchCluster?> OpenLaunchAsync(
        RankedLaunchCluster cluster, string owner, CancellationToken ct)
    {
        if (cluster.LaunchId.Length > 0) return cluster;

        var now = clock.GetUtcNow().UtcDateTime;
        var opened = await environment.AnnotateAsync(
            cluster.RunId,
            owner,
            cluster.Version,
            new Dictionary<string, string?>(StringComparer.Ordinal)
            {
                [LaunchIdAnnotation] = NewLaunchId(),
                [LaunchStartedAnnotation] = now.ToString("O"),
                [LaunchPhaseAnnotation] = RankedLaunchPhases.Provisioning,
                [LaunchFailureAnnotation] = null,
                [LaunchFailurePhaseAnnotation] = null,
            },
            ct);
        // A concurrent request opened it first; theirs is the launch.
        return opened ?? await environment.ReadClusterAsync(cluster.RunId, owner, ct);
    }

    private async Task<RankedLaunchCluster> RecordPhaseAsync(
        RankedLaunchCluster cluster, string owner, string phase, CancellationToken ct)
    {
        if (string.Equals(cluster.LaunchPhase, phase, StringComparison.Ordinal)) return cluster;
        var updated = await environment.AnnotateAsync(
            cluster.RunId,
            owner,
            cluster.Version,
            new Dictionary<string, string?>(StringComparer.Ordinal)
            {
                [LaunchPhaseAnnotation] = phase,
            },
            ct);
        // The phase is a label on a decision that was already made from measurements; losing the
        // write costs a display refresh, never correctness.
        return updated ?? cluster;
    }

    /// <summary>Mark the launch failed. Never rates anything: any attempt this launch opened is
    /// sealed void, which is terminal and excluded from rating.</summary>
    private async Task<RankedLaunchView> FailAsync(
        RankedLaunchCluster cluster,
        string owner,
        string displayName,
        string phase,
        string reason,
        CancellationToken ct)
    {
        await VoidLaunchAttemptAsync(cluster, owner, displayName, ct);

        var failed = await environment.AnnotateAsync(
            cluster.RunId,
            owner,
            cluster.Version,
            new Dictionary<string, string?>(StringComparer.Ordinal)
            {
                [LaunchPhaseAnnotation] = RankedLaunchPhases.Failed,
                [LaunchFailureAnnotation] = reason,
                [LaunchFailurePhaseAnnotation] = phase,
                [LaunchAttemptAnnotation] = null,
            },
            ct) ?? cluster with
            {
                LaunchPhase = RankedLaunchPhases.Failed,
                LaunchFailure = reason,
                LaunchFailurePhase = phase,
            };

        logger.LogWarning(
            "Ranked launch {LaunchId} on {RunId} failed in {Phase}: {Reason}",
            failed.LaunchId,
            failed.RunId,
            phase,
            reason);
        return FailedView(failed);
    }

    /// <summary>
    /// Clear a failed launch so a retry starts clean.
    ///
    /// A launch that died waiting for the platform itself gets a new cluster, because the old one is
    /// the thing that did not work. A launch that only failed to see telemetry keeps the cluster it
    /// already paid several minutes to provision — the workloads are running, and tearing them down
    /// to build the same thing again is the slowest possible way to retry.
    /// </summary>
    private async Task<RankedLaunchCluster?> ResetAsync(
        RankedLaunchCluster cluster,
        string owner,
        string displayName,
        CancellationToken ct)
    {
        await VoidLaunchAttemptAsync(cluster, owner, displayName, ct);

        var replace = cluster.LaunchFailurePhase is
            RankedLaunchPhases.Provisioning or RankedLaunchPhases.StartingWorkloads;
        if (replace || cluster.Deleting)
        {
            await environment.DiscardClusterAsync(cluster.RunId, owner, ct);
            return null;
        }

        var cleared = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var key in LaunchAnnotations) cleared[key] = null;
        return await environment.AnnotateAsync(
            cluster.RunId, owner, cluster.Version, cleared, ct);
    }

    /// <summary>Seal a pre-activation attempt as void. Void is unrated, so a launch that never
    /// produced a playable environment cannot move anybody's rating.</summary>
    private async Task VoidLaunchAttemptAsync(
        RankedLaunchCluster cluster, string owner, string displayName, CancellationToken ct)
    {
        if (cluster.IsLiveRankedMatch) return;

        var attemptId = cluster.LaunchAttemptId;
        if (attemptId.Length == 0)
        {
            var active = await environment.ActiveAttemptAsync(owner, ct);
            if (active is null ||
                !string.Equals(active.RunId, cluster.RunId, StringComparison.Ordinal))
                return;
            attemptId = active.Id;
        }

        try
        {
            await environment.VoidAttemptAsync(attemptId, owner, displayName, ct);
        }
        catch (Exception ex)
        {
            // The attempt stays active and unrated; the next launch's orphan sweep seals it. An
            // unsealed row is untidy, but it is not a rating mutation.
            logger.LogError(
                ex, "Could not void the pre-activation attempt on {RunId}.", cluster.RunId);
        }
    }

    /// <summary>A write lost its race. Re-read and report what is actually true rather than
    /// retrying in-request: the caller is already polling, and a bounded step is what makes two
    /// simultaneous launches converge instead of fighting.</summary>
    private async Task<RankedLaunchResult> ResyncAsync(
        RankedLaunchCluster cluster,
        string owner,
        RankedLaunchGateResult gate,
        CancellationToken ct)
    {
        var fresh = await environment.ReadClusterAsync(cluster.RunId, owner, ct);
        if (fresh is null)
            return RankedLaunchResult.Fail(
                503, "The disposable cluster became unavailable during activation.");
        return RankedLaunchResult.Ok(
            fresh.IsLiveRankedMatch
                ? LiveView(fresh)
                : View(fresh, gate.Phase, gate.Blocker, gate.Checks));
    }

    private async Task<RankedLaunchReadiness> ReadinessOf(
        RankedLaunchCluster cluster, CancellationToken ct) =>
        cluster is { Provisioned: true, NamespaceAssigned: true }
            ? await environment.ReadReadinessAsync(cluster, ct)
            : RankedLaunchReadiness.None;

    private TimeSpan ElapsedSince(DateTime? started) =>
        started is null ? TimeSpan.Zero : clock.GetUtcNow().UtcDateTime - started.Value;

    // ── projections ──────────────────────────────────────────────────────────────────────────

    private RankedLaunchView View(
        RankedLaunchCluster cluster,
        string phase,
        string detail,
        IReadOnlyList<RankedLaunchCheck> checks) =>
        new(
            cluster.LaunchId,
            cluster.RunId,
            phase,
            RankedLaunchPhases.StepOf(phase),
            RankedLaunchPhases.Order.Count,
            RankedLaunchPhases.TitleOf(phase),
            detail,
            RankedLaunchPhases.IsTerminal(phase),
            Active: phase == RankedLaunchPhases.Active,
            Failed: phase == RankedLaunchPhases.Failed,
            FailureReason: phase == RankedLaunchPhases.Failed ? detail : "",
            Retryable: phase == RankedLaunchPhases.Failed,
            LaunchElapsedSeconds: (int)Math.Max(0, ElapsedSince(cluster.LaunchStartedUtc).TotalSeconds),
            LaunchBudgetSeconds: (int)budget.Total.TotalSeconds,
            ClockStarted: cluster.ClockStarted,
            MatchElapsedMs: cluster.IsLiveRankedMatch ? cluster.MatchElapsedMs : 0,
            AttemptId: cluster.IsLiveRankedMatch ? cluster.LaunchAttemptId : "",
            Checks: checks);

    private RankedLaunchView LiveView(RankedLaunchCluster cluster) =>
        View(
            cluster,
            RankedLaunchPhases.Active,
            "The incident is live and the match clock is running.",
            []);

    private RankedLaunchView FailedView(RankedLaunchCluster cluster) =>
        View(
            cluster,
            RankedLaunchPhases.Failed,
            cluster.LaunchFailure.Length > 0
                ? cluster.LaunchFailure
                : "The launch could not reach a playable environment.",
            []);

    private static string NewLaunchId() =>
        Convert.ToHexStringLower(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16));

    /// <summary>Per-owner mutual exclusion, released deterministically and evicted when idle so a
    /// long-lived replica does not accumulate a lock per operator it has ever served.</summary>
    private sealed class LaunchGate : IDisposable
    {
        private readonly string _owner;
        private readonly SemaphoreSlim _semaphore = new(1, 1);
        private int _holders;

        private LaunchGate(string owner) => _owner = owner;

        public static async Task<LaunchGate> EnterAsync(string owner, CancellationToken ct)
        {
            LaunchGate gate;
            lock (Gates)
            {
                gate = Gates.GetOrAdd(owner, key => new LaunchGate(key));
                gate._holders++;
            }
            await gate._semaphore.WaitAsync(ct);
            return gate;
        }

        public void Dispose()
        {
            _semaphore.Release();
            lock (Gates)
            {
                if (--_holders <= 0) Gates.TryRemove(_owner, out _);
            }
        }
    }
}
