using IsaacWallace.Api.Ranked;
using IsaacWallace.Api.Runs;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class RankedMatchmakerTests
{
    [Fact]
    public void CandidatePoolTracksOperatorRating()
    {
        var low = RankedMatchmaker.CandidatePool(
            950,
            ScenarioDefinitions.RankedDrills,
            []);
        var high = RankedMatchmaker.CandidatePool(
            1700,
            ScenarioDefinitions.RankedDrills,
            []);

        Assert.Contains(low, scenario => scenario.Id == "cascade-scale-release");
        Assert.Contains(high, scenario => scenario.Id == "cascade-full-sev");
        Assert.True(
            low.Average(scenario => RankedRules.ScenarioRating(scenario.Id)) <
            high.Average(scenario => RankedRules.ScenarioRating(scenario.Id)));
    }

    [Fact]
    public void RecentScenariosAreExcludedWhenAlternativesExist()
    {
        var pool = RankedMatchmaker.CandidatePool(
            1300,
            ScenarioDefinitions.RankedDrills,
            ["cascade-cost-surge", "cascade-recovery-regression"]);

        Assert.DoesNotContain(pool, scenario => scenario.Id == "cascade-cost-surge");
        Assert.DoesNotContain(pool, scenario => scenario.Id == "cascade-recovery-regression");
        Assert.NotEmpty(pool);
    }

    [Fact]
    public void ASmallCatalogFallsBackInsteadOfBlockingTheQueue()
    {
        var only = ScenarioDefinitions.RankedDrills
            .Where(scenario => scenario.Id == "cascade-scale-release")
            .ToArray();

        var pool = RankedMatchmaker.CandidatePool(
            1000,
            only,
            ["cascade-scale-release"]);

        Assert.Single(pool);
    }
}
