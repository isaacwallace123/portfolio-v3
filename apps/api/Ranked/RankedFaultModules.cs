using IsaacWallace.Api.Runs;
using static IsaacWallace.Api.Runs.DrillKit;

namespace IsaacWallace.Api.Ranked;

/// <summary>
/// One audited way this platform can be broken.
///
/// A module is not a script. It is a claim about the cluster: these spec dials produce this failure,
/// these measured signals reveal it, these moves genuinely resolve it, and these ones look like they
/// might and do not. Every dial named here is one the LabRun already has and the Composition already
/// honours — the generator invents incidents, never capabilities.
///
/// Two rules make combination safe rather than hopeful. A module declares the spec keys it DRIVES, so
/// two modules cannot quietly fight over one dial; and it declares the state it needs to be a real
/// incident, so a fault that is only visible at 1200 requests a second is never placed in a match
/// that offers 400. Everything the compatibility check does falls out of those two declarations.
/// </summary>
public sealed record RankedFaultModule(
    string Id,
    /// <summary>Recency is excluded by family, not by module: an operator who just worked a cache
    /// incident has practised cache reasoning whichever dial produced it.</summary>
    string Family,
    string Label,
    /// <summary>What the operator is told the symptom is, when the plan is generous enough to name
    /// it. Never a diagnosis — "checkout is queuing" is a reading, "one replica cannot serve the
    /// arriving load" is the answer.</summary>
    string Symptom,
    /// <summary>The root cause, in full. Debrief only: this is the sentence that would turn the
    /// match into a reading exercise if it were shown at the start.</summary>
    string Diagnosis,
    /// <summary>Spec the fault applies. Keyed by the LabRun dial it drives.</summary>
    IReadOnlyDictionary<string, object> Setup,
    /// <summary>Objectives this fault adds beyond the phase's capacity targets. State goals, so
    /// resolving the fault is measured against the workload rather than against a button.</summary>
    IReadOnlyList<DrillGoal> Goals,
    IReadOnlyList<Move> Correct,
    IReadOnlyList<Move> Traps,
    // ── What this module needs to be a genuine incident ──────────────────────────────────────
    int MinCheckout,
    int MaxCheckout,
    int MinGenerators,
    int MaxGenerators,
    /// <summary>True when the fault only means something on a cached stack (you cannot lose a cache
    /// you never had; a gateway is only the visible constraint when the tier behind it has headroom).
    /// Null when the module does not care.</summary>
    bool? RequiresCache,
    /// <summary>Modules this one must never be combined with for a reason the declarations above
    /// cannot express. Symmetric — the check tries both orders.</summary>
    IReadOnlyList<string> IncompatibleWith)
{
    public IEnumerable<string> DrivenKeys => Setup.Keys;
}

public static class RankedFaultModules
{
    public const string CapacityFamily = "capacity";
    public const string GatewayFamily = "gateway";
    public const string CacheFamily = "cache";
    public const string ReleaseFamily = "release";
    public const string CanaryFamily = "canary";
    public const string DataFamily = "data";
    public const string PlacementFamily = "placement";

    private static IReadOnlyDictionary<string, object> Spec(params (string Key, object Value)[] pairs) =>
        pairs.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);

    /// <summary>
    /// The audited catalog. Seven modules over seven families, which is what the platform can
    /// currently produce honestly — the ladder's variety comes from how they are combined, timed,
    /// instrumented, and scored, not from a longer list of prose.
    /// </summary>
    public static readonly IReadOnlyList<RankedFaultModule> All =
    [
        // ── Saturation of the tier that does the work ────────────────────────────────────────
        new RankedFaultModule(
            "checkout-saturation",
            CapacityFamily,
            "Checkout saturation",
            "Checkout is queuing: requests are arriving faster than the tier finishes them.",
            "The checkout tier is CPU-bound and running on a single replica, so replica count is "
            + "literally how many requests a second it can complete. The queue in front of it is "
            + "what the latency graph is showing.",
            Spec(Checkout(1)),
            [],
            [ScaleOut, CacheOn],
            [Shrink],
            MinCheckout: 1, MaxCheckout: 1,
            // Two generators is where a single replica measurably falls over; four is the most the
            // platform offers, and one replica is hopeless at any of them.
            MinGenerators: 2, MaxGenerators: 4,
            RequiresCache: null,
            IncompatibleWith: []),

        // ── Saturation of the front door ─────────────────────────────────────────────────────
        new RankedFaultModule(
            "gateway-saturation",
            GatewayFamily,
            "Gateway saturation",
            "Requests are slow to be answered while the checkout tier reads as comfortable.",
            "Envoy is CPU-limited like every other tier and one replica tops out near 2000 rps. "
            + "Every request queues at the gateway before it is ever forwarded, which is exactly "
            + "why the backend behind it looks idle while p95 climbs.",
            Spec(Gateways(1)),
            [],
            [GatewayOut],
            [GatewayIn],
            // The point of this fault is that the tier behind the gateway is NOT the constraint. On
            // a small fleet the operator would be right to scale checkout, and the incident would be
            // teaching the wrong lesson — so it requires headroom behind the door.
            MinCheckout: 4, MaxCheckout: 6,
            MinGenerators: 3, MaxGenerators: 4,
            RequiresCache: true,
            IncompatibleWith: []),

        // ── Loss of the tier that makes the work cheap ───────────────────────────────────────
        new RankedFaultModule(
            "cache-loss",
            CacheFamily,
            "Cache tier lost",
            "Every read is suddenly doing full work again.",
            "The response cache is gone, so requests that were skipping the per-request CPU cost "
            + "entirely are now paying it. The fleet did not shrink; the work per request grew.",
            Spec(Cache(false)),
            [],
            [CacheOn],
            [CacheOff],
            // A fleet at six has nothing left to add, so losing the cache would be unrecoverable
            // rather than hard.
            MinCheckout: 2, MaxCheckout: 5,
            MinGenerators: 2, MaxGenerators: 3,
            // You cannot lose a cache you never had.
            RequiresCache: true,
            IncompatibleWith: []),

        // ── The build nobody promoted ────────────────────────────────────────────────────────
        new RankedFaultModule(
            "bad-stable-release",
            ReleaseFamily,
            "Bad release on the stable track",
            "Errors and latency both stepped up at the same instant.",
            "The candidate build is serving all of the traffic: its pricing path is slower per "
            + "request and fails a share of them outright. A simultaneous step in two unrelated "
            + "signals is what a code change looks like.",
            Spec(Release("candidate")),
            [OnRelease("stable")],
            [Rollback],
            [RollCandidate],
            MinCheckout: 2, MaxCheckout: 6,
            MinGenerators: 1, MaxGenerators: 4,
            RequiresCache: null,
            // A canary IS the candidate build on a few replicas. Running both makes "which code is
            // serving this request" ambiguous, and the two objectives collapse into one thought.
            IncompatibleWith: ["bad-canary-under-load"]),

        // ── The build you were careful about ─────────────────────────────────────────────────
        new RankedFaultModule(
            "bad-canary-under-load",
            CanaryFamily,
            "Canary failing under live traffic",
            "A minority of requests are failing while the rest are healthy.",
            "The canary replica runs the candidate build beside the stable fleet and shares the "
            + "gateway's backend pool, so the bad build's share of traffic is its share of the "
            + "replicas. A single-digit error rate that will not come down is a share, not a rate.",
            Spec(Canary(1)),
            [NoCanary()],
            [CanaryAbort],
            [CanaryGrow],
            MinCheckout: 2, MaxCheckout: 5,
            MinGenerators: 2, MaxGenerators: 4,
            RequiresCache: null,
            IncompatibleWith: ["bad-stable-release"]),

        // ── The worker underneath it all ─────────────────────────────────────────────────────
        new RankedFaultModule(
            "worker-pressure",
            PlacementFamily,
            "Worker pool must be vacated.",
            "The apps worker has to be drained now, and the fleet is on it.",
            "Scheduling pressure is not a capacity problem: the pods are healthy and the node they "
            + "are on is going away. A rolling move only keeps serving if the fleet has enough "
            + "headroom to lose pods to the drain, which is why capacity comes first.",
            // No dial of its own — the fault is the requirement to be somewhere else, and the
            // objective is what makes it real.
            Spec(),
            [OnPool("infra")],
            // Headroom first, migration second. ScaleOut is also what makes the consolidation trap
            // below survivable, which the catalog validator checks.
            [Evacuate, ScaleOut],
            [Shrink],
            MinCheckout: 2, MaxCheckout: 5,
            MinGenerators: 1, MaxGenerators: 4,
            RequiresCache: null,
            IncompatibleWith: []),

        // ── The data tier ────────────────────────────────────────────────────────────────────
        // Postgres is the only stateful dependency the platform exposes a fault dial for, and
        // `dataState` is that dial: the catalogue rows the workload reads become unreadable, and
        // every read of one is a 5xx. Connection-pool exhaustion belongs in this family and has no
        // dial yet, so it is deliberately absent rather than faked — a module the cluster cannot
        // actually produce would make a rated result a story.
        new RankedFaultModule(
            "data-integrity-pressure",
            DataFamily,
            "Catalogue reads failing",
            "A steady share of reads are failing while latency stays flat.",
            "The catalogue itself is degraded, so the errors come from the data rather than from "
            + "capacity or code. Flat latency beside a raised error rate is the signature: the "
            + "requests are not slow, they are failing.",
            Spec(Catalogue("degraded")),
            [DataIs("recovered")],
            [Restore],
            [CacheOverData],
            MinCheckout: 2, MaxCheckout: 6,
            MinGenerators: 1, MaxGenerators: 3,
            RequiresCache: null,
            IncompatibleWith: []),
    ];

    public static readonly IReadOnlyDictionary<string, RankedFaultModule> ById =
        All.ToDictionary(module => module.Id, StringComparer.Ordinal);

    public static RankedFaultModule Module(string id) =>
        ById.TryGetValue(id, out var module)
            ? module
            : throw new InvalidOperationException($"Unknown ranked fault module '{id}'.");

    /// <summary>
    /// Whether two modules can share a phase.
    ///
    /// Nothing here is a taste judgement. Same family is one incident described twice; a shared dial
    /// is two faults overwriting each other's setup; disjoint state requirements mean no single
    /// cluster makes both of them visible at once; and disagreeing about the cache is the same thing
    /// in one dial. The explicit list carries only the pair whose problem is semantic.
    /// </summary>
    public static bool Compatible(RankedFaultModule a, RankedFaultModule b)
    {
        if (string.Equals(a.Id, b.Id, StringComparison.Ordinal)) return false;
        if (string.Equals(a.Family, b.Family, StringComparison.Ordinal)) return false;
        if (a.IncompatibleWith.Contains(b.Id, StringComparer.Ordinal)) return false;
        if (b.IncompatibleWith.Contains(a.Id, StringComparer.Ordinal)) return false;
        if (a.DrivenKeys.Intersect(b.DrivenKeys, StringComparer.Ordinal).Any()) return false;
        if (a.RequiresCache is not null && b.RequiresCache is not null &&
            a.RequiresCache != b.RequiresCache) return false;

        // Both faults have to be visible on ONE cluster, so the states they each need must overlap.
        if (Math.Max(a.MinCheckout, b.MinCheckout) > Math.Min(a.MaxCheckout, b.MaxCheckout))
            return false;
        if (Math.Max(a.MinGenerators, b.MinGenerators) > Math.Min(a.MaxGenerators, b.MaxGenerators))
            return false;

        return true;
    }

    public static bool Compatible(string a, string b) => Compatible(Module(a), Module(b));

    /// <summary>Every unordered pair the rules above allow. Used by the generator to draw a two-fault
    /// phase, and by the tests as the exhaustive statement of what may combine.</summary>
    public static IReadOnlyList<(RankedFaultModule First, RankedFaultModule Second)> CompatiblePairs =>
        (from i in Enumerable.Range(0, All.Count)
         from j in Enumerable.Range(i + 1, Math.Max(0, All.Count - i - 1))
         where Compatible(All[i], All[j])
         select (All[i], All[j])).ToArray();
}
