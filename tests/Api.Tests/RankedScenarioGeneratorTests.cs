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

    private static RankedScenarioSeed Seed(int value, int rating) =>
        new(value.ToString("x32"), RankedScenarioSeed.CurrentVersion, rating);
}
