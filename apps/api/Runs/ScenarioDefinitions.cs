using IsaacWallace.Api.Ranked;
using static IsaacWallace.Api.Runs.DrillKit;
// So a drill can say `Offered(4)` in its brief and quote the rate the generators are actually
// configured for, rather than a number typed out by hand next to a goal that computes its own.
using static IsaacWallace.Api.Runs.LoadModel;

namespace IsaacWallace.Api.Runs;

// What one k6 generator asks the stack for. The script (in the homelab repo's Composition) is an
// open-loop constant-arrival-rate profile, so a generator offers this many requests per second
// whether or not they get served — the load dial is demand, not capacity. Keep this in step with
// `rate:` in manifests/infra/homeops-platform/composition.yaml; the two together are the contract
// every capacity goal is written against.
public static class LoadModel
{
    // 400 rather than 500 because of what the workload measurably does. Six uncached replicas serve
    // about 720 rps, so at 500 per generator two generators already asked for more than the tier can
    // physically produce — every drill that ran two generators without offering the cache was
    // unfinishable. At 400 the ladder matches the platform: one generator is comfortable on a few
    // replicas, two needs most of the fleet, three needs the cache, and four needs the cache and a
    // wider gateway. Keep in step with `rate:` in the homelab repo's composition.
    public const int RequestsPerSecondPerGenerator = 400;

    /// <summary>Requests per second arriving at the gateway with this many generators running.</summary>
    public static int Offered(int generators) => Math.Max(0, generators) * RequestsPerSecondPerGenerator;

    /// <summary>The share of offered load a drill must actually serve to count as keeping up.
    /// Below 1.0 because a live measurement over a two-second window is never exactly the arrival
    /// rate, and a goal that only passes on a perfect sample is a goal that passes by luck.</summary>
    public const double ServedShare = 0.8;

    public static int MustServe(int generators) => (int)(Offered(generators) * ServedShare);
}

public sealed record ScenarioDecisionDefinition(
    string Id,
    string Label,
    string Description,
    int AvailableAfterSeconds,
    IReadOnlyDictionary<string, object> SpecPatch,
    // A drill is a quiz with real consequences: every option is genuinely applied to the running
    // workload, but only some of them actually resolve the incident. Choosing a wrong one is the
    // teaching moment — you watch the measured signals fail to recover, then read why.
    bool IsCorrect = true,
    string Explanation = "");

// What it means to have actually resolved a drill stage, expressed against signals the platform
// measures rather than against which buttons were pressed. A stage is over when the workload is
// genuinely in the target state — that is the whole claim the exercise makes.
//
// Numeric thresholds are calibrated against what this workload measurably does, not against round
// numbers. Saturated at one replica the checkout tier serves ~930ms at p95; with the correct
// interventions applied it settles around 165ms. A 250ms target is therefore comfortably reachable
// by fixing the incident and unreachable by ignoring it — which is the only property that makes it
// a goal rather than decoration. Re-measure these if the workload's shape changes.
public sealed record DrillGoal(
    string Label,
    // p95 | errors | throughput | replicas | release | data | pool | cache | canary
    string Metric,
    // Numeric goals compare against this; state goals ignore it.
    double Threshold,
    // State goals compare the run's spec against this; numeric goals leave it empty.
    string State,
    // Numeric goals only: whether lower is better.
    bool Below = true)
{
    public string TargetText => Metric switch
    {
        "p95" => $"< {Threshold:0} ms",
        "errors" => $"< {Threshold:0.#}%",
        "throughput" => $"> {Threshold:0}/s",
        "replicas" => $"≤ {Threshold:0}",
        "canary" => Below ? $"≤ {Threshold:0}" : $"≥ {Threshold:0}",
        _ => State,
    };
}

// A goal with the run's current value attached, so the page can show progress rather than a verdict.
public sealed record DrillGoalState(
    string Label,
    string Target,
    string Current,
    bool Met);

// One step of a drill.
//
// A single-stage drill is one incident: read the signals, act, done. A multi-stage drill is the
// thing that actually happens on call — the fix works, and the fix is what causes the next problem.
// Each stage brings its own objective and its own decision set, and `Setup` is applied to the live
// workload when the stage BEGINS. For the first stage that is the opening fault; for every stage
// after it, that patch is the consequence of having resolved the one before.
public sealed record DrillStage(
    string Id,
    string Title,
    string Objective,
    // Shown when the stage opens. On stage two onwards this is the handover note that explains what
    // the last fix just caused — without it a cascade reads as the platform being randomly unfair.
    string Handoff,
    IReadOnlyDictionary<string, object> Setup,
    IReadOnlyList<ScenarioDecisionDefinition> Decisions,
    IReadOnlyList<DrillGoal> Goals,
    IReadOnlyDictionary<string, object>? DelayedSetup = null,
    int ActivationDelaySeconds = 0,
    int HoldSeconds = 15);

public sealed record ScenarioDefinition(
    string Id,
    string Title,
    string Eyebrow,
    string Summary,
    string Difficulty,
    string ResourceClass,
    // Not a deadline — drills have none. A reference time, shown next to your own and the field's
    // average so a result has something to mean.
    int ParSeconds,
    string Objective,
    // Applied when a run is created directly against this scenario (the open sandbox does exactly
    // this). A drill starts from its first stage's Setup instead.
    IReadOnlyDictionary<string, object> Setup,
    // Empty for the open sandbox, which has nothing to achieve.
    IReadOnlyList<DrillStage> Stages,
    bool Rated = false)
{
    /// <summary>Multi-stage drills are the ranked pool: one lucky guess cannot carry a cascade, so a
    /// time recorded on one says something about the operator rather than about the draw.</summary>
    public bool IsRanked => Rated || Stages.Count > 1;

    public string Mode => IsRanked ? "ranked" : "practice";
}

// This catalog is the public control plane's allowlist. A caller can choose an id and one of the
// decisions below, but cannot supply an image, command, manifest, namespace, or arbitrary patch.
//
// Everything here is written in the vocabulary from DrillKit: state helpers for the starting
// conditions, goal helpers for the objective, and a shared library of moves that already carry the
// reason they are or are not the answer. A new drill should be a dozen lines and no new prose about
// what scaling does.
public static class ScenarioDefinitions
{
    // The open sandbox a practice cluster runs as when no drill is active. It is a scenario (it seeds
    // the workload) but never a drill: it has no objective clock and no decisions.
    public const string SandboxId = "practice-cluster";

    /// <summary>A spec value the broker replaces with a freshly generated rollout token, so a stage
    /// can restart the checkout tier as part of the problem it introduces.</summary>
    public const string FreshRestartToken = "@restart";

    // A drill is a scenario that layers an objective, a clock, and decisions over a live cluster.
    public static bool IsDrill(string id) =>
        id != SandboxId && Find(id) is { Stages.Count: > 0 };

    public static ScenarioDefinition? Find(string id) =>
        All.TryGetValue(id, out var definition)
            ? definition
            : RankedScenarioCatalog.TryDefinition(id);

    public static IEnumerable<ScenarioDefinition> Drills =>
        All.Values.Where(d => IsDrill(d.Id));

    public static IEnumerable<ScenarioDefinition> RankedDrills =>
        Drills.Where(d => d.IsRanked);

    public static readonly IReadOnlyDictionary<string, ScenarioDefinition> All =
        new[]
        {
            // ══ Practice: one incident, one objective ═════════════════════════════════════════
            // Every request rate a drill states is derived from LoadModel rather than written out.
            // The catalog was authored when a generator offered 500/s; when the platform dropped to
            // 400 the goals followed (they are computed) and the prose did not, so a stage briefed as
            // "2000 requests a second" was scored against 1600 and the operator was reading a number
            // the cluster never produced. Interpolating means the two cannot part company again.
            Drill("checkout-traffic-spike", "Keep checkout alive", "Practice · scaling",
                $"A real checkout workload takes {Offered(2)} requests a second on one replica. Find the capacity.",
                "operator", 90,
                "Serve the offered load with p95 under 250 ms and errors under 1%.",
                Stage("surge", "Absorb the surge",
                    "Serve the offered load with p95 under 250 ms and errors under 1%.",
                    [.. Healthy(traffic: 2), Checkout(1)],
                    [ServeAll(2), P95(250), Errors(1)],
                    [ScaleOut, CacheOn, Shrink,
                     GatewayOut.Wrong(
                        $"Wrong. At {Offered(2)} rps the gateway is fine — the queue is in the single "
                        + "checkout replica behind it.")])),

            Drill("checkout-bad-release", "Ship a bad release", "Practice · releases",
                "A candidate build regressed the pricing path. Trace it and get the stable release back.",
                "operator", 80,
                "Restore the stable release while still serving the offered load.",
                Stage("regression", "Undo the regression",
                    "Get back to the stable release with errors under 1% and p95 under 250 ms.",
                    [.. Healthy(traffic: 1), Release("candidate")],
                    [ServeAll(1), OnRelease("stable"), Errors(1), P95(250)],
                    [Rollback, ScaleOut.Wrong(
                        "Wrong. This is a code regression, not a capacity problem — every new replica "
                        + "runs the same faulty path, so the error rate stays and you have simply spent "
                        + "more CPU on being wrong."),
                     CacheOn.Wrong(
                        "Wrong. Caching masks a fraction of the requests while the broken release stays "
                        + "in production — every cache miss still hits it, and the error budget keeps "
                        + "burning."),
                     GatewayOut.Wrong(
                        "Wrong. The gateway is nowhere near its ceiling at this load; it is faithfully "
                        + "forwarding to a backend that answers slowly and returns 5xx.")])),

            Drill("catalogue-data-recovery", "Recover the data tier", "Practice · data",
                "A disposable catalogue is serving corrupt reads. Restore it and verify from live traffic.",
                "guided", 80,
                "Restore healthy catalogue reads and hold errors under 1%.",
                Stage("degraded", "Restore the catalogue",
                    "Get the catalogue back to recovered with errors under 1%.",
                    [.. Healthy(traffic: 2), Catalogue("degraded")],
                    [ServeAll(2), DataIs("recovered"), Errors(1)],
                    [Restore, ScaleOut.Wrong(
                        "Wrong. The application is healthy; the data underneath it is not. More replicas "
                        + "read the same corrupt catalogue and fail at exactly the same rate."),
                     CacheOverData])),

            Drill("worker-evacuation", "Evacuate a worker", "Practice · scheduling",
                "Move scenario-owned checkout replicas to the alternate worker pool without dropping traffic.",
                "expert", 100,
                "Move checkout to the infra pool without exhausting the request error budget.",
                Stage("evacuate", "Move the fleet",
                    "Land checkout on the infra pool with errors under 1% and p95 under 250 ms.",
                    [.. Healthy(traffic: 1), Checkout(1)],
                    [ServeAll(1), OnPool("infra"), Errors(1), P95(250)],
                    [ScaleOut.Right(
                        "Correct, and the right order. Spare replicas mean the drain can take pods away "
                        + "without the remaining fleet falling below the arriving load."),
                     Evacuate.After(10),
                     Shrink.Wrong(
                        "Wrong. Draining a node with a single replica means a window with no healthy pod "
                        + "at all — this is exactly how a routine migration becomes an outage."),
                     GatewayOut.Wrong(
                        "Wrong tier. The gateway is not what is being drained, and widening it does "
                        + "not help a fleet that is about to lose pods.")])),

            Drill("gateway-saturation", "The queue is at the front door", "Practice · gateway",
                $"{Offered(4)} requests a second against a well-provisioned, cached backend that still cannot keep up.",
                "expert", 100,
                "Serve the offered load. The tier that is saturated is not the one you expect.",
                Stage("gateway", "Find the real bottleneck",
                    "Serve the offered load with p95 under 400 ms and errors under 1%.",
                    [.. Healthy(traffic: 4), Checkout(4), Cache(true)],
                    [ServeAll(4), P95(400), Errors(1)],
                    [GatewayOut.After(10),
                     ScaleOut.Wrong(
                        "Wrong, and the instructive kind of wrong. The backend was never the constraint — "
                        + "look at its CPU. Requests cannot reach the replicas you just added because "
                        + "they are still queued at the gateway."),
                     Shrink.Wrong(
                        "Wrong, and it makes the queue worse: fewer backends behind a gateway that is "
                        + "already the constraint.")])),

            Drill("capacity-right-sizing", "Right-size the fleet", "Practice · cost",
                $"Six replicas for {Offered(1)} requests a second. Cut the fleet to two and still hold the SLO.",
                "operator", 90,
                "Run on at most two checkout replicas while serving the offered load inside the SLO.",
                Stage("trim", "Cut the fleet in three",
                    "Two replicas or fewer, serving the offered load, p95 under 250 ms, errors under 1%.",
                    [.. Healthy(traffic: 1), Checkout(6)],
                    [ServeAll(1), AtMostReplicas(2), P95(250), Errors(1)],
                    [CacheOn.Right(
                        "Correct, and it has to come first. Cutting replicas removes capacity; the cache "
                        + "removes the work. Do it in that order and two replicas are plenty."),
                     TrimTo2.After(10),
                     GatewayOut.Wrong(
                        "Wrong. One gateway carries this load with room to spare, and the objective was "
                        + "to spend less — you have moved the cost rather than removed it."),
                     ScaleOut.Wrong(
                        "Wrong. The objective is to spend less, and this is the button that spends "
                        + "more.")])),

            Drill("release-under-load", "It only breaks under load", "Practice · releases",
                $"The candidate passed every check at low traffic. At {Offered(2)} requests a second it does not.",
                "operator", 90,
                "Get back to the stable release while serving the offered load.",
                Stage("under-load", "Roll it back under traffic",
                    "Stable release, serving the offered load, p95 under 400 ms, errors under 1%.",
                    [.. Healthy(traffic: 2), Release("candidate")],
                    [ServeAll(2), OnRelease("stable"), P95(400), Errors(1)],
                    [Rollback.Right(
                        "Correct. A regression that only shows under load is still a regression — the "
                        + "extra per-request cost is invisible until there is a queue to amplify it."),
                     ScaleOut.Wrong(
                        "Wrong, though it will look like it is working for a moment. You can buy back "
                        + "some latency with capacity, but you are paying twice the CPU to run known bad "
                        + "code, and the error rate never clears."),
                     CacheOn.Wrong(
                        "Wrong. The cache hides the symptom on repeat reads and leaves the regressed "
                        + "release serving every miss."),
                     GatewayOut.Wrong(
                        "Wrong. The gateway is comfortable at this rate; the queue is behind it, in a "
                        + "backend that got slower per request when the candidate shipped.")])),

            Drill("catalogue-cache-mask", "Stop hiding the corruption", "Practice · data",
                "The cache is on, the error rate looks survivable, and the catalogue underneath is still corrupt.",
                "operator", 80,
                "Recover the catalogue itself rather than the symptoms it produces.",
                Stage("masked", "Fix the source",
                    "Catalogue recovered, serving the offered load, errors under 1%.",
                    [.. Healthy(traffic: 2), Catalogue("degraded"), Cache(true)],
                    [ServeAll(2), DataIs("recovered"), Errors(1)],
                    [Restore.Right(
                        "Correct. The objective was never the error rate — it was the data. A cache in "
                        + "front of corrupt rows serves corrupt rows faster."),
                     ScaleOut.Wrong(
                        "Wrong. Six replicas read the same corrupt catalogue. Capacity has never once "
                        + "repaired data."),
                     GatewayOut.Wrong(
                        "Wrong. Every request is getting through. The ones that fail fail at the data "
                        + "tier, which is three hops past the gateway."),
                     Shrink.Wrong(
                        "Wrong. Fewer replicas reading a corrupt catalogue fail at exactly the same "
                        + "rate, just more slowly.")])),

            Drill("pool-return", "Come back from maintenance", "Practice · scheduling",
                "The apps worker is out of maintenance and the fleet is still parked on infra, on one replica.",
                "expert", 100,
                "Return checkout to the apps pool without dropping the traffic it is carrying.",
                Stage("return", "Bring it home",
                    "Checkout on the apps pool, serving the offered load, p95 under 250 ms, errors under 1%.",
                    [.. Healthy(traffic: 1), Checkout(1), Pool("infra")],
                    [ServeAll(1), OnPool("apps"), P95(250), Errors(1)],
                    [ScaleOut.Right(
                        "Correct. A migration is a rolling replacement: the fleet has to be big enough "
                        + "that losing pods to the drain still leaves enough to serve the load."),
                     ReturnToApps.After(10),
                     Shrink.Wrong(
                        "Wrong. It is faster because there is a window with no serving pod at all. Speed "
                        + "is not the objective; staying up during the move is."),
                     GatewayOut.Wrong(
                        "Wrong tier. The gateway does not move between pools and it is not the thing "
                        + "under maintenance.")])),

            Drill("double-fault", "Two things are wrong", "Practice · triage",
                "A regressed release and a corrupt catalogue at the same time. Neither fix alone is enough.",
                "expert", 110,
                "Clear both faults: stable release and a recovered catalogue.",
                Stage("both", "Clear both faults",
                    "Stable release, catalogue recovered, serving the offered load, errors under 1%.",
                    [.. Healthy(traffic: 2), Release("candidate"), Catalogue("degraded")],
                    [ServeAll(2), OnRelease("stable"), DataIs("recovered"), Errors(1)],
                    [Rollback.Right(
                        "Correct, and only half the job. With two independent faults, each one holds the "
                        + "objective open on its own."),
                     Restore.Right(
                        "Correct, and the other half. Real incidents rarely have one cause; the skill is "
                        + "not stopping when the graph first looks better."),
                     ScaleOut.Wrong(
                        "Wrong. Neither fault is a capacity fault. This is the reflex to unlearn: scaling "
                        + "is what you reach for when you have not identified the cause yet."),
                     CacheOverData.Wrong(
                        "Wrong. It caches a regressed response computed from corrupt data, which is the "
                        + "worst of the three states this system can be in.")])),

            Drill("canary-catch", "Catch it in the canary", "Practice · progressive delivery",
                "A canary replica is running the new build and quietly failing a share of live requests.",
                "operator", 80,
                "Get the error rate back inside budget without taking the whole service down.",
                Stage("bleeding", "Contain the bad build",
                    "No canary replicas left in the path, serving the offered load, errors under 1%.",
                    [.. Healthy(traffic: 2), Canary(1)],
                    [ServeAll(2), NoCanary(), Errors(1)],
                    [CanaryAbort.After(10),
                     CanaryGrow,
                     ScaleOut.Wrong(
                        "Wrong. Adding stable replicas dilutes the canary's share of traffic, so the "
                        + "error rate drops a little and the bad build stays in the path. Diluting a "
                        + "fault is not fixing it."),
                     CacheOn.Wrong(
                        "Wrong. The cache serves whatever was computed last, including the canary's "
                        + "responses — now you are serving the bad build's output from memory.")])),

            Drill("canary-and-fleet", "The canary was the least of it", "Practice · progressive delivery",
                "A canary is bleeding errors and the fleet behind it cannot carry the traffic either.",
                "expert", 110,
                "Pull the canary and provision the stable fleet properly.",
                Stage("both", "Contain it, then carry the load",
                    "No canary, serving the offered load, p95 under 400 ms, errors under 1%.",
                    [.. Healthy(traffic: 3), Checkout(1), Canary(1)],
                    [ServeAll(3), NoCanary(), P95(400), Errors(1)],
                    [CanaryAbort, ScaleOut, CacheOn,
                     CanaryGrow.Wrong(
                        "Wrong twice over: the canary is failing, and widening it replaces stable "
                        + "capacity you do not have to spare.")])),

            Drill("canary-first", "Test it the safe way", "Practice · progressive delivery",
                "A new build is waiting and everyone wants it out. There is a way to try it that is not all at once.",
                "guided", 80,
                "Get the new build in front of real traffic without putting it in front of all of it.",
                Stage("slice", "Ship it to a slice",
                    "The candidate serving a share of traffic, the fleet still on stable, errors under 3%.",
                    [.. Healthy(checkout: 6, traffic: 2)],
                    [ServeAll(2), OnRelease("stable"), CanaryAtLeast(1), Errors(3)],
                    [CanaryStart.After(10),
                     Rollback.Right(
                        "Correct if you rolled the whole fleet forward a moment ago. The objective is "
                        + "to expose the build to a slice of traffic, not to everyone."),
                     RollCandidate.Wrong(
                        "Wrong, and it is the exact habit the canary tier exists to replace. That is a "
                        + "full rollout: every request now meets code nobody has watched under load."),
                     ScaleOut.Wrong(
                        "Wrong. The fleet is already six replicas and the traffic is comfortable — "
                        + "capacity was never the question here.")])),

            Drill("cold-start-storm", "Everything restarted at once", "Practice · rollouts",
                "The fleet just rolled, came back as one replica, and the queued traffic is arriving together.",
                "operator", 90,
                "Recover from a full restart under load.",
                Stage("storm", "Drain the backlog",
                    "Serve the offered load with p95 under 400 ms and errors under 1%.",
                    [.. Healthy(traffic: 3), Checkout(1), Restart],
                    [ServeAll(3), P95(400), Errors(1)],
                    [ScaleOut, CacheOn.Right(
                        "Correct, and faster-acting than replicas: cached responses skip the work "
                        + "entirely while the new pods are still starting."),
                     Shrink.Wrong(
                        "Wrong. Arrival rate does not care that you are waiting — the backlog grows for "
                        + "as long as one replica cannot finish the traffic."),
                     GatewayOut.Wrong(
                        "Wrong. The gateway is keeping up; the backlog is behind it, in a fleet that "
                        + "has just restarted.")])),

            Drill("front-and-back", "Both ends are tight", "Practice · capacity",
                $"{Offered(3)} requests a second arriving at one gateway, in front of one checkout replica.",
                "expert", 110,
                "Serve the offered load. Neither tier alone is enough.",
                Stage("both-ends", "Widen both ends",
                    "Serve the offered load with p95 under 400 ms and errors under 1%.",
                    [.. Healthy(traffic: 3), Checkout(1), Gateways(1)],
                    [ServeAll(3), P95(400), Errors(1)],
                    [ScaleOut, CacheOn, GatewayOut.After(12),
                     Shrink.Wrong(
                        "Wrong. Both tiers are already too small for the traffic; making one of them "
                        + "smaller is the wrong direction twice over.")])),

            // ══ Ranked: cascades, where the fix causes the next incident ══════════════════════
            Drill("cascade-scale-release", "The fix that shipped itself", "Ranked · cascade",
                "Scale out of a surge, and find out what the new replicas brought with them.",
                "operator", 260,
                "Work a three-incident cascade back to a stable, healthy, well-served checkout.",
                Stage("surge", "Absorb the surge",
                    "Serve the offered load with p95 under 250 ms and errors under 1%.",
                    [.. Healthy(traffic: 2), Checkout(1)],
                    [ServeAll(2), P95(250), Errors(1)],
                    [ScaleOut, CacheOn, GatewayOut.Wrong(
                        $"Wrong. At {Offered(2)} rps the gateway is fine. The queue is in the single "
                        + "checkout replica behind it."),
                     Shrink]),
                Stage("shipped", "Undo what the scale-up shipped",
                    "Get back to the stable release while still serving the offered load.",
                    [Release("candidate")],
                    [ServeAll(2), OnRelease("stable"), P95(250), Errors(1)],
                    [Rollback.Right(
                        "Correct. This is why deployments pin digests: a scale-up should never be able "
                        + "to change which code is running."),
                     ScaleOut.Wrong(
                        "Wrong. Every replica you add runs the same regressed path — you are scaling the "
                        + "incident."),
                     CacheOn.Wrong(
                        "Wrong. Misses still reach the bad build, and now the cache is holding responses "
                        + "that build computed."),
                     GatewayOut.Wrong(
                        "Wrong. The front door is not what changed between the last graph and this one.")],
                    handoff:
                        "The new replicas came up on the floating tag — and the newest image on that tag "
                        + "is the candidate build nobody promoted. You scaled a regression into "
                        + "production. Latency is back and now it is returning 5xx."),
                Stage("aftermath", "Clean up what it wrote",
                    "Recover the catalogue and hold errors under 1%.",
                    [Catalogue("degraded")],
                    [ServeAll(2), DataIs("recovered"), Errors(1)],
                    [Restore.Right(
                        "Correct. A rollback is only complete when the data the bad release touched is "
                        + "readable by the good one."),
                     CacheOverData.Wrong(
                        "Wrong, and tempting. Caching hides how many reads are failing without "
                        + "repairing a single row — and it is the corrupt rows you would be caching."),
                     ScaleOut.Wrong("Wrong. The reads are not slow, they are failing.")],
                    handoff:
                        "The stable build is back, and it cannot read the catalogue rows the candidate "
                        + "wrote while it was live. Rolling code back is easy; rolling data back is the "
                        + "part that makes people careful about the first one.")),

            Drill("cascade-cost-surge", "Trim the fleet, then hold the line", "Ranked · cascade",
                "Right-size for the quiet period, then meet month-end traffic on what you left yourself.",
                "expert", 280,
                "Cut the fleet, survive the surge that follows, and migrate it while it is carrying load.",
                Stage("trim", "Cut the fleet in three",
                    "Two replicas or fewer, serving the offered load, p95 under 250 ms, errors under 1%.",
                    [.. Healthy(traffic: 1), Checkout(6)],
                    [ServeAll(1), AtMostReplicas(2), P95(250), Errors(1)],
                    [CacheOn.Right(
                        "Correct, and it must come first. Remove the work, then remove the capacity that "
                        + "was doing it."),
                     TrimTo2.After(10),
                     GatewayOut.Wrong(
                        "Wrong, and expensive. This is a cost objective; you have added three CPU limits' "
                        + "worth of gateway to a stack that was not queuing."),
                     ScaleOut.Wrong(
                        "Wrong. This is a cost objective and that is the button that spends more.")]),
                Stage("surge", "Meet month-end on a trimmed fleet",
                    "Serve the offered load with p95 under 400 ms and errors under 1%.",
                    [Traffic(4)],
                    [ServeAll(4), P95(400), Errors(1)],
                    [ScaleOut.Right(
                        "Correct. Right-sizing is not a one-way door — it is a bet on demand, and this is "
                        + "what it looks like to be wrong about demand and recover quickly."),
                     GatewayOut.After(10),
                     TrimTo2.Wrong(
                        "Wrong now, though it was right an hour ago. Right-sizing is a bet on demand, "
                        + "and demand is four times what it was when you placed that bet."),
                     Shrink.Wrong(
                        "Wrong, and the fastest way to turn a surge into an outage.")],
                    handoff:
                        $"It is the last day of the month. Offered traffic just went from {Offered(1)} "
                        + $"to {Offered(4)} requests a second — against the two replicas you very "
                        + "sensibly left yourself an hour ago."),
                Stage("migrate", "Migrate it under full load",
                    "Land checkout on the infra pool while still serving the offered load.",
                    [],
                    [ServeAll(4), OnPool("infra"), Errors(1)],
                    [Evacuate.Right(
                        "Correct. It works because you are moving a fleet with headroom — the same move "
                        + "on two replicas would have dropped traffic."),
                     ScaleOut.Wrong(
                        "Wrong. Capacity is not the constraint — you have plenty of it. The worker "
                        + "underneath it is what is going away."),
                     // Not "the gateway is not scheduled on the drained worker": the gateway has no
                     // nodeSelector, so it may well be sitting on that worker, and the drills must not
                     // assert placement the platform does not pin.
                     GatewayOut.Wrong(
                        "Wrong tier. The gateway is not what is being drained, and widening it does not "
                        + "help a fleet that is about to lose pods.")],
                    handoff:
                        "The apps worker has to be drained for firmware — now, not after month-end. Move "
                        + $"the fleet to infra while it is carrying {Offered(4)} requests a second.")),

            Drill("cascade-recovery-regression", "Restore it, then prove it", "Ranked · cascade",
                "A data recovery that pins you to the build that caused it, and a rollout that arrives all at once.",
                "expert", 260,
                "Recover the data, get off the bad build, and survive the restart it triggers.",
                Stage("degraded", "Restore the catalogue",
                    "Catalogue recovered, serving the offered load, errors under 1%.",
                    [.. Healthy(traffic: 1), Catalogue("degraded")],
                    [ServeAll(1), DataIs("recovered"), Errors(1)],
                    [Restore, ScaleOut.Wrong("Wrong. Capacity does not repair data."), CacheOverData]),
                Stage("pinned", "Get off the build that wrote them",
                    "Back to the stable release, still serving the offered load.",
                    [Release("candidate")],
                    [ServeAll(1), OnRelease("stable"), P95(250), Errors(1)],
                    [Rollback.Right(
                        "Correct. A recovery is not finished while the thing that caused it is still "
                        + "serving traffic."),
                     ScaleOut.Wrong("Wrong. More of a bad build is more bad build."),
                     CacheOn.Wrong(
                        "Wrong, and circular — caching responses from the build you are trying to remove "
                        + "is how you got the corrupt rows in the first place.")],
                    handoff:
                        "The recovery point was taken while the candidate was live, so restoring it "
                        + "pinned checkout to the build that wrote those rows. Your data is clean and "
                        + "you are now running the release that corrupted it."),
                Stage("thundering", "Survive the restart you just caused",
                    "Serve the offered load with p95 under 400 ms and errors under 1%.",
                    [Checkout(1), Traffic(3), Restart],
                    [ServeAll(3), P95(400), Errors(1)],
                    [ScaleOut, CacheOn.Right(
                        "Correct, and faster-acting than replicas: cached responses skip the work "
                        + "entirely while the new pods are still starting."),
                     GatewayOut.Wrong(
                        "Wrong. The gateway is not the queue here — one checkout replica is."),
                     Shrink.Wrong(
                        "Wrong. Arrival rate does not care that you are waiting — the backlog grows for "
                        + $"as long as one replica cannot finish {Offered(3)} requests a second.")],
                    handoff:
                        "The rollback restarted every replica at once, the fleet came back as one pod, "
                        + "and the traffic that queued behind the rollout is arriving together. This is "
                        + "the part of a rollback nobody puts in the runbook.")),

            Drill("cascade-evacuation", "Move it without dropping it", "Ranked · cascade",
                "Migrate the fleet to another worker, then deal with everything the migration left behind.",
                "expert", 220,
                "Complete a migration and keep it complete while the consequences arrive.",
                Stage("evacuate", "Move the fleet",
                    "Checkout on the infra pool, serving the offered load, p95 under 250 ms, errors under 1%.",
                    [.. Healthy(traffic: 1), Checkout(1)],
                    [ServeAll(1), OnPool("infra"), P95(250), Errors(1)],
                    [ScaleOut.Right("Correct. Headroom first, migration second."),
                     Evacuate.After(10), Shrink,
                     GatewayOut.Wrong(
                        "Wrong tier. Widening the front door does not help a fleet that is about to "
                        + "lose pods to a drain.")]),
                Stage("left-behind", "Hold the new pool",
                    "Stay on infra, serve the increased load, p95 under 400 ms, errors under 1%.",
                    [Cache(false), Traffic(3)],
                    [ServeAll(3), OnPool("infra"), P95(400), Errors(1)],
                    [CacheOn.Right(
                        "Correct. A migration is not finished when the pods land — it is finished when "
                        + "everything they depended on has come with them."),
                     GatewayOut.Right(
                        "Correct as support. Not the main constraint here, but it takes real queuing off "
                        + "the front door while the cache warms."),
                     CacheOff.Wrong(
                        "Wrong, and it is the exact tier the migration has already cost you once."),
                     GatewayIn.Wrong(
                        "Wrong direction. Narrowing the front door under raised load queues requests "
                        + "rather than reducing them.")],
                    handoff:
                        "The move left the warm cache tier behind on the old pool, and traffic followed "
                        + $"you over — {Offered(3)} requests a second now, all of them missing. Note the "
                        + "objective: you have to stay on infra. Undoing the migration is not a fix.")),

            Drill("cascade-canary", "The canary earned its keep", "Ranked · cascade",
                "A canary catches a bad build, and then you find out what it cost you to have it there.",
                "expert", 260,
                "Contain a bad canary, carry the load it was taking, and repair what it wrote.",
                Stage("bleeding", "Contain the bad build",
                    "No canary replicas left in the path, serving the offered load, errors under 1%.",
                    [.. Healthy(traffic: 2), Checkout(2), Canary(1)],
                    [ServeAll(2), NoCanary(), Errors(1)],
                    [CanaryAbort.After(10), CanaryGrow,
                     ScaleOut.Wrong(
                        "Wrong. Adding stable replicas dilutes the canary's share of traffic, so the "
                        + "error rate drops a little and the bad build stays in the path."),
                     CacheOn.Wrong(
                        "Wrong. The cache serves whatever was computed last, including the canary's "
                        + "responses.")]),
                Stage("short", "Carry what the canary was carrying",
                    "Serve the offered load with p95 under 400 ms and errors under 1%.",
                    [Traffic(3)],
                    [ServeAll(3), NoCanary(), P95(400), Errors(1)],
                    [ScaleOut, CacheOn,
                     Shrink.Wrong(
                        "Wrong. Two replicas are already short of this traffic; one will not cover it."),
                     GatewayOut.Wrong(
                        $"Wrong. The gateway is comfortable at {Offered(3)} rps — the shortfall is "
                        + "behind it.")],
                    handoff:
                        "Pulling the canary took a replica's worth of capacity out of the fleet, and the "
                        + "evening peak arrived while you were doing it. Two replicas are now carrying "
                        + $"{Offered(3)} requests a second."),
                Stage("wrote", "Repair what it wrote",
                    "Catalogue recovered, serving the offered load, errors under 1%.",
                    [Catalogue("degraded")],
                    [ServeAll(3), DataIs("recovered"), Errors(1)],
                    [Restore.Right(
                        "Correct. A canary limits how much traffic a bad build touches — it does not "
                        + "limit what that traffic wrote."),
                     CacheOverData.Wrong(
                        "Wrong. Caching the corrupt rows makes them faster to serve, not repaired."),
                     ScaleOut.Wrong("Wrong. The reads are not slow, they are failing.")],
                    handoff:
                        "Small share of traffic, real writes. The rows the canary wrote in its few "
                        + "minutes of life are unreadable to the stable build, and they are in the same "
                        + "catalogue as everything else.")),

            Drill("cascade-gateway-peak", "Front door, back door, and the bill", "Ranked · cascade",
                "Peak arrives at a single gateway; clearing it exposes the tier behind, and then finance calls.",
                "expert", 300,
                "Clear a gateway bottleneck, then a backend one, then give the capacity back.",
                Stage("front", "Clear the front door",
                    "Serve the offered load with p95 under 400 ms and errors under 1%.",
                    [.. Healthy(traffic: 4), Checkout(4), Cache(true), Gateways(1)],
                    [ServeAll(4), P95(400), Errors(1)],
                    [GatewayOut.After(10),
                     ScaleOut.Wrong(
                        "Wrong. The backend is cached and half idle — the requests are queued in front "
                        + "of it, not behind it."),
                     Shrink.Wrong(
                        "Wrong. The backend is not the constraint, and making it smaller adds a second "
                        + "one behind the first.")]),
                Stage("back", "Now the tier behind it",
                    "Serve the offered load with p95 under 400 ms and errors under 1%.",
                    [Cache(false), Checkout(2)],
                    [ServeAll(4), P95(400), Errors(1)],
                    [ScaleOut, CacheOn,
                     GatewayOut.Wrong(
                        "Wrong. You already fixed the gateway; it is not the constraint twice."),
                     GatewayIn.Wrong(
                        "Wrong. You widened the gateway for a reason; narrowing it now just moves the "
                        + "queue back to the front door.")],
                    handoff:
                        $"With the gateway widened, {Offered(4)} requests a second are reaching the "
                        + "backend for the first time — and the cache tier evicted itself under the "
                        + "sudden miss storm. The queue moved rather than disappeared."),
                Stage("bill", "Give the capacity back",
                    "Two replicas or fewer, still serving the offered load, errors under 1%.",
                    [Traffic(1)],
                    [ServeAll(1), AtMostReplicas(2), P95(250), Errors(1)],
                    [TrimTo2, CacheOn.Right(
                        "Correct if you dropped it earlier — cheap requests are what make a small fleet "
                        + "safe."),
                     ScaleOut.Wrong(
                        $"Wrong. The objective is to spend less; six replicas for {Offered(1)} requests "
                        + "a second is the thing you were asked to stop doing."),
                     Shrink.Wrong(
                        $"Wrong. One replica cannot hold the SLO even at {Offered(1)} a second — the "
                        + "objective says two, and two is not the same as as few as possible.")],
                    handoff:
                        $"Peak is over — traffic is back to {Offered(1)} a second and someone has noticed "
                        + "what the weekend cost. Hand the capacity back without giving up the SLO.")),

            Drill("cascade-full-sev", "Full sev, four moves", "Ranked · cascade",
                "Peak traffic, a bad release, corrupt data, and a worker drain — in that order, on one cluster.",
                "expert", 400,
                $"Four consecutive incidents at {Offered(4)} requests a second. The hardest thing in the catalog.",
                Stage("peak", $"Take {Offered(4)} a second on one replica",
                    "Serve the offered load with p95 under 400 ms and errors under 1%.",
                    [.. Healthy(traffic: 4), Checkout(1)],
                    [ServeAll(4), P95(400), Errors(1)],
                    [ScaleOut.Right("Correct, and not sufficient on its own at this rate."),
                     CacheOn.Right(
                        $"Correct. At {Offered(4)} rps you need the work to be cheaper, not just more "
                        + "widely distributed."),
                     GatewayOut.After(12).Right(
                        "Correct, and the one people miss. One Envoy tops out near 2000 rps — at peak the "
                        + "front door is a tier like any other."),
                     Shrink.Wrong(
                        $"Wrong. At {Offered(4)} requests a second one replica is not a consolidation, "
                        + "it is an outage.")]),
                Stage("release", "The release you did not ship",
                    "Stable release, still serving the offered load.",
                    [Release("candidate")],
                    [ServeAll(4), OnRelease("stable"), P95(400), Errors(1)],
                    [Rollback.Right(
                        "Correct. Rolling back at peak is frightening and still right — the alternative "
                        + "is burning budget for as long as you hesitate."),
                     ScaleOut.Wrong("Wrong. You are already at six replicas; there is nothing to add."),
                     Shrink.Wrong(
                        "Wrong. You need every replica you have — this is peak.")],
                    handoff:
                        "While you were scaling, the release train ran. The candidate is live at peak and "
                        + "the error budget for the quarter is going with it."),
                Stage("data", "What it wrote while it was live",
                    "Catalogue recovered, still serving the offered load.",
                    [Catalogue("degraded")],
                    [ServeAll(4), DataIs("recovered"), Errors(1)],
                    [Restore,
                     CacheOverData.Wrong(
                        "Wrong. A cache over corrupt rows hides the symptom and repairs nothing — this "
                        + "is how incidents get their second act."),
                     ScaleOut.Wrong(
                        "Wrong. The reads are not slow, they are failing, and six replicas fail them "
                        + "just as fast as five.")],
                    handoff:
                        "Twelve minutes of the candidate at peak wrote a lot of rows. The stable build "
                        + "cannot read them, and every one of those reads is a 5xx."),
                Stage("drain", "And the worker is going down",
                    "Checkout on the infra pool, still serving the offered load.",
                    [],
                    [ServeAll(4), OnPool("infra"), Errors(1)],
                    [Evacuate.Right(
                        "Correct — and it only works because everything you did in the first three "
                        + "stages left this fleet with the headroom to survive a rolling move."),
                     ScaleOut.Wrong(
                        "Wrong. You are already at six: nothing left to add, and nothing to add it for."),
                     GatewayOut.Wrong(
                        "Wrong tier. The gateway is not the thing being drained.")],
                    handoff:
                        "The apps worker threw a correctable-memory alert during all of this and has to "
                        + "be drained now. Move a fully committed fleet at peak, without dropping the "
                        + "traffic.")),

            // ══ The open sandbox ══════════════════════════════════════════════════════════════
            new ScenarioDefinition(
                SandboxId,
                "Practice cluster",
                "Open sandbox",
                "A disposable Kubernetes workspace with a checkout API, a canary tier, Postgres, Redis, an Envoy gateway, and optional k6 traffic.",
                "open",
                "standard",
                900,
                "Experiment safely, observe real reconciliation, then tear the workspace down.",
                // One replica, no cache, no traffic: the sandbox starts at the smallest thing that
                // serves a request, so every control the page offers has somewhere to go and its
                // effect is visible against a baseline you chose rather than one already half set.
                new Dictionary<string, object>(StringComparer.Ordinal)
                {
                    ["apiReplicas"] = 1,
                    ["canaryReplicas"] = 0,
                    ["cacheReplicas"] = 0,
                    ["releaseTrack"] = "stable",
                    ["dataState"] = "healthy",
                    ["targetPool"] = "apps",
                    ["loadReplicas"] = 0,
                    ["gatewayReplicas"] = 1,
                },
                []),
        }.ToDictionary(s => s.Id, StringComparer.Ordinal);

    // Judge a stage against what the cluster is actually doing. Every goal must hold at once — the
    // served-load goal is what stops an idle cluster from passing a latency target by serving
    // nothing, and what makes "turn the traffic down" a non-answer.
    public static IReadOnlyList<DrillGoalState> Evaluate(
        DrillStage stage, RunTelemetry t, LabRunSpec spec) =>
        stage.Goals.Select(g =>
        {
            var (current, met) = g.Metric switch
            {
                // Whether the p95 is trustworthy is a question about the SAMPLE, not about the
                // number: a windowed scrape reports nothing mid-rollout, when the old pods have
                // gone and the new ones have not served anything yet, and treating that as
                // excellent is how a saturated cluster briefly looked healthy enough to finish a
                // drill. Requiring p95 > 0 was the wrong way to ask it — a cache hit skips the
                // request's CPU work entirely, so a well-cached run really does sit under Envoy's
                // smallest bucket, and the check rejected the single best move in the catalog.
                // Served traffic is the honest test: if requests are completing, the latency they
                // completed in is real, however small.
                "p95" => (FormatMs(t.P95LatencyMs),
                    t.RequestsPerSec > 0 && t.P95LatencyMs < g.Threshold),
                "errors" => ($"{t.ErrorRatePct:0.00}%", t.ErrorRatePct < g.Threshold),
                "throughput" => ($"{t.RequestsPerSec}/s", t.RequestsPerSec > g.Threshold),
                "replicas" => ($"{spec.ApiReplicas ?? 1}", (spec.ApiReplicas ?? 1) <= g.Threshold),
                "canary" => ($"{spec.CanaryReplicas ?? 0}", g.Below
                    ? (spec.CanaryReplicas ?? 0) <= g.Threshold
                    : (spec.CanaryReplicas ?? 0) >= g.Threshold),
                "release" => (spec.ReleaseTrack ?? "", spec.ReleaseTrack == g.State),
                "data" => (spec.DataState ?? "", spec.DataState == g.State),
                "pool" => (spec.TargetPool ?? "", spec.TargetPool == g.State),
                "cache" => ((spec.CacheReplicas ?? 0) > 0 ? "on" : "off",
                    ((spec.CacheReplicas ?? 0) > 0 ? "on" : "off") == g.State),
                _ => ("", false),
            };
            return new DrillGoalState(g.Label, g.TargetText, current, met);
        }).ToArray();

    /// <summary>Sub-millisecond latencies keep their decimal place; everything else is whole
    /// milliseconds. "0.4 ms" is a result, "0 ms" looks like a broken gauge.</summary>
    private static string FormatMs(double ms) =>
        ms < 10 ? $"{ms:0.#} ms" : $"{ms:0} ms";
}
