using System.Collections.Concurrent;
using IsaacWallace.Api.Runs;
using static IsaacWallace.Api.Runs.DrillKit;

namespace IsaacWallace.Api.Ranked;

/// <summary>
/// Turns a plan into the thing the platform already knows how to run.
///
/// A generated match is deliberately NOT a second execution engine. It materializes into the same
/// <see cref="ScenarioDefinition"/> the hand-written catalog produces, so the measured objective
/// evaluator, the stage machinery, the hold, the action ledger, and the rating transaction are the
/// existing ones, unchanged and still the only authority on whether a match was solved. The generator
/// decides what the incident IS; nothing here decides whether it was beaten.
/// </summary>
public static class RankedScenarioMaterializer
{
    public const string Eyebrow = "Ranked · generated";

    public static ScenarioDefinition ToDefinition(RankedScenarioPlan plan)
    {
        var stages = plan.Phases.Select(phase => ToStage(plan, phase)).ToArray();
        return new ScenarioDefinition(
            plan.DrillId,
            plan.Title,
            Eyebrow,
            // The summary is public the moment a match opens, so it says what kind of shift this is
            // and never what is wrong with the cluster.
            $"A server-generated incident cut for rating {plan.ScenarioRating} from seed "
            + $"{plan.Seed.SeedId[..8]}. Read the platform, not a runbook.",
            RankedRules.Division(plan.ScenarioRating).Name.ToLowerInvariant(),
            "standard",
            plan.ParSeconds,
            plan.Objective,
            stages[0].Setup,
            stages,
            Rated: true);
    }

    private static DrillStage ToStage(RankedScenarioPlan plan, RankedScenarioPhase phase)
    {
        var goals = new List<DrillGoal>
        {
            // Capacity first, and always present: without a served-load goal every other target can
            // be met by an idle cluster serving nothing quickly.
            new(
                $"Served load (of {phase.Load.OfferedRequestsPerSec}/s offered)",
                "throughput",
                phase.Objectives.MustServe(phase.Load),
                "",
                Below: false),
            P95(phase.Objectives.P95CeilingMs),
            Errors(phase.Objectives.ErrorCeilingPct),
        };
        foreach (var fault in phase.Faults)
            goals.AddRange(RankedFaultModules.Module(fault.ModuleId).Goals);

        return new DrillStage(
            phase.Id,
            phase.Title,
            phase.Objective,
            phase.Handoff,
            phase.Setup,
            Options(phase).Select(move => move.Build()).ToArray(),
            // Two faults can each demand the same capacity target; the objective should read once.
            goals.GroupBy(Key, StringComparer.Ordinal).Select(group => group.First()).ToArray(),
            phase.DelayedSetup,
            phase.ActivationDelaySeconds,
            phase.Objectives.HoldSeconds);

        static string Key(DrillGoal goal) => $"{goal.Metric}|{goal.State}|{goal.Threshold}|{goal.Below}";
    }

    /// <summary>
    /// The moves a phase offers, unioned across its faults.
    ///
    /// Two rules resolve the collisions a union creates. A move that any fault needs as an ANSWER is
    /// never also a trap — one module's "scaling is the fix" beats another's "scaling is the mistake",
    /// because a plan that calls the same action both is a plan that cannot be solved without also
    /// failing. And a trap whose antidote did not survive the union is dropped rather than offered: a
    /// mistake the operator cannot climb back out of would let the draw decide the result.
    /// </summary>
    private static IReadOnlyList<Move> Options(RankedScenarioPhase phase)
    {
        var modules = phase.Faults
            .Select(fault => RankedFaultModules.Module(fault.ModuleId))
            .ToArray();

        var correct = new Dictionary<string, Move>(StringComparer.Ordinal);
        foreach (var move in modules.SelectMany(module => module.Correct))
            correct.TryAdd(move.Id, move);

        var offered = correct.Keys.ToHashSet(StringComparer.Ordinal);
        var traps = new Dictionary<string, Move>(StringComparer.Ordinal);
        foreach (var move in modules.SelectMany(module => module.Traps))
        {
            if (correct.ContainsKey(move.Id)) continue;
            if (move.Antidotes is { Count: > 0 } antidotes &&
                !antidotes.Any(offered.Contains)) continue;
            traps.TryAdd(move.Id, move);
        }

        // Ordered by id rather than by module, so the option list is a property of the plan and not of
        // the order the generator happened to draw the faults in.
        return
        [
            .. correct.Values.OrderBy(move => move.Id, StringComparer.Ordinal),
            .. traps.Values.OrderBy(move => move.Id, StringComparer.Ordinal),
        ];
    }
}

/// <summary>
/// Resolves a generated drill id back into its definition.
///
/// The seed lives in the id, and generation is pure, so this needs no database and no shared state:
/// any component holding a LabRun can rebuild exactly the incident that LabRun is running. That is
/// what makes a reload, a second api replica, and a debrief written later all agree — and it is why
/// the run's own spec, rather than a row somewhere, is the source of truth about what was played.
///
/// The cache is only there because a busy match resolves its plan several times a second while the
/// page polls; it holds values, so a cold cache and a warm one cannot disagree.
/// </summary>
public static class RankedScenarioCatalog
{
    private static readonly ConcurrentDictionary<string, RankedScenarioPlan> Plans = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, ScenarioDefinition> Definitions = new(StringComparer.Ordinal);

    /// <summary>Bounded so a long-lived api replica cannot accumulate a plan per match it has ever
    /// served. Rebuilding is cheap and deterministic, so dropping the whole cache is always safe.</summary>
    private const int CacheCeiling = 512;

    public static bool IsGenerated(string drillId) => RankedScenarioSeed.IsToken(drillId);

    public static RankedScenarioPlan? TryPlan(string drillId)
    {
        if (!RankedScenarioSeed.TryParseToken(drillId, out var seed) || seed is null) return null;
        if (Plans.TryGetValue(drillId, out var cached)) return cached;

        RankedScenarioPlan plan;
        try
        {
            plan = RankedScenarioGenerator.Generate(seed);
        }
        catch (ArgumentException)
        {
            // A token that parses but does not generate is not a match; callers treat it as unknown
            // rather than as an empty incident, so nothing rated can come of it.
            return null;
        }

        if (Plans.Count >= CacheCeiling) Plans.Clear();
        Plans[drillId] = plan;
        return plan;
    }

    public static ScenarioDefinition? TryDefinition(string drillId)
    {
        if (Definitions.TryGetValue(drillId, out var cached)) return cached;
        var plan = TryPlan(drillId);
        if (plan is null) return null;

        var definition = RankedScenarioMaterializer.ToDefinition(plan);
        if (Definitions.Count >= CacheCeiling) Definitions.Clear();
        Definitions[drillId] = definition;
        return definition;
    }
}
