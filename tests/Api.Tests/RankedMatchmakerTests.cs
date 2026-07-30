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

    private static RankedScenarioSeed Seed(int value, int rating = 1200) =>
        new(value.ToString("x32"), RankedScenarioSeed.CurrentVersion, rating);
}
