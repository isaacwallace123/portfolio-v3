namespace IsaacWallace.Api.Runs;

// The vocabulary drills are written in.
//
// A drill is a stage list; a stage is a starting state, an objective, and a set of moves. Writing
// that out longhand meant every drill restated the same five paragraphs about what scaling does,
// with small drifts between copies — so a catalog of thirty drills would have thirty slightly
// different explanations of the same lever. Here each lever is defined ONCE, with the reason it
// usually is or is not the answer, and a drill overrides that reason only where its own context
// makes a different point.
//
// Adding a drill should be a dozen readable lines. Everything below exists to make that true.
public static class DrillKit
{
    // ── Cluster state ─────────────────────────────────────────────────────────────────────────
    // Spec fields, named for what they mean rather than for the field they set. Used for a stage's
    // starting conditions and for what a move changes.

    public static (string, object) Checkout(int replicas) => ("apiReplicas", replicas);
    public static (string, object) Canary(int replicas) => ("canaryReplicas", replicas);
    public static (string, object) Gateways(int replicas) => ("gatewayReplicas", replicas);
    public static (string, object) Cache(bool on) => ("cacheReplicas", on ? 1 : 0);
    /// <summary>Generators, each offering a fixed rate — so this is demand, not achieved load.</summary>
    public static (string, object) Traffic(int generators) => ("loadReplicas", generators);
    public static (string, object) Release(string track) => ("releaseTrack", track);
    /// <summary>Named for the tier rather than the field: `Data` collides with the Api.Data namespace.</summary>
    public static (string, object) Catalogue(string state) => ("dataState", state);
    public static (string, object) Pool(string pool) => ("targetPool", pool);
    /// <summary>Restarts the checkout tier. The broker swaps in a fresh token, so it always rolls.</summary>
    public static (string, object) Restart => ("restartToken", ScenarioDefinitions.FreshRestartToken);

    /// <summary>The state every drill starts from unless it says otherwise. Stages state their whole
    /// starting condition rather than inheriting one, so a drill can be read top to bottom without
    /// holding the previous stage in your head.</summary>
    public static (string, object)[] Healthy(int checkout = 3, int traffic = 2) =>
        [Checkout(checkout), Canary(0), Gateways(1), Cache(false), Traffic(traffic),
         Release("stable"), Catalogue("healthy"), Pool("apps")];

    // ── Objectives ────────────────────────────────────────────────────────────────────────────
    // What the platform must measurably be doing for a stage to be over.

    /// <summary>Serve most of what the generators are offering. The goal that makes a drill about
    /// capacity: it cannot be reached by turning the traffic down.</summary>
    public static DrillGoal ServeAll(int generators) =>
        new($"Served load (of {LoadModel.Offered(generators)}/s offered)",
            "throughput", LoadModel.MustServe(generators), "", Below: false);

    public static DrillGoal P95(double ms) => new("p95 latency", "p95", ms, "");
    public static DrillGoal Errors(double pct) => new("Error rate", "errors", pct, "");
    public static DrillGoal AtMostReplicas(int max) => new("Checkout replicas", "replicas", max, "");
    public static DrillGoal OnRelease(string track) => new("Release", "release", 0, track);
    public static DrillGoal DataIs(string state) => new("Catalogue", "data", 0, state);
    public static DrillGoal OnPool(string pool) => new("Worker pool", "pool", 0, pool);
    public static DrillGoal CacheIs(string state) => new("Cache tier", "cache", 0, state);
    public static DrillGoal NoCanary() => new("Canary replicas", "canary", 0, "");
    public static DrillGoal CanaryAtLeast(int n) =>
        new("Canary replicas", "canary", n, "", Below: false);

    // ── Moves ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>One thing an operator can do, defined once with the reason it usually is or is not
    /// the answer. A drill takes it as-is, or re-explains it for a context where the usual reason
    /// does not apply — `.Right(why)` and `.Wrong(why)` exist for exactly that.</summary>
    public sealed record Move(
        string Id,
        string Label,
        string Description,
        IReadOnlyDictionary<string, object> Patch,
        string Why,
        bool Correct,
        int UnlocksAfter = 8,
        // Moves that put this one right again. Every option is REALLY applied to the cluster, so a
        // trap that takes the workload somewhere the stage's own options cannot bring it back from
        // leaves an operator stuck staring at a red objective — in a timed ranked run, that is the
        // drill deciding the result rather than the operator. Checked by Validate(): a move used as
        // a trap must have at least one of its antidotes offered in the same stage.
        //
        // Only traps are checked. A correct move takes the workload TOWARDS the objective, so it
        // never needs a way back.
        IReadOnlyList<string>? Antidotes = null)
    {
        /// <summary>Use this move as a correct answer, with a reason specific to this drill.</summary>
        public Move Right(string why) => this with { Correct = true, Why = why };

        /// <summary>Use this move as a trap, with a reason specific to this drill.</summary>
        public Move Wrong(string why) => this with { Correct = false, Why = why };

        /// <summary>Hold this option back longer, when the point of the stage is to observe first.</summary>
        public Move After(int seconds) => this with { UnlocksAfter = seconds };

        /// <summary>Declare which moves undo this one when it is used as a trap.</summary>
        public Move UndoneBy(params string[] moveIds) => this with { Antidotes = moveIds };

        public ScenarioDecisionDefinition Build() =>
            new(Id, Label, Description, UnlocksAfter, Patch, Correct, Why);
    }

    private static Move Right(
        string id, string label, string description, string why, params (string Key, object Value)[] patch) =>
        new(id, label, description,
            patch.ToDictionary(x => x.Key, x => x.Value, StringComparer.Ordinal), why, true);

    private static Move Wrong(
        string id, string label, string description, string why, params (string Key, object Value)[] patch) =>
        new(id, label, description,
            patch.ToDictionary(x => x.Key, x => x.Value, StringComparer.Ordinal), why, false);

    // Capacity
    public static readonly Move ScaleOut = Right(
        "scale", "Scale checkout to 6 replicas",
        "Add capacity now instead of waiting for an autoscaling window.",
        "Correct. Each replica has its own CPU limit, so replica count is literally how many "
        + "requests a second this tier can finish — the queue drains and measured p95 falls.",
        Checkout(6));

    public static readonly Move ScaleTo4 = Right(
        "scale-4", "Scale checkout to 4 replicas",
        "Add some capacity without committing the whole budget.",
        "Correct as far as it goes. Half-measures are legitimate when you are unsure of the shape "
        + "of the load — just watch whether it was actually enough.",
        Checkout(4));

    public static readonly Move TrimTo2 = Right(
        "trim", "Trim checkout to 2 replicas",
        "Give back the capacity the service is not using.",
        "Correct — this is the objective. Right-sizing is only safe once the per-request cost is low "
        + "enough that the remaining replicas can carry the arriving load.",
        Checkout(2)).UndoneBy("scale", "scale-4");

    public static readonly Move Shrink = Wrong(
        "shrink", "Consolidate onto 1 replica",
        "Fewer, busier pods to cut per-pod overhead.",
        "Wrong. The service is CPU-bound and already saturated; removing replicas removes "
        + "throughput, so arriving requests queue and p95 climbs further.",
        Checkout(1)).UndoneBy("scale", "scale-4");

    // Cache
    public static readonly Move CacheOn = Right(
        "cache", "Enable the response cache",
        "Bring up Redis so repeated catalogue reads skip the work entirely.",
        "Correct, and usually the strongest single move. A cache hit skips the per-request CPU work "
        + "altogether, so the same replicas serve several times the traffic.",
        Cache(true));

    public static readonly Move CacheOff = Wrong(
        "cache-off", "Drop the cache tier",
        "Reclaim the Redis tier's resources for the checkout pods.",
        "Wrong, and expensive. The cache is the reason the current replica count is enough; "
        + "removing it multiplies the work at the worst possible moment.",
        Cache(false)).UndoneBy("cache", "cache-mask");

    // Releases
    public static readonly Move Rollback = Right(
        "rollback", "Roll back to the stable release",
        "Replace the candidate ReplicaSet with the last known-good build.",
        "Correct. The regression is in the candidate's pricing path, so removing that code is the "
        + "only thing that actually restores latency and stops the 5xx.",
        Release("stable"));

    public static readonly Move RollCandidate = Wrong(
        "candidate", "Roll forward to the candidate build",
        "Try the newer image — it is meant to be faster.",
        "Wrong. The candidate carries a regressed pricing path: it is slower per request and fails a "
        + "share of them outright, so it makes every symptom worse.",
        Release("candidate")).UndoneBy("rollback");

    // Data
    public static readonly Move Restore = Right(
        "restore", "Restore from the recovery point",
        "Roll the data tier forward from the scenario's clean snapshot.",
        "Correct. The integrity failures come from the degraded catalogue itself, so restoring the "
        + "data is the only action that removes the source of the errors.",
        Catalogue("recovered"));

    public static readonly Move CacheOverData = Wrong(
        "cache-mask", "Serve the cached catalogue",
        "Shield readers from the degraded data tier.",
        "Wrong on its own. Caching genuinely reduces blast radius during a recovery, but it caches "
        + "the corrupt rows too — you have made the bad data faster to serve and harder to notice.",
        Cache(true));

    // Placement
    public static readonly Move Evacuate = Right(
        "evacuate", "Evacuate to the infra pool",
        "Reconcile the checkout replicas onto the alternate worker pool.",
        "Correct. The workload moves pools while requests keep being served — which works because "
        + "there is enough spare capacity to lose pods to the drain.",
        Pool("infra"));

    public static readonly Move ReturnToApps = Right(
        "move-apps", "Move back to the apps pool",
        "Reconcile the replicas onto the apps worker.",
        "Correct. Coming back is the same operation as leaving, and it deserves the same care.",
        Pool("apps")).UndoneBy("evacuate");

    // Gateway
    public static readonly Move GatewayOut = Right(
        "gateway", "Scale the gateway to 3 replicas",
        "Widen the front door the traffic arrives through.",
        "Correct. Envoy is CPU-limited like every other tier and one replica tops out near 2000 rps. "
        + "Every request queues at the gateway before it is ever forwarded, which is why the backend "
        + "behind it looked idle.",
        Gateways(3));

    public static readonly Move GatewayIn = Wrong(
        "gateway-down", "Cut the gateway back to one replica",
        "Reduce the front-door footprint.",
        "Wrong. Narrowing the front door does not reduce arrivals, it queues them.",
        Gateways(1)).UndoneBy("gateway");

    // Progressive delivery. The canary tier runs the candidate build alongside the stable one, and
    // the split is the replica ratio — which is how a canary actually behaves.
    public static readonly Move CanaryStart = Right(
        "canary-1", "Put the candidate behind one canary replica",
        "Send a small share of live traffic to the new build.",
        "Correct. A canary is how you find out what a build does under real traffic without betting "
        + "the whole service on it — one replica among several is a single-digit share of requests.",
        Canary(1));

    public static readonly Move CanaryGrow = Wrong(
        "canary-3", "Widen the canary to 3 replicas",
        "Give the new build more of the traffic.",
        "Wrong while it is failing. Promoting on hope is how a contained problem becomes an "
        + "incident — widen a canary because its error rate says to, never because you want it to work.",
        Canary(3)).UndoneBy("canary-0");

    public static readonly Move CanaryAbort = Right(
        "canary-0", "Pull the canary",
        "Take the new build back out of the request path.",
        "Correct. The canary did its job: it showed you the regression at a few percent of traffic "
        + "instead of all of it. Pulling it is a success, not a failure.",
        Canary(0));

    // ── Stages and drills ─────────────────────────────────────────────────────────────────────

    /// <summary>One step of a drill. `setup` is applied when the stage BEGINS — for the first stage
    /// that is the opening fault, and for every stage after it that patch is the consequence of
    /// having resolved the one before. `handoff` is what the operator is told when it lands.</summary>
    /// <summary>Everything wrong with the catalog as written. Empty is the only acceptable answer —
    /// Program.cs refuses to start otherwise, because a drill that cannot be finished is worse than
    /// a service that admits it is misconfigured, and a ranked time recorded on one is worthless.
    ///
    /// The checks are the rules a drill has to obey that a compiler cannot express: a stage needs an
    /// objective and a way to reach it, its options have to be distinguishable, and any trap it lays
    /// has to be one the operator can climb back out of.</summary>
    /// <summary>What the checkout tier can actually serve with the cache off, at its maximum of six
    /// replicas.
    ///
    /// Measured on the live platform 2026-07-29: six uncached replicas offered 1000 rps served 724
    /// of it at 965ms p95 — about 120 rps per replica, because every request pays the full
    /// per-request CPU cost. A stage that asks for more than this without making the cache reachable
    /// is asking for throughput the tier cannot produce, and no sequence of correct moves finishes
    /// it. Re-measure if WORK_ITERATIONS or the replica CPU limit changes.</summary>
    public const int UncachedCeilingRps = 700;

    /// <summary>Demand a single uncached fleet can carry while still holding a tight latency target.
    /// Well under the ceiling, because p95 runs away long before throughput flattens.</summary>
    public const int UncachedLowLatencyRps = 450;

    public static IReadOnlyList<string> Problems(IEnumerable<ScenarioDefinition> drills)
    {
        var problems = new List<string>();

        foreach (var drill in drills)
        {
            // Cache state carries across a cascade, so whether a stage can reach it depends on every
            // stage before it as well as its own options.
            var cacheReachable = false;

            for (var i = 0; i < drill.Stages.Count; i++)
            {
                var stage = drill.Stages[i];

                // A stage's own setup overrides whatever the last one left behind.
                if (stage.Setup.TryGetValue("cacheReplicas", out var seeded) && seeded is int seed)
                    cacheReachable = seed > 0;
                // Only a CORRECT move counts as a way to reach the cache. If the sole route to the
                // objective is an option the drill itself calls a mistake, the drill contradicts
                // itself — and in a ranked run, taking it ends the attempt.
                if (stage.Decisions.Any(d =>
                        d.IsCorrect &&
                        d.SpecPatch.TryGetValue("cacheReplicas", out var v) && v is int n && n > 0))
                    cacheReachable = true;

                var demand = stage.Goals
                    .Where(g => g.Metric == "throughput")
                    .Select(g => (int)g.Threshold)
                    .DefaultIfEmpty(0)
                    .Max();
                var tightest = stage.Goals
                    .Where(g => g.Metric == "p95")
                    .Select(g => g.Threshold)
                    .DefaultIfEmpty(double.MaxValue)
                    .Min();

                if (!cacheReachable && demand > UncachedCeilingRps)
                    problems.Add(
                        $"{drill.Id}/{stage.Id}: needs {demand}/s served with no way to reach the " +
                        $"cache, and six uncached replicas top out near {UncachedCeilingRps}/s.");
                else if (!cacheReachable && demand > UncachedLowLatencyRps && tightest <= 250)
                    problems.Add(
                        $"{drill.Id}/{stage.Id}: wants {demand}/s under {tightest:0}ms with no way " +
                        $"to reach the cache; uncached, p95 runs away above ~{UncachedLowLatencyRps}/s.");
                var where = $"{drill.Id}/{stage.Id}";
                var ids = stage.Decisions.Select(d => d.Id).ToArray();
                var offered = ids.ToHashSet(StringComparer.Ordinal);

                if (stage.Goals.Count == 0)
                    problems.Add($"{where}: has no objective, so nothing can end it.");

                if (!stage.Decisions.Any(d => d.IsCorrect))
                    problems.Add($"{where}: offers no correct move.");

                // Options are keyed by id per stage, both for the decision annotation and for the
                // shuffle. Two options sharing one would answer each other.
                foreach (var duplicate in ids.GroupBy(x => x, StringComparer.Ordinal).Where(g => g.Count() > 1))
                    problems.Add($"{where}: option '{duplicate.Key}' is listed twice.");

                // Stage two onwards is a consequence of the stage before it. Without the handover
                // note it reads as the platform being arbitrary rather than as cause and effect.
                if (i > 0 && stage.Handoff.Length == 0)
                    problems.Add($"{where}: a follow-on stage with no handoff note.");

                foreach (var trap in stage.Decisions.Where(d => !d.IsCorrect))
                {
                    var antidotes = Library.GetValueOrDefault(trap.Id)?.Antidotes;
                    if (antidotes is null || antidotes.Count == 0) continue;
                    if (!antidotes.Any(offered.Contains))
                        problems.Add(
                            $"{where}: trap '{trap.Id}' has no way back — offer one of " +
                            $"[{string.Join(", ", antidotes)}] in the same stage.");
                }
            }
        }

        return problems;
    }

    /// <summary>Every move the catalog can draw on, by id — so the validator can look up what undoes
    /// a trap without each drill having to restate it.</summary>
    private static readonly IReadOnlyDictionary<string, Move> Library =
        new[]
        {
            ScaleOut, ScaleTo4, TrimTo2, Shrink, CacheOn, CacheOff, Rollback, RollCandidate,
            Restore, CacheOverData, Evacuate, ReturnToApps, GatewayOut, GatewayIn,
            CanaryStart, CanaryGrow, CanaryAbort,
        }.ToDictionary(m => m.Id, StringComparer.Ordinal);

    public static DrillStage Stage(
        string id,
        string title,
        string objective,
        (string Key, object Value)[] setup,
        DrillGoal[] goals,
        Move[] moves,
        string handoff = "")
    {
        // Last entry wins, so a stage can write `[.. Healthy(), Checkout(1)]` and read as "the usual
        // starting state, but on one replica" instead of restating all eight fields.
        var state = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (var (key, value) in setup) state[key] = value;

        return new DrillStage(
            id, title, objective, handoff, state,
            moves.Select(m => m.Build()).ToArray(),
            goals);
    }

    /// <summary>A drill. One stage is a practice drill; two or more is a ranked cascade.</summary>
    public static ScenarioDefinition Drill(
        string id,
        string title,
        string eyebrow,
        string summary,
        string difficulty,
        int par,
        string objective,
        params DrillStage[] stages) =>
        new(id, title, eyebrow, summary, difficulty, "standard", par, objective,
            stages.Length > 0
                ? stages[0].Setup
                : new Dictionary<string, object>(StringComparer.Ordinal),
            stages);
}
