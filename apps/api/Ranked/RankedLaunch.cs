namespace IsaacWallace.Api.Ranked;

// The launch of a ranked match, as a lifecycle rather than a single call.
//
// Starting ranked used to be one request that stamped the match clock and opened a rated attempt the
// instant it was made — while the disposable cluster behind it was still being composed. The
// operator was charged for the platform's provisioning, and an attempt existed for an environment
// that might never become playable, which is a rating mutation waiting to happen for a reason that
// has nothing to do with the operator.
//
// So the launch is now its own object with its own state, and the match clock is one of the LAST
// things it does. Everything before activation is explicitly not a match: no elapsed time, no
// attempt, no rating exposure. The phases below are the public vocabulary the front end renders, and
// they are ordered — a launch never moves backwards, and only the activation boundary can end it.
public static class RankedLaunchPhases
{
    /// <summary>Crossplane is composing the disposable cluster; nothing is running yet.</summary>
    public const string Provisioning = "provisioning";

    /// <summary>The namespace exists; its required workloads are still coming up.</summary>
    public const string StartingWorkloads = "starting-workloads";

    /// <summary>Everything is running; the platform is confirming it can actually measure it.</summary>
    public const string VerifyingTelemetry = "verifying-telemetry";

    /// <summary>The activation boundary: draw the incident, open the attempt, start the clock.</summary>
    public const string ActivatingIncident = "activating-incident";

    /// <summary>The match is live. From here the existing snapshot contract takes over.</summary>
    public const string Active = "active";

    /// <summary>The launch could not reach a playable environment. Never rated.</summary>
    public const string Failed = "launch-failed";

    /// <summary>The phases a launch passes through, in order. Terminal states are not in it.</summary>
    public static readonly IReadOnlyList<string> Order =
    [
        Provisioning,
        StartingWorkloads,
        VerifyingTelemetry,
        ActivatingIncident,
        Active,
    ];

    /// <summary>1-based position for a progress indicator; 0 for the terminal failure.</summary>
    public static int StepOf(string phase)
    {
        var index = Order.ToList().IndexOf(phase);
        return index < 0 ? 0 : index + 1;
    }

    public static string TitleOf(string phase) => phase switch
    {
        Provisioning => "Provisioning your disposable cluster",
        StartingWorkloads => "Starting the cluster workloads",
        VerifyingTelemetry => "Verifying live telemetry",
        ActivatingIncident => "Activating the ranked incident",
        Active => "Ranked match live",
        Failed => "Launch failed",
        _ => "Preparing the arena",
    };

    /// <summary>Whether a launch in this phase has stopped moving on its own.</summary>
    public static bool IsTerminal(string phase) => phase is Active or Failed;
}

/// <summary>One named precondition the launch is waiting on, so the page can say which of the five
/// required workloads is still starting rather than showing an undifferentiated spinner.</summary>
public sealed record RankedLaunchCheck(
    string Id,
    string Label,
    /// <summary>pending | satisfied | blocked</summary>
    string Status,
    string Detail);

public static class RankedLaunchCheckStatus
{
    public const string Pending = "pending";
    public const string Satisfied = "satisfied";
    public const string Blocked = "blocked";
}

/// <summary>One workload of the disposable cluster, as measured.</summary>
public sealed record RankedLaunchWorkload(string Name, int Desired, int Ready);

/// <summary>What the platform can currently see of a run's namespace. Built from the same single
/// pass over the namespace the live page already takes, so verifying a launch costs one frame.</summary>
public sealed record RankedLaunchReadiness(
    IReadOnlyList<RankedLaunchWorkload> Workloads,
    /// <summary>Pods metrics-server has actually sampled — not pods that merely exist.</summary>
    int SampledPods,
    /// <summary>Whether the run's Envoy gateways answered a scrape at all. Distinguishing this from
    /// "reported zero" is the whole point: a gateway that has not been scraped yet and a gateway
    /// serving nothing look identical in the aggregate telemetry, and only one of them is a
    /// measurable environment.</summary>
    bool GatewayReporting,
    int ServedRequestsPerSec,
    int OfferedRequestsPerSec)
{
    public static readonly RankedLaunchReadiness None = new([], 0, false, 0, 0);
}

/// <summary>Which phase the observed environment puts the launch in, and why.</summary>
public sealed record RankedLaunchGateResult(
    string Phase,
    bool ReadyToActivate,
    string Blocker,
    IReadOnlyList<RankedLaunchCheck> Checks,
    /// <summary>The load generator is scaled to nothing, so no objective could be measured against
    /// this cluster. The launch turns it on rather than waiting for traffic that is never coming.
    /// </summary>
    bool TrafficStopped = false);

/// <summary>
/// The decision "is this environment playable yet", as a pure function of what was measured.
///
/// Keeping it pure is deliberate: this is the predicate the whole feature exists to enforce, and it
/// must be provable without a cluster. The orchestrator around it only supplies observations and
/// applies the answer.
/// </summary>
public static class RankedLaunchGate
{
    /// <summary>The substrate a generated incident is cut against. This is the same required set the
    /// broker already voids a live ranked match for losing — a match must not start without what it
    /// would be voided for losing, or the first poll after activation would void it.</summary>
    public static readonly IReadOnlyList<string> RequiredWorkloads =
        ["checkout", "envoy", "k6", "postgres", "redis"];

    /// <summary>The tier that generates the offered load. An arena is provisioned as an open
    /// sandbox, which starts with no traffic, so this one tier is not merely waited on — the launch
    /// turns it on. Every generated objective is measured against served load, so a ranked match
    /// started against a silent cluster has nothing to judge.</summary>
    public const string TrafficWorkload = "k6";

    /// <summary>metrics-server must have sampled a real fraction of the namespace. One sampled pod
    /// is a scrape that happened to land, not an instrumented cluster.</summary>
    public const int MinimumSampledPods = 3;

    /// <summary>The load generator must actually be driving the stack. Every generated objective is
    /// measured against served load, so a match started against an idle gateway is a match whose
    /// first stage cannot be judged.</summary>
    public const int MinimumServedRequestsPerSec = 1;

    public static RankedLaunchGateResult Evaluate(
        bool reconciled,
        bool namespaceAssigned,
        bool provisioned,
        RankedLaunchReadiness readiness)
    {
        if (!reconciled)
            return Waiting(
                RankedLaunchPhases.Provisioning,
                "The platform is still reconciling the disposable cluster.",
                [Check("reconcile", "Cluster reconciled", RankedLaunchCheckStatus.Pending,
                    "Crossplane has not reported a synced composition yet.")]);

        if (!namespaceAssigned || !provisioned)
            return Waiting(
                RankedLaunchPhases.Provisioning,
                "The disposable cluster is still being provisioned.",
                [
                    Check("reconcile", "Cluster reconciled", RankedLaunchCheckStatus.Satisfied,
                        "The composition is synced."),
                    Check("namespace", "Namespace assigned",
                        namespaceAssigned
                            ? RankedLaunchCheckStatus.Satisfied
                            : RankedLaunchCheckStatus.Pending,
                        namespaceAssigned
                            ? "The disposable namespace exists."
                            : "Waiting for the composed namespace."),
                    Check("ready", "Cluster ready", RankedLaunchCheckStatus.Pending,
                        "The run has not reported ready."),
                ]);

        var measured = readiness.Workloads.ToDictionary(w => w.Name, StringComparer.Ordinal);
        var trafficStopped = false;
        var workloadChecks = RequiredWorkloads
            .Select(name =>
            {
                if (!measured.TryGetValue(name, out var workload))
                    return Check(
                        $"workload:{name}",
                        name,
                        RankedLaunchCheckStatus.Pending,
                        "The deployment has not been created yet.");

                // The load generator is the one tier whose absence is an instruction rather than a
                // wait: the arena is provisioned as a quiet sandbox, and the launch is what turns
                // the traffic on.
                if (name == TrafficWorkload && workload.Desired <= 0)
                {
                    trafficStopped = true;
                    return Check(
                        $"workload:{name}",
                        name,
                        RankedLaunchCheckStatus.Pending,
                        "Starting the load generator.");
                }

                // A tier deliberately scaled to nothing is not something to wait for. The incident's
                // own opening state decides what the cache and the canary tier are doing; before
                // activation they are simply off.
                if (workload.Desired <= 0)
                    return Check(
                        $"workload:{name}",
                        name,
                        RankedLaunchCheckStatus.Satisfied,
                        "Present and scaled to zero.");

                return Check(
                    $"workload:{name}",
                    name,
                    workload.Ready >= workload.Desired
                        ? RankedLaunchCheckStatus.Satisfied
                        : RankedLaunchCheckStatus.Pending,
                    $"{workload.Ready}/{workload.Desired} replicas ready.");
            })
            .ToArray();

        if (workloadChecks.Any(check => check.Status != RankedLaunchCheckStatus.Satisfied))
        {
            var pending = workloadChecks
                .Where(check => check.Status != RankedLaunchCheckStatus.Satisfied)
                .Select(check => check.Label);
            return Waiting(
                RankedLaunchPhases.StartingWorkloads,
                $"Waiting for cluster workloads: {string.Join(", ", pending)}.",
                workloadChecks,
                trafficStopped);
        }

        var sampled = readiness.SampledPods >= MinimumSampledPods;
        var serving = readiness.GatewayReporting &&
            readiness.ServedRequestsPerSec >= MinimumServedRequestsPerSec;
        var telemetryChecks = new[]
        {
            Check(
                "metrics",
                "Resource metrics",
                sampled ? RankedLaunchCheckStatus.Satisfied : RankedLaunchCheckStatus.Pending,
                $"{readiness.SampledPods} of at least {MinimumSampledPods} pods sampled."),
            Check(
                "gateway",
                "Gateway telemetry",
                serving ? RankedLaunchCheckStatus.Satisfied : RankedLaunchCheckStatus.Pending,
                readiness.GatewayReporting
                    ? $"Serving {readiness.ServedRequestsPerSec}/s of {readiness.OfferedRequestsPerSec}/s offered."
                    : "The gateway has not answered a scrape yet."),
        };

        if (!sampled || !serving)
            return Waiting(
                RankedLaunchPhases.VerifyingTelemetry,
                sampled
                    ? "Waiting for the gateway to report served traffic."
                    : "Waiting for resource metrics from the disposable cluster.",
                [.. workloadChecks, .. telemetryChecks]);

        return new RankedLaunchGateResult(
            RankedLaunchPhases.ActivatingIncident,
            ReadyToActivate: true,
            Blocker: "",
            Checks: [.. workloadChecks, .. telemetryChecks]);
    }

    private static RankedLaunchGateResult Waiting(
        string phase,
        string blocker,
        IReadOnlyList<RankedLaunchCheck> checks,
        bool trafficStopped = false) =>
        new(phase, ReadyToActivate: false, blocker, checks, trafficStopped);

    private static RankedLaunchCheck Check(
        string id, string label, string status, string detail) =>
        new(id, label, status, detail);
}

/// <summary>
/// How long each phase of a launch may take before the launch is abandoned as failed.
///
/// The budgets are cumulative from the moment the launch opened, so a slow provision does not buy
/// itself extra time to start workloads in. A launch that overruns is marked failed and left
/// unrated; it is never converted into a match the operator would have to forfeit.
/// </summary>
public sealed record RankedLaunchBudget(
    TimeSpan Provisioning,
    TimeSpan StartingWorkloads,
    TimeSpan VerifyingTelemetry,
    TimeSpan ActivatingIncident)
{
    // Ceilings for detecting a launch that is never going to work, not expected durations: a healthy
    // arena provisions in about a minute. They are deliberately well inside the cluster's own TTL,
    // because a launch that consumed the whole window would hand over a match with no time left.
    public static readonly RankedLaunchBudget Default = new(
        TimeSpan.FromMinutes(5),
        TimeSpan.FromMinutes(3),
        TimeSpan.FromMinutes(2),
        TimeSpan.FromMinutes(1));

    /// <summary>Total wall clock a launch may consume before it is failed.</summary>
    public TimeSpan Total =>
        Provisioning + StartingWorkloads + VerifyingTelemetry + ActivatingIncident;

    /// <summary>How long after the launch opened this phase must have finished by.</summary>
    public TimeSpan DeadlineFor(string phase) => phase switch
    {
        RankedLaunchPhases.Provisioning => Provisioning,
        RankedLaunchPhases.StartingWorkloads => Provisioning + StartingWorkloads,
        RankedLaunchPhases.VerifyingTelemetry =>
            Provisioning + StartingWorkloads + VerifyingTelemetry,
        _ => Total,
    };
}

/// <summary>
/// The launch as the front end sees it.
///
/// Deliberately says nothing about which incident was drawn. A launch is observable from the moment
/// it opens, and the drawn incident is not public until the match is live — the existing snapshot
/// contract reveals exactly as much of it as the match's own visibility rules allow, and the debrief
/// reveals the rest only once the attempt is sealed.
/// </summary>
public sealed record RankedLaunchView(
    string LaunchId,
    string RunId,
    string Phase,
    /// <summary>1-based position in <see cref="RankedLaunchPhases.Order"/>; 0 when failed.</summary>
    int Step,
    int Steps,
    string Title,
    string Detail,
    bool Terminal,
    bool Active,
    bool Failed,
    string FailureReason,
    /// <summary>Whether POSTing the launch again (with retry) can safely start over.</summary>
    bool Retryable,
    int LaunchElapsedSeconds,
    int LaunchBudgetSeconds,
    /// <summary>False for every phase before activation. This is the invariant the whole lifecycle
    /// exists to hold: no ranked clock is running until the environment is playable.</summary>
    bool ClockStarted,
    /// <summary>Always 0 before activation.</summary>
    long MatchElapsedMs,
    /// <summary>Empty before activation. The caller's own attempt, never anyone else's.</summary>
    string AttemptId,
    IReadOnlyList<RankedLaunchCheck> Checks);

/// <summary>Transport-shaped result so the endpoint stays a projection and the orchestrator owns
/// every decision about what a caller may see.</summary>
public sealed record RankedLaunchResult(RankedLaunchView? Launch, int Status, string? Error)
{
    public static RankedLaunchResult Ok(RankedLaunchView launch) => new(launch, 200, null);

    public static RankedLaunchResult Fail(int status, string error) => new(null, status, error);
}
