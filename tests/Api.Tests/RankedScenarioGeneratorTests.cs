using System.Text.Json;
using IsaacWallace.Api.Ranked;
using IsaacWallace.Api.Runs;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class RankedScenarioGeneratorTests
{
    [Fact]
    public void SameSeedProducesByteEquivalentPlan()
    {
        var seed = Seed(7, 1460);

        var first = JsonSerializer.Serialize(RankedScenarioGenerator.Generate(seed));
        var second = JsonSerializer.Serialize(RankedScenarioGenerator.Generate(seed));

        Assert.Equal(first, second);
    }

    [Fact]
    public void DifferentSeedsProduceVariedIncidentsWithinTheAuditedCatalog()
    {
        var plans = Enumerable.Range(1, 32)
            .Select(index => RankedScenarioGenerator.Generate(Seed(index, 1500)))
            .ToArray();
        var signatures = plans
            .Select(plan => string.Join(",", plan.Faults.Select(fault => fault.ModuleId)))
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        Assert.True(signatures.Length > 1);
        Assert.All(
            plans.SelectMany(plan => plan.Faults),
            fault => Assert.Contains(
                fault.ModuleId,
                RankedFaultModules.All.Select(module => module.Id)));
    }

    [Fact]
    public void EveryAuditedModuleIsReachableAndColdStartRollsTheRealWorkload()
    {
        var plans = Enumerable.Range(1, 512)
            .Select(index => RankedScenarioGenerator.Generate(Seed(index, 1000)))
            .ToArray();
        var reached = plans
            .SelectMany(plan => plan.Faults)
            .Select(fault => fault.ModuleId)
            .ToHashSet(StringComparer.Ordinal);

        Assert.Subset(
            reached,
            RankedFaultModules.All.Select(module => module.Id).ToHashSet(StringComparer.Ordinal));
        var coldStart = RankedFaultModules.Module("cold-start-storm");
        Assert.Equal(1, coldStart.Setup["apiReplicas"]);
        Assert.Equal(
            ScenarioDefinitions.FreshRestartToken,
            coldStart.Setup["restartToken"]);
        Assert.Contains(coldStart.Correct, move => move.Id == "scale");
        Assert.Contains(coldStart.Correct, move => move.Id == "cache");
    }

    [Fact]
    public void DifficultyNeverFallsAsRatingRisesForTheSameSeed()
    {
        var scores = new[] { 800, 1000, 1100, 1300, 1400, 1600, 1800 }
            .Select(rating => RankedScenarioGenerator.Generate(Seed(77, rating)).DifficultyScore)
            .ToArray();

        Assert.All(
            scores.Zip(scores.Skip(1)),
            pair => Assert.True(
                pair.First <= pair.Second,
                $"Difficulty fell from {pair.First} to {pair.Second}."));
    }

    [Fact]
    public void EveryGeneratedFaultSetIsCompatible()
    {
        foreach (var plan in Enumerable.Range(1, 128)
                     .Select(index => RankedScenarioGenerator.Generate(Seed(index, 1800))))
        {
            var modules = plan.Faults
                .Select(fault => RankedFaultModules.Module(fault.ModuleId))
                .ToArray();
            Assert.Equal(
                modules.Length,
                modules.Select(module => module.Family).Distinct(StringComparer.Ordinal).Count());
            for (var left = 0; left < modules.Length; left++)
            for (var right = left + 1; right < modules.Length; right++)
                Assert.True(RankedFaultModules.Compatible(modules[left], modules[right]));
        }
    }

    [Fact]
    public void BriefingWithholdsFaultsWhileDebriefRevealsThem()
    {
        var plan = RankedScenarioGenerator.Generate(Seed(91, 1700));
        var briefingJson = JsonSerializer.Serialize(RankedMatchBriefing.From(plan));
        var debrief = RankedMatchDebrief.From(plan);

        Assert.DoesNotContain(
            plan.Faults.Select(fault => fault.ModuleId),
            moduleId => briefingJson.Contains(moduleId, StringComparison.Ordinal));
        Assert.DoesNotContain(
            RankedFaultModules.All.Select(module => module.Diagnosis),
            diagnosis => briefingJson.Contains(diagnosis, StringComparison.Ordinal));
        Assert.Equal(
            plan.Faults.Select(fault => fault.ModuleId).OrderBy(id => id),
            debrief.Faults.Select(fault => fault.ModuleId).OrderBy(id => id));
    }

    [Fact]
    public void EveryResolvingMoveHasAnEquivalentConsoleCommand()
    {
        foreach (var move in RankedFaultModules.All.SelectMany(module => module.Correct))
        {
            var text = RankedMoveCommands.For(move.Id);
            Assert.NotEmpty(text);
            Assert.True(RankedCommand.TryParse(text, out var command, out var error), error);
            Assert.NotNull(command);
            Assert.Equal(move.Patch.Keys.OrderBy(key => key), command.SpecPatch.Keys.OrderBy(key => key));
            foreach (var (key, value) in move.Patch)
                Assert.Equal(value.ToString(), command.SpecPatch[key].ToString());
        }
    }

    [Fact]
    public void MaterializedPlanIsRatedAndPreservesTiming()
    {
        var plan = RankedScenarioGenerator.Generate(Seed(123, 1800));
        var definition = RankedScenarioMaterializer.ToDefinition(plan);

        Assert.True(definition.IsRanked);
        Assert.True(ScenarioDefinitions.IsDrill(plan.DrillId));
        Assert.Equal(plan.Phases.Count, definition.Stages.Count);
        Assert.Equal(
            plan.Phases.Select(phase => phase.ActivationDelaySeconds),
            definition.Stages.Select(stage => stage.ActivationDelaySeconds));
        Assert.Equal(
            plan.Phases.Select(phase => phase.Objectives.HoldSeconds),
            definition.Stages.Select(stage => stage.HoldSeconds));
    }

    /// <summary>
    /// Containment is held, not passed.
    ///
    /// A second act used to be judged against its own fault alone, so the stable release or
    /// recovered catalogue that ended phase one stopped being an objective the moment phase two
    /// opened — an operator could roll back onto the bad build while working the escalation and
    /// still be handed a verified recovery. The capacity triple deliberately does not carry: it
    /// belongs to the phase that set the load.
    /// </summary>
    [Fact]
    public void AnEscalationStillJudgesEveryStateGoalTheOperatorAlreadyResolved()
    {
        var escalating = Enumerable.Range(1, 256)
            .Select(index => RankedScenarioGenerator.Generate(Seed(index, 1700)))
            .First(plan =>
                plan.Phases.Count > 1 &&
                plan.Phases[0].Faults.Any(fault =>
                    RankedFaultModules.Module(fault.ModuleId).Goals.Count > 0));

        var definition = RankedScenarioMaterializer.ToDefinition(escalating);
        var carried = escalating.Phases[0].Faults
            .SelectMany(fault => RankedFaultModules.Module(fault.ModuleId).Goals)
            .ToArray();

        Assert.NotEmpty(carried);
        foreach (var goal in carried)
            Assert.Contains(
                definition.Stages[1].Goals,
                candidate =>
                    candidate.Metric == goal.Metric &&
                    candidate.State == goal.State &&
                    candidate.Threshold == goal.Threshold);

        // The escalation is measured against its OWN load, not the phase it followed.
        var throughput = definition.Stages[1].Goals
            .Where(goal => goal.Metric == "throughput")
            .ToArray();
        Assert.Single(throughput);
        Assert.Equal(
            escalating.Phases[1].Objectives.MustServe(escalating.Phases[1].Load),
            throughput[0].Threshold);
    }

    /// <summary>
    /// A second act usually arrives at more load than the phase it follows.
    ///
    /// The primary phase reserves a generator whenever its window has one to give. It used to
    /// reserve one only when it already sat at the top of that window, and over this sample that
    /// change moved 97 of 256 escalations to 115.
    ///
    /// A floor rather than a universal, because two things legitimately outrank the narrative and
    /// both are physical: three compatible modules often intersect to a single-value generator
    /// window with no headroom to reserve, and a phase whose faults put the response cache out of
    /// reach is pulled back down to what the uncached stack can actually serve. Asking for load the
    /// platform cannot produce would make a phase unwinnable rather than harder.
    /// </summary>
    [Fact]
    public void AnEscalationUsuallyRaisesTheOfferedLoad()
    {
        var escalating = Enumerable.Range(1, 256)
            .Select(index => RankedScenarioGenerator.Generate(Seed(index, 1500)))
            .Where(plan => plan.Phases.Count > 1)
            .ToArray();

        Assert.NotEmpty(escalating);
        var raised = escalating.Count(plan =>
            plan.Phases[1].Load.OfferedRequestsPerSec >
            plan.Phases[0].Load.OfferedRequestsPerSec);
        Assert.True(
            raised >= escalating.Length * 2 / 5,
            $"Only {raised} of {escalating.Length} escalations raised the offered load.");
    }

    private static RankedScenarioSeed Seed(int value, int rating) =>
        new(value.ToString("x32"), RankedScenarioSeed.CurrentVersion, rating);
}
