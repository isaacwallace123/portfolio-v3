using System.Globalization;
using System.Text.RegularExpressions;

namespace IsaacWallace.Api.Ranked;

// The generated-incident contract.
//
// A ranked match used to be a draw from seven hand-written cascades. Seven is a number an operator
// finishes learning, and once they have, the ladder measures recall of which button was third rather
// than whether they can read a system they have not seen. So the incident is now generated: the
// server cuts a plan from a seed, the plan's difficulty follows the operator's ELO continuously, and
// the plan — not a catalog id — is what the cluster is configured from.
//
// Everything here is a value type on purpose. A plan is a FACT about one match: it is written down
// with the attempt, it is regenerable from its seed, and nothing that happens during the match can
// change it. That is what makes a rated result auditable after the fact.

/// <summary>
/// The whole input to generation, and therefore the whole identity of a generated match.
///
/// Generation is a pure function of this record, which is the property everything else leans on: a
/// reload, a second api replica, and a debrief written three weeks later all rebuild the identical
/// plan without reading the database. The seed id is opaque — it carries no information about what
/// the operator is about to face, so possessing it early reveals nothing.
/// </summary>
public sealed record RankedScenarioSeed(string SeedId, int GeneratorVersion, int PlayerRating)
{
    /// <summary>Bump when a change to the generator would produce a different plan from the same
    /// seed. Old attempts keep their own version, so their plans still rebuild exactly as played
    /// rather than as the current generator would cut them.</summary>
    public const int CurrentVersion = 1;

    /// <summary>Ratings are quantized before they reach the generator. Without this, two matches a
    /// single point apart would be different incidents, so a plan could never be discussed as "the
    /// 1450 cut" and the seed space would be needlessly sparse — and it makes the rating a short,
    /// bounded component of the token below.</summary>
    public const int RatingStep = 10;

    public const int MinRating = 100;
    public const int MaxRating = 2600;

    private static readonly Regex SeedIdPattern =
        new("^[a-f0-9]{32}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    // The LabRun's spec.drillId is what carries a generated match through Kubernetes, and the XRD
    // constrains it to a DNS-label shape (^[a-z0-9]([-a-z0-9]*[a-z0-9])?$, 63 characters). So the
    // token is lowercase hex and dashes and nothing else: 4 + 1 + 1 + 1 + 4 + 1 + 32 = 44 characters
    // at the widest rating. It fits without a schema change, which is the reason the whole seed lives
    // in the id rather than only a database key — a run's own spec is enough to rebuild its plan.
    private const string TokenPrefix = "rgen";

    private static readonly Regex TokenPattern = new(
        @"^rgen-(?<version>[0-9]{1,3})-(?<rating>[0-9]{3,4})-(?<seed>[a-f0-9]{32})$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>The drill id a generated match runs under. Self-describing by design: the token IS
    /// the seed, so any component holding a LabRun can rebuild the plan it is running.</summary>
    public string Token =>
        string.Create(
            CultureInfo.InvariantCulture,
            $"{TokenPrefix}-{GeneratorVersion}-{Quantize(PlayerRating)}-{SeedId}");

    public static bool IsToken(string value) => TokenPattern.IsMatch(value ?? "");

    public static bool TryParseToken(string value, out RankedScenarioSeed? seed)
    {
        seed = null;
        var match = TokenPattern.Match(value ?? "");
        if (!match.Success) return false;

        var version = int.Parse(match.Groups["version"].Value, CultureInfo.InvariantCulture);
        var rating = int.Parse(match.Groups["rating"].Value, CultureInfo.InvariantCulture);
        if (version < 1 || version > CurrentVersion) return false;
        if (rating < MinRating || rating > MaxRating) return false;

        seed = new RankedScenarioSeed(match.Groups["seed"].Value, version, rating);
        return true;
    }

    /// <summary>Rejects anything that could not have come out of a draw, so a hand-typed token
    /// cannot ask the generator for a plan outside the space it is calibrated over.</summary>
    public bool IsWellFormed =>
        SeedIdPattern.IsMatch(SeedId) &&
        GeneratorVersion >= 1 &&
        GeneratorVersion <= CurrentVersion &&
        PlayerRating >= MinRating &&
        PlayerRating <= MaxRating &&
        PlayerRating == Quantize(PlayerRating);

    public static int Quantize(int rating) =>
        Math.Clamp(rating - (rating % RatingStep), MinRating, MaxRating);
}

/// <summary>The cluster the match opens on. Every field is a real LabRun spec dial, so this is the
/// starting state as the platform will actually hold it rather than a description of one.</summary>
public sealed record RankedInitialState(
    int CheckoutReplicas,
    int CanaryReplicas,
    int GatewayReplicas,
    bool CacheEnabled,
    string ReleaseTrack,
    string DataState,
    string TargetPool,
    int LoadGenerators);

/// <summary>What the generators are asking the stack for during a phase. Demand, not capacity: the
/// k6 profile is open-loop, so this is offered load whether or not it is served.</summary>
public sealed record RankedLoadShape(int Generators)
{
    public int OfferedRequestsPerSec => Runs.LoadModel.Offered(Generators);
}

/// <summary>
/// How much of the measured picture the operator is given.
///
/// Real difficulty at the top of the ladder is not a tighter number, it is a thinner instrument
/// panel: an SRE who can only see error rate has to reason about where the queue is instead of
/// reading it off a gauge. The server always evaluates the objective against the full truth — this
/// only decides which live values are echoed back, so a redacted panel can never change a verdict.
/// </summary>
public sealed record RankedTelemetryVisibility(
    bool Throughput,
    bool Latency,
    bool Errors,
    bool State)
{
    public static RankedTelemetryVisibility Full => new(true, true, true, true);

    /// <summary>Metrics whose live value is echoed. Anything outside this set still has its target
    /// shown and is still judged; the operator just does not get the number for free.</summary>
    public bool Reveals(string metric) => metric switch
    {
        "throughput" => Throughput,
        "p95" => Latency,
        "errors" => Errors,
        _ => State,
    };

    public int RevealedCount =>
        (Throughput ? 1 : 0) + (Latency ? 1 : 0) + (Errors ? 1 : 0) + (State ? 1 : 0);

    public string Notice => RevealedCount == 4
        ? "Full telemetry."
        : "Partial telemetry: some live values are withheld. Targets are unchanged and every "
          + "objective is still judged on the platform's own measurements.";
}

/// <summary>The numbers a phase has to reach. Generous at low rating and tight at high, and the same
/// shape either way, so the ladder never changes what an objective MEANS between divisions.</summary>
public sealed record RankedObjectiveProfile(
    double P95CeilingMs,
    double ErrorCeilingPct,
    double ServedShare,
    int HoldSeconds)
{
    /// <summary>Requests a second that must actually be served during this phase. Below the offered
    /// rate because a two-second measurement window is never exactly the arrival rate, and a target
    /// only a perfect sample can pass is a target that passes by luck.</summary>
    public int MustServe(RankedLoadShape load) =>
        (int)(load.OfferedRequestsPerSec * ServedShare);
}

/// <summary>One audited fault as it was placed into a plan: which module, when it arrives, and
/// whether the operator was told about it up front.</summary>
public sealed record RankedFaultPlacement(
    string ModuleId,
    string Family,
    int ActivationDelaySeconds,
    bool Hidden);

/// <summary>
/// One phase of a generated incident.
///
/// Phase one is what the operator is briefed on. Every phase after it is a consequence: it is only
/// revealed once the phase before it has been contained, which is both how an incident actually
/// unfolds and the only way a secondary escalation can be a surprise without being unfair.
/// </summary>
public sealed record RankedScenarioPhase(
    string Id,
    string Title,
    string Objective,
    string Handoff,
    IReadOnlyList<RankedFaultPlacement> Faults,
    RankedLoadShape Load,
    RankedObjectiveProfile Objectives,
    // Spec applied when the phase opens.
    IReadOnlyDictionary<string, object> Setup,
    // Spec applied ActivationDelaySeconds into the phase instead of at its start, and the phase
    // cannot be resolved until it has landed. A fault that arrives while the operator is already
    // reading the graphs is the difference between a puzzle and a shift.
    IReadOnlyDictionary<string, object> DelayedSetup,
    int ActivationDelaySeconds,
    // False for phase one, true for every escalation. The briefing is built from public phases only.
    bool Hidden);

/// <summary>
/// A generated ranked incident, in full. This is the audit record: given the seed and the generator
/// version, this exact value is rebuildable forever, which is what lets a rated result be re-derived
/// rather than merely trusted.
/// </summary>
public sealed record RankedScenarioPlan(
    RankedScenarioSeed Seed,
    int ScenarioRating,
    string Title,
    string Objective,
    string Environment,
    IReadOnlyList<string> Constraints,
    int ParSeconds,
    RankedInitialState Initial,
    RankedTelemetryVisibility Telemetry,
    IReadOnlyList<RankedScenarioPhase> Phases)
{
    /// <summary>The drill id this plan runs under — its seed token.</summary>
    public string DrillId => Seed.Token;

    public IEnumerable<RankedFaultPlacement> Faults =>
        Phases.SelectMany(phase => phase.Faults);

    public IEnumerable<string> Families =>
        Faults.Select(fault => fault.Family).Distinct(StringComparer.Ordinal);

    /// <summary>Families an operator has now seen, for the matchmaker's recency exclusion.</summary>
    public IReadOnlyList<string> FamilyList =>
        Families.OrderBy(family => family, StringComparer.Ordinal).ToArray();

    public bool HasEscalation => Phases.Any(phase => phase.Hidden);

    public int VerificationHoldSeconds => Phases[^1].Objectives.HoldSeconds;

    /// <summary>
    /// A single scalar for how hard this plan is, in the units the generator actually varies: how
    /// many faults arrive, whether one of them is hidden, how long the operator waits for it, how
    /// much of the panel is dark, and how tight the numbers are.
    ///
    /// Deliberately NOT a function of which tier broke. Two plans can be the same difficulty with
    /// different faults, and that is the point — the seed decides what the operator sees, the rating
    /// decides how hard it is. Keeping the two separate is also what makes "difficulty rises with
    /// rating" a property that can be proven rather than sampled.
    /// </summary>
    public double DifficultyScore =>
        Faults.Count() * 1.0
        + (HasEscalation ? 1.0 : 0.0)
        + Faults.Max(fault => fault.ActivationDelaySeconds) / 20.0
        + (4 - Telemetry.RevealedCount) * 0.5
        + Phases.Average(phase => Tightness(phase.Objectives));

    private static double Tightness(RankedObjectiveProfile objectives) =>
        (700 - Math.Clamp(objectives.P95CeilingMs, 250, 700)) / 450.0
        + (3.0 - Math.Clamp(objectives.ErrorCeilingPct, 1.0, 3.0)) / 2.0
        + (Math.Clamp(objectives.ServedShare, 0.6, 0.88) - 0.6) / 0.28;
}
