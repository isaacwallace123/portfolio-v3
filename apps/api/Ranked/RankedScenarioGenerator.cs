using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using IsaacWallace.Api.Runs;

namespace IsaacWallace.Api.Ranked;

/// <summary>
/// Cuts a ranked incident from a seed.
///
/// The one property everything else depends on: this is a PURE function of the seed. Same seed, same
/// plan, on any replica, after any reload, forever — which is what makes a generated match auditable
/// instead of merely plausible. Nothing here reads a clock, a database, or a random number source.
///
/// Difficulty is continuous in the operator's ELO rather than bucketed into divisions. Divisions are a
/// label for a rating; using them as the difficulty input would mean an operator at 1299 and one at
/// 1301 play measurably different ladders while an operator at 1101 and one at 1299 play the same
/// one. So every knob below is a function of a single normalized rating, and the seed only chooses
/// WHICH faults appear — never how hard they are. Keeping those two apart is what makes "difficulty
/// rises with rating" a property that can be proven rather than sampled.
/// </summary>
public static class RankedScenarioGenerator
{
    /// <summary>Where the difficulty curve starts and ends. Below the floor every knob is at its
    /// most generous, above the ceiling every knob is at its tightest — the curve does not keep
    /// getting harder forever, because the platform has a physical limit and an objective past it
    /// would be unreachable rather than difficult.</summary>
    public const int FloorRating = 800;
    public const int CeilingRating = 1800;

    // Where each structural knob engages, as a fraction of the curve. Written as named constants
    // because these thresholds ARE the ladder's design, and a reader should be able to see the whole
    // progression in one place: one clear fault → competing signals → a hidden second act → a fault
    // that arrives late → a panel with the throughput gauge dark → and then the latency gauge too.
    private const double EscalationFrom = 0.30;
    private const double SecondFaultFrom = 0.50;
    private const double ThroughputDarkFrom = 0.55;
    private const double DelayedActivationFrom = 0.60;
    private const double LatencyDarkFrom = 0.80;

    public static double Difficulty(int playerRating) =>
        Math.Clamp(
            (playerRating - FloorRating) / (double)(CeilingRating - FloorRating), 0.0, 1.0);

    /// <summary>Draw a fresh seed for a match. The only non-deterministic step in the whole
    /// system, and it is deliberately isolated here so that everything downstream of it is
    /// reproducible.</summary>
    public static RankedScenarioSeed NewSeed(int playerRating) =>
        new(
            Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16)),
            RankedScenarioSeed.CurrentVersion,
            RankedScenarioSeed.Quantize(
                Math.Clamp(playerRating, RankedScenarioSeed.MinRating, RankedScenarioSeed.MaxRating)));

    public static RankedScenarioPlan Generate(RankedScenarioSeed seed)
    {
        if (!seed.IsWellFormed)
            throw new ArgumentException(
                $"Seed '{seed.SeedId}' is not a well-formed ranked scenario seed.", nameof(seed));

        var difficulty = Difficulty(seed.PlayerRating);
        var draw = new SeedStream(seed);

        // ── The structural knobs, all monotone in difficulty ─────────────────────────────────
        var telemetry = new RankedTelemetryVisibility(
            Throughput: difficulty < ThroughputDarkFrom,
            Latency: difficulty < LatencyDarkFrom,
            // Never dark. An operator with no error signal at all is not being challenged, they are
            // being asked to guess, and a rated result from a guess is worthless.
            Errors: true,
            State: true);

        var faultCount = difficulty >= SecondFaultFrom ? 2 : 1;
        var escalates = difficulty >= EscalationFrom;
        var activationDelay = difficulty < DelayedActivationFrom
            ? 0
            : (int)Math.Round(
                Lerp(6, 20, (difficulty - DelayedActivationFrom) / (1 - DelayedActivationFrom)));

        // ── The faults ───────────────────────────────────────────────────────────────────────
        var primary = DrawPrimary(draw, faultCount);
        // An escalation the catalog cannot supply compatibly is not worth faking with a repeat of a
        // family already in play; the match is simply the primary incident, judged the same way.
        var escalation = escalates ? DrawEscalation(draw, primary) : null;

        // ── The cluster all of them have to be visible on ────────────────────────────────────
        RankedFaultModule[] involved = escalation is null ? primary : [.. primary, escalation];
        var checkoutWindow = Window(involved, m => m.MinCheckout, m => m.MaxCheckout, 1, 6);
        var generatorWindow = Window(involved, m => m.MinGenerators, m => m.MaxGenerators, 1, 4);
        var cacheOn = involved.Select(m => m.RequiresCache).FirstOrDefault(r => r is not null)
            // Nothing demanded a cache state, so the tighter the objectives the more the stack needs
            // one: past the uncached ceiling no sequence of correct moves finishes the phase.
            ?? difficulty >= 0.4;

        var objectives = ObjectivesFor(difficulty);
        var primaryLoad = LoadFor(
            difficulty, generatorWindow, objectives, cacheOn, primary, escalation is not null);

        var checkout = ClampToWindow(
            // Faults that are about capacity want a fleet with somewhere to go; faults that are about
            // code or data want a fleet that is plainly not the problem, so the operator has to look
            // past it. Both are drawn from inside whatever window the modules left open.
            checkoutWindow.Min + draw.Next(checkoutWindow.Max - checkoutWindow.Min + 1),
            checkoutWindow);

        var initial = new RankedInitialState(
            CheckoutReplicas: checkout,
            CanaryReplicas: 0,
            GatewayReplicas: involved.Any(m => m.Family == RankedFaultModules.GatewayFamily) ? 1 : 2,
            CacheEnabled: cacheOn,
            ReleaseTrack: "stable",
            DataState: "healthy",
            DbMaxConns: 8,
            NetworkMode: "normal",
            TargetPool: "apps",
            LoadGenerators: primaryLoad.Generators);

        // ── The phases ───────────────────────────────────────────────────────────────────────
        var phases = new List<RankedScenarioPhase>
        {
            PrimaryPhase(difficulty, primary, initial, primaryLoad, objectives, activationDelay),
        };
        if (escalation is not null)
        {
            var escalationLoad = LoadFor(
                difficulty, generatorWindow, objectives, cacheOn, [escalation], false);
            phases.Add(EscalationPhase(difficulty, escalation, escalationLoad, objectives));
        }

        return new RankedScenarioPlan(
            seed,
            // The incident is cut FOR this operator's rating, so by default the rating it is worth
            // is that rating. An ELO ladder against an environment is honest exactly when the
            // environment is tuned to the player: a clean solve at your own level is an even-money
            // result, and the difficulty curve above is what makes that claim true rather than
            // decorative. Family calibration can then move the PRICE off that default without
            // touching the cut — see RankedScenarioSeed.CalibratedRating for why the two must not
            // be the same number.
            ScenarioRating: seed.ScenarioRating,
            Title: "Generated incident",
            Objective:
                "Return the platform to its objective and hold it there. The incident is generated "
                + "for your rating and drawn from a seed, not chosen from a list.",
            Environment: Describe(initial),
            Constraints: ConstraintsFor(objectives, telemetry, primaryLoad),
            ParSeconds: 90 + (90 * phases.Count) + (30 * involved.Length),
            Initial: initial,
            Telemetry: telemetry,
            Phases: phases);
    }

    // ── Fault selection ─────────────────────────────────────────────────────────────────────

    private static RankedFaultModule[] DrawPrimary(SeedStream draw, int count)
    {
        if (count <= 1) return [draw.Pick(RankedFaultModules.All)];

        // Drawn from the enumerated compatible pairs rather than by drawing twice and hoping: a pair
        // that cannot share a cluster must be impossible to select, not merely unlikely.
        var pairs = RankedFaultModules.CompatiblePairs;
        if (pairs.Count == 0) return [draw.Pick(RankedFaultModules.All)];
        var (first, second) = draw.Pick(pairs);
        return [first, second];
    }

    private static RankedFaultModule? DrawEscalation(
        SeedStream draw, IReadOnlyList<RankedFaultModule> primary)
    {
        var eligible = RankedFaultModules.All
            .Where(candidate => primary.All(chosen => RankedFaultModules.Compatible(chosen, candidate)))
            .OrderBy(candidate => candidate.Id, StringComparer.Ordinal)
            .ToArray();
        return eligible.Length == 0 ? null : draw.Pick(eligible);
    }

    // ── Phases ──────────────────────────────────────────────────────────────────────────────

    private static RankedScenarioPhase PrimaryPhase(
        double difficulty,
        IReadOnlyList<RankedFaultModule> faults,
        RankedInitialState initial,
        RankedLoadShape load,
        RankedObjectiveProfile objectives,
        int activationDelay)
    {
        // The whole starting cluster, stated rather than inherited, so the phase can be read on its
        // own — the same convention the hand-written catalog uses.
        var setup = new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["apiReplicas"] = initial.CheckoutReplicas,
            ["canaryReplicas"] = initial.CanaryReplicas,
            ["gatewayReplicas"] = initial.GatewayReplicas,
            ["cacheReplicas"] = initial.CacheEnabled ? 1 : 0,
            ["releaseTrack"] = initial.ReleaseTrack,
            ["dataState"] = initial.DataState,
            ["dbMaxConns"] = initial.DbMaxConns,
            ["networkMode"] = initial.NetworkMode,
            ["targetPool"] = initial.TargetPool,
            ["loadReplicas"] = load.Generators,
        };

        // A delayed fault is the second one, and only when there is a second one. Delaying a lone
        // fault would open the phase on a healthy cluster whose objective is already met, which reads
        // as a bug for as long as it lasts.
        var delayed = new Dictionary<string, object>(StringComparer.Ordinal);
        var delaySeconds = activationDelay > 0 && faults.Count > 1 ? activationDelay : 0;
        for (var i = 0; i < faults.Count; i++)
        {
            var target = delaySeconds > 0 && i == faults.Count - 1 ? delayed : setup;
            foreach (var (key, value) in faults[i].Setup) target[key] = value;
        }

        var placements = faults
            .Select((fault, index) => new RankedFaultPlacement(
                fault.Id,
                fault.Family,
                delaySeconds > 0 && index == faults.Count - 1 ? delaySeconds : 0,
                Hidden: false))
            .ToArray();

        return new RankedScenarioPhase(
            "primary",
            "Bring the platform back to its objective",
            ObjectiveText(difficulty, faults, objectives, load, delaySeconds > 0),
            Handoff: "",
            placements,
            load,
            objectives,
            setup,
            delayed,
            delaySeconds,
            Hidden: false);
    }

    private static RankedScenarioPhase EscalationPhase(
        double difficulty,
        RankedFaultModule fault,
        RankedLoadShape load,
        RankedObjectiveProfile objectives)
    {
        var setup = new Dictionary<string, object>(fault.Setup, StringComparer.Ordinal)
        {
            ["loadReplicas"] = load.Generators,
        };

        return new RankedScenarioPhase(
            "escalation",
            "And then the second one",
            ObjectiveText(difficulty, [fault], objectives, load, delayed: false),
            // The handover note is what stops a second act reading as the platform being arbitrary.
            // It arrives only once the first phase is genuinely contained, so it can name the new
            // symptom without ever having been a spoiler.
            Handoff:
                "Containment held, and it did not hold alone. " + fault.Symptom
                + " The clock has not stopped and the objective has not changed.",
            [new RankedFaultPlacement(fault.Id, fault.Family, 0, Hidden: true)],
            load,
            objectives,
            setup,
            new Dictionary<string, object>(StringComparer.Ordinal),
            0,
            Hidden: true);
    }

    /// <summary>
    /// What the operator is asked to achieve, and how much of WHY they are seeing it.
    ///
    /// The generous end of the ladder names the symptom: at 900 the job is to fix a thing you have
    /// been told about, under load, without breaking it further. The tight end states only the
    /// targets, because at 1700 the diagnosis IS the exercise — two faults with overlapping signals
    /// and no label is the closest this platform gets to a real page at 3am.
    /// </summary>
    private static string ObjectiveText(
        double difficulty,
        IReadOnlyList<RankedFaultModule> faults,
        RankedObjectiveProfile objectives,
        RankedLoadShape load,
        bool delayed)
    {
        var targets =
            $"Serve {objectives.MustServe(load)} of the {load.OfferedRequestsPerSec} requests a "
            + $"second being offered, with p95 under {objectives.P95CeilingMs:0} ms and errors "
            + $"under {objectives.ErrorCeilingPct:0.#}%";
        var stateTargets = faults
            .SelectMany(fault => fault.Goals)
            .Select(goal => goal.Label.ToLowerInvariant() + " " + goal.TargetText)
            .ToArray();
        if (stateTargets.Length > 0)
            targets += ", and " + string.Join(", ", stateTargets);
        targets += ".";

        if (difficulty >= SecondFaultFrom)
            // No symptom prose at all: a competing-signals match where the objective narrates the
            // cause is a match with the answer printed on it.
            return targets + (delayed
                ? " Conditions are still developing."
                : "");

        return string.Join(" ", faults.Select(fault => fault.Symptom)) + " " + targets;
    }

    // ── Numbers ─────────────────────────────────────────────────────────────────────────────

    private static RankedObjectiveProfile ObjectivesFor(double difficulty) =>
        new(
            // 600ms is comfortably reachable by fixing the incident at all; 250ms is the number the
            // hand-written catalog uses for "you actually resolved it", measured on this workload.
            P95CeilingMs: Round(Lerp(600, 250, difficulty), 25),
            ErrorCeilingPct: Round(Lerp(3.0, 1.0, difficulty), 0.5),
            // How much of the offered load has to genuinely be served. The generous end forgives a
            // partly-recovered fleet; the tight end does not.
            ServedShare: Round(Lerp(0.60, 0.88, difficulty), 0.02),
            // Longer holds at the top of the ladder: a recovery that survives twenty seconds of live
            // traffic is evidence, where one that survives ten is sometimes a sampling window.
            HoldSeconds: (int)Math.Round(Lerp(10, 20, difficulty)));

    /// <summary>
    /// How much traffic the match runs at.
    ///
    /// Bounded by what the modules need to be visible, then by what the platform can physically
    /// produce: uncached, six replicas top out near 700 requests a second, and p95 runs away above
    /// ~450 long before throughput flattens. A phase that asks for more than the stack can serve is
    /// unfinishable by any sequence of correct moves, so the ceiling is enforced here rather than
    /// discovered by an operator halfway up the ladder.
    /// </summary>
    private static RankedLoadShape LoadFor(
        double difficulty,
        (int Min, int Max) window,
        RankedObjectiveProfile objectives,
        bool cacheOn,
        IReadOnlyList<RankedFaultModule> faults,
        bool leaveHeadroomForEscalation)
    {
        var target = (int)Math.Round(Lerp(window.Min, window.Max, difficulty));
        // A second act that arrives at the same offered load is not an escalation.
        //
        // This used to reserve headroom only when the primary already sat at the top of the window,
        // which is a narrow band of the curve — everywhere else both phases computed the identical
        // generator count from the identical window and difficulty, and the escalation's handover
        // note announced a step up that the load never took. Reserving a generator whenever the
        // window has one to give makes the claim true wherever it can be.
        if (leaveHeadroomForEscalation && target > window.Min) target--;
        var generators = ClampToWindow(target, window);

        // Cache reachability decides whether the uncached ceiling applies at all. It is reachable if
        // the phase starts cached and no fault takes it away, or if enabling it is one of the correct
        // moves on offer — the same test the catalog validator applies.
        var takesCacheAway = faults.Any(
            fault => fault.Setup.TryGetValue("cacheReplicas", out var value) && value is 0);
        var offersCache = faults.Any(
            fault => fault.Correct.Any(move => move.Id == CacheOnMoveId));
        var cacheReachable = (cacheOn && !takesCacheAway) || offersCache;
        if (cacheReachable) return new RankedLoadShape(generators);

        var ceiling = objectives.P95CeilingMs <= 250
            ? DrillKit.UncachedLowLatencyRps
            : DrillKit.UncachedCeilingRps;
        while (generators > window.Min &&
               objectives.MustServe(new RankedLoadShape(generators)) > ceiling)
            generators--;
        return new RankedLoadShape(generators);
    }

    private const string CacheOnMoveId = "cache";

    private static (int Min, int Max) Window(
        IReadOnlyList<RankedFaultModule> modules,
        Func<RankedFaultModule, int> min,
        Func<RankedFaultModule, int> max,
        int floor,
        int ceiling)
    {
        var low = modules.Count == 0 ? floor : modules.Max(min);
        var high = modules.Count == 0 ? ceiling : modules.Min(max);
        low = Math.Clamp(low, floor, ceiling);
        high = Math.Clamp(high, floor, ceiling);
        // Compatibility guarantees the windows intersect; this is the belt on top of the braces, so a
        // future module with a typo produces a narrow match rather than an inverted range.
        return high < low ? (low, low) : (low, high);
    }

    private static int ClampToWindow(int value, (int Min, int Max) window) =>
        Math.Clamp(value, window.Min, window.Max);

    private static string Describe(RankedInitialState initial) =>
        string.Create(
            CultureInfo.InvariantCulture,
            $"{initial.CheckoutReplicas} checkout replica(s) behind {initial.GatewayReplicas} " +
            $"gateway replica(s), response cache {(initial.CacheEnabled ? "on" : "off")}, " +
            $"{initial.ReleaseTrack} release, catalogue {initial.DataState}, " +
            $"database pool {initial.DbMaxConns}, network {initial.NetworkMode}, " +
            $"{initial.TargetPool} worker pool, {initial.LoadGenerators} load generator(s) offering " +
            $"{LoadModel.Offered(initial.LoadGenerators)} requests a second.");

    private static IReadOnlyList<string> ConstraintsFor(
        RankedObjectiveProfile objectives,
        RankedTelemetryVisibility telemetry,
        RankedLoadShape load) =>
    [
        $"Offered load is {load.OfferedRequestsPerSec} requests a second and does not fall because "
        + "you are struggling: the generators are open-loop, so this is demand, not capacity.",
        $"Every objective must hold continuously for {objectives.HoldSeconds} seconds before it "
        + "counts. A single bad reading in that window restarts the hold.",
        telemetry.Notice,
        "Every accepted command is applied and audited. Harmful, unnecessary, or repeated changes "
        + "lower operational quality; the measured objective, not an answer key, decides the run.",
        "Commands are limited to the ranked operator allowlist.",
    ];

    private static double Lerp(double from, double to, double t) =>
        from + ((to - from) * Math.Clamp(t, 0, 1));

    private static double Round(double value, double step) =>
        Math.Round(value / step, MidpointRounding.AwayFromZero) * step;

    /// <summary>
    /// A deterministic draw sequence keyed on the seed.
    ///
    /// Not System.Random: its algorithm is an implementation detail that has changed between .NET
    /// versions, and a plan that rebuilds differently after a runtime upgrade would silently
    /// invalidate every stored attempt. SHA-256 over "seed:counter" is specified, stable across
    /// versions and platforms, and fast enough for the handful of draws a plan needs.
    /// </summary>
    private sealed class SeedStream(RankedScenarioSeed seed)
    {
        private readonly string _material =
            string.Create(
                CultureInfo.InvariantCulture,
                $"{seed.SeedId}:{seed.GeneratorVersion}");
        private int _counter;

        public int Next(int exclusiveMax)
        {
            if (exclusiveMax <= 1) return 0;
            var bytes = SHA256.HashData(
                Encoding.UTF8.GetBytes(
                    string.Create(CultureInfo.InvariantCulture, $"{_material}:{_counter++}")));
            // 63 bits, so the modulo below cannot be handed a negative.
            var value = BitConverter.ToUInt64(bytes, 0) & long.MaxValue;
            return (int)(value % (ulong)exclusiveMax);
        }

        public T Pick<T>(IReadOnlyList<T> items) => items[Next(items.Count)];
    }
}
