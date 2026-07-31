using IsaacWallace.Api.Ranked;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class RankedMatchmakerTests
{
    [Fact]
    public void PlayedSeedIsNeverDrawnAgain()
    {
        var played = Seed(1);
        var fresh = Seed(2);
        var queue = new Queue<RankedScenarioSeed>([played, fresh]);

        var draw = RankedMatchmaker.Draw(
            1200,
            [],
            new HashSet<string>([played.SeedId], StringComparer.Ordinal),
            () => queue.Dequeue());

        Assert.NotNull(draw);
        Assert.Equal(fresh.SeedId, draw.Plan.Seed.SeedId);
        Assert.Equal(2, draw.SeedsConsidered);
        Assert.False(draw.RecencyRelaxed);
    }

    [Fact]
    public void RecentFamiliesAreExcludedWhenAnAlternativeIsDrawn()
    {
        var first = RankedScenarioGenerator.Generate(Seed(10, 1400));
        var alternative = Enumerable.Range(11, 100)
            .Select(index => RankedScenarioGenerator.Generate(Seed(index, 1400)))
            .First(plan => !plan.Families.Intersect(first.Families).Any());
        var queue = new Queue<RankedScenarioSeed>([first.Seed, alternative.Seed]);

        var draw = RankedMatchmaker.Draw(
            1400,
            first.FamilyList,
            new HashSet<string>(StringComparer.Ordinal),
            () => queue.Dequeue());

        Assert.NotNull(draw);
        Assert.Equal(alternative.Seed.SeedId, draw.Plan.Seed.SeedId);
        Assert.False(draw.RecencyRelaxed);
        Assert.Empty(draw.Plan.Families.Intersect(first.Families));
    }

    [Fact]
    public void FamilyExclusionRelaxesInsteadOfBlockingTheQueue()
    {
        var seed = Seed(42, 1500);
        var plan = RankedScenarioGenerator.Generate(seed);

        var draw = RankedMatchmaker.Draw(
            1500,
            plan.FamilyList,
            new HashSet<string>(StringComparer.Ordinal),
            () => seed);

        Assert.NotNull(draw);
        Assert.True(draw.RecencyRelaxed);
        Assert.Equal(RankedMatchmaker.DrawAttempts + 1, draw.SeedsConsidered);
    }

    [Fact]
    public void ExhaustedUniqueSeedsReturnNoMatch()
    {
        var seed = Seed(99);

        var draw = RankedMatchmaker.Draw(
            1200,
            [],
            new HashSet<string>([seed.SeedId], StringComparer.Ordinal),
            () => seed);

        Assert.Null(draw);
    }

    [Fact]
    public void SeedSourceCannotSubstituteAPlanCutForAnotherRating()
    {
        var wrongCut = Seed(55, 1800);

        var draw = RankedMatchmaker.Draw(
            1200,
            [],
            new HashSet<string>(StringComparer.Ordinal),
            () => wrongCut);

        Assert.Null(draw);
    }

    /// <summary>
    /// Calibration prices the incident and leaves the cut alone.
    ///
    /// The two used to be one number, which made the correction feed itself — a family the field
    /// completes often was rated lower AND drawn easier, so the completion rate that produced the
    /// adjustment went up and the loop ran to the clamp. Difficulty has to stay keyed on the
    /// operator's own rating for "difficulty rises with rating" to remain provable.
    /// </summary>
    [Theory]
    [InlineData(100, 1300)]
    [InlineData(-100, 1100)]
    public void AggregateFamilyCalibrationMovesEloValueWithoutChangingTheCut(
        int adjustment, int expectedPrice)
    {
        var seed = Seed(77, 1200);
        var uncalibrated = RankedScenarioGenerator.Generate(seed);
        var adjustments = RankedFaultModules.All
            .Select(module => module.Family)
            .Distinct(StringComparer.Ordinal)
            .ToDictionary(family => family, _ => adjustment, StringComparer.Ordinal);

        var draw = RankedMatchmaker.Draw(
            1200,
            [],
            new HashSet<string>(StringComparer.Ordinal),
            () => seed,
            adjustments);

        Assert.NotNull(draw);
        // Priced where the evidence says.
        Assert.Equal(expectedPrice, draw.Plan.ScenarioRating);
        // Cut where the operator is, and cut identically to the uncalibrated draw.
        Assert.Equal(1200, draw.Plan.Seed.PlayerRating);
        Assert.Equal(uncalibrated.DifficultyScore, draw.Plan.DifficultyScore);
        Assert.Equal(uncalibrated.Telemetry, draw.Plan.Telemetry);
        Assert.Equal(uncalibrated.Initial, draw.Plan.Initial);
        Assert.Equal(
            uncalibrated.Faults.Select(fault => fault.ModuleId),
            draw.Plan.Faults.Select(fault => fault.ModuleId));

        // Both numbers survive the token, so any holder of the LabRun rebuilds the same priced plan.
        Assert.True(RankedScenarioSeed.TryParseToken(draw.Plan.DrillId, out var reconstructed));
        Assert.Equal(1200, reconstructed!.PlayerRating);
        Assert.Equal(expectedPrice, reconstructed.ScenarioRating);
        Assert.Equal(expectedPrice, RankedScenarioGenerator.Generate(reconstructed).ScenarioRating);
    }

    /// <summary>An uncalibrated family stays on the short token: one plan, one id. Two spellings of
    /// the same plan would make the drill id — which is what Kubernetes carries and what a debrief
    /// is looked up by — no longer a canonical name for the match.</summary>
    [Fact]
    public void APriceEqualToTheCutIsNotSpelledOutAndIsNotAccepted()
    {
        var seed = Seed(88, 1200);
        Assert.Equal(seed.Token, (seed with { CalibratedRating = 1200 }).Token);
        Assert.False(RankedScenarioSeed.TryParseToken(
            $"rgen-{RankedScenarioSeed.CurrentVersion}-1200-1200-{seed.SeedId}", out _));
    }

    private static RankedScenarioSeed Seed(int value, int rating = 1200) =>
        new(value.ToString("x32"), RankedScenarioSeed.CurrentVersion, rating);
}
