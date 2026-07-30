using IsaacWallace.Api.Runs;

namespace IsaacWallace.Api.Ranked;

/// <summary>
/// What an operator is told when a generated match opens.
///
/// The line this record draws is the whole competitive integrity of the mode. An operator gets the
/// environment, the objective, the constraints, and how hard the incident is — everything needed to
/// decide how to work and nothing that substitutes for working it out. Specifically: no fault module
/// is named, no diagnosis is quoted, and no phase marked hidden contributes a single character. A
/// second act has to arrive as a consequence of containment or it is not a second act.
///
/// Built by projection rather than by redaction of a fuller object, because a redactor is one missed
/// field away from leaking and a projection has to be explicitly given anything it shows.
/// </summary>
public sealed record RankedMatchBriefing(
    /// <summary>Public on purpose: it is the receipt an operator can quote when asking whether their
    /// match was fair, and it reveals nothing — the seed is opaque and the plan is not derivable by
    /// hand.</summary>
    string SeedId,
    int GeneratorVersion,
    int ScenarioRating,
    string Difficulty,
    string Environment,
    string Objective,
    /// <summary>The opening phase's objective. At the generous end of the ladder this names the
    /// symptom the operator has been paged about; at the tight end it states only the targets,
    /// because past a certain rating the diagnosis is the exercise.</summary>
    string OpeningObjective,
    IReadOnlyList<string> Constraints,
    int OfferedRequestsPerSec,
    int ParSeconds,
    int VerificationHoldSeconds,
    string TelemetryNotice,
    RankedTelemetryVisibility Telemetry)
{
    public static RankedMatchBriefing From(RankedScenarioPlan plan)
    {
        var opening = plan.Phases[0];
        return new RankedMatchBriefing(
            plan.Seed.SeedId,
            plan.Seed.GeneratorVersion,
            plan.ScenarioRating,
            RankedRules.Division(plan.ScenarioRating).Name,
            plan.Environment,
            plan.Objective,
            opening.Objective,
            plan.Constraints,
            opening.Load.OfferedRequestsPerSec,
            plan.ParSeconds,
            opening.Objectives.HoldSeconds,
            plan.Telemetry.Notice,
            plan.Telemetry);
    }
}

/// <summary>One fault, revealed. Only ever built for a match that is over.</summary>
public sealed record RankedFaultReveal(
    string ModuleId,
    string Family,
    string Label,
    string Diagnosis,
    int Phase,
    int ActivationDelaySeconds,
    bool WasHidden,
    /// <summary>The operator commands that actually resolve it. The debrief's most useful line: it
    /// closes the loop between "what was wrong" and "what you could have typed".</summary>
    IReadOnlyList<string> ResolvedBy);

/// <summary>
/// The full plan, revealed once a match is decided.
///
/// A generated ladder is only trustworthy if a player can see, afterwards, exactly what they were
/// given — including the parts that were hidden while it mattered. This is that view, and it carries
/// the seed and generator version so anyone can rebuild the same plan and check the claim.
/// </summary>
public sealed record RankedMatchDebrief(
    string SeedId,
    int GeneratorVersion,
    int ScenarioRating,
    string Difficulty,
    double DifficultyScore,
    string Environment,
    string Objective,
    int ParSeconds,
    int VerificationHoldSeconds,
    RankedInitialState Initial,
    RankedTelemetryVisibility Telemetry,
    IReadOnlyList<RankedFaultReveal> Faults,
    IReadOnlyList<RankedDebriefPhase> Phases)
{
    public static RankedMatchDebrief From(RankedScenarioPlan plan) =>
        new(
            plan.Seed.SeedId,
            plan.Seed.GeneratorVersion,
            plan.ScenarioRating,
            RankedRules.Division(plan.ScenarioRating).Name,
            plan.DifficultyScore,
            plan.Environment,
            plan.Objective,
            plan.ParSeconds,
            plan.VerificationHoldSeconds,
            plan.Initial,
            plan.Telemetry,
            plan.Phases
                .SelectMany((phase, index) => phase.Faults.Select(fault =>
                {
                    var module = RankedFaultModules.Module(fault.ModuleId);
                    return new RankedFaultReveal(
                        module.Id,
                        module.Family,
                        module.Label,
                        module.Diagnosis,
                        index + 1,
                        fault.ActivationDelaySeconds,
                        fault.Hidden,
                        module.Correct
                            .Select(move => RankedMoveCommands.For(move.Id))
                            .Where(command => command.Length > 0)
                            .ToArray());
                }))
                .ToArray(),
            plan.Phases.Select((phase, index) => new RankedDebriefPhase(
                index + 1,
                phase.Id,
                phase.Title,
                phase.Objective,
                phase.Handoff,
                phase.Load.OfferedRequestsPerSec,
                phase.Objectives,
                phase.ActivationDelaySeconds,
                phase.Hidden)).ToArray());
}

public sealed record RankedDebriefPhase(
    int Number,
    string Id,
    string Title,
    string Objective,
    string Handoff,
    int OfferedRequestsPerSec,
    RankedObjectiveProfile Objectives,
    int ActivationDelaySeconds,
    bool WasHidden);

/// <summary>
/// The console command that performs each resolving move.
///
/// A generated match is played through the ranked operator console, so a plan whose only correct move
/// has no command behind it would be unwinnable — not hard, unwinnable. This table is the explicit
/// statement of that link, and a test parses every entry through <see cref="RankedCommand"/> and
/// compares the resulting spec patch against the move's own, so the two cannot drift apart quietly.
/// </summary>
public static class RankedMoveCommands
{
    private static readonly IReadOnlyDictionary<string, string> Commands =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["scale"] = "scale checkout 6",
            ["scale-4"] = "scale checkout 4",
            ["trim"] = "scale checkout 2",
            ["cache"] = "enable cache",
            ["gateway"] = "scale gateway 3",
            ["rollback"] = "rollback checkout",
            ["canary-0"] = "shift canary 0",
            ["evacuate"] = "drain apps",
            ["move-apps"] = "drain infra",
            ["restore"] = "recover catalogue",
            ["db-pool-8"] = "set database connections 8",
            ["network-normal"] = "restore database network",
        };

    public static string For(string moveId) => Commands.GetValueOrDefault(moveId, "");

    public static IReadOnlyDictionary<string, string> All => Commands;
}
