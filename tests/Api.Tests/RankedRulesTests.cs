using IsaacWallace.Api.Ranked;
using IsaacWallace.Api.Runs;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class RankedRulesTests
{
    [Theory]
    [InlineData("cascade-scale-release", 1150)]
    [InlineData("cascade-cost-surge", 1250)]
    [InlineData("cascade-recovery-regression", 1350)]
    [InlineData("cascade-evacuation", 1250)]
    [InlineData("cascade-canary", 1400)]
    [InlineData("cascade-gateway-peak", 1450)]
    [InlineData("cascade-full-sev", 1600)]
    public void EveryRankedScenarioHasAnExplicitRating(string drillId, int expected)
    {
        Assert.Equal(expected, RankedRules.ScenarioRating(drillId));
    }

    [Fact]
    public void TheEntireRankedCatalogIsCalibrated()
    {
        Assert.All(
            ScenarioDefinitions.RankedDrills,
            scenario => Assert.True(
                RankedRules.IsCalibratedScenario(scenario.Id),
                $"{scenario.Id} needs an explicit ranked rating."));
    }

    [Fact]
    public void UnknownScenarioCannotSilentlyUseAFallbackRating()
    {
        var error = Assert.Throws<InvalidOperationException>(
            () => RankedRules.ScenarioRating("cascade-not-calibrated"));

        Assert.Contains("has no rating calibration", error.Message);
    }

    [Fact]
    public void RatingRewardsAnUpsetMoreThanItPunishesTheExpectedLoss()
    {
        var win = RankedRules.Calculate(1000, 0, 1600, completed: true);
        var loss = RankedRules.Calculate(1000, 0, 1600, completed: false);

        Assert.Equal(40, win.KFactor);
        Assert.Equal(38, win.Delta);
        Assert.Equal(-2, loss.Delta);
        Assert.Equal(1038, win.After);
        Assert.Equal(998, loss.After);
    }

    [Fact]
    public void EstablishedOperatorsUseTheLowerKFactor()
    {
        var result = RankedRules.Calculate(1200, 10, 1200, completed: true);

        Assert.Equal(24, result.KFactor);
        Assert.Equal(12, result.Delta);
        Assert.Equal(1212, result.After);
    }

    [Fact]
    public void AbandoningAHardDrawCannotBeUsedToFishForAnEasyOne()
    {
        var result = RankedRules.Calculate(
            1000,
            0,
            1600,
            completed: false,
            abandoned: true);

        Assert.Equal(-RankedRules.MinimumAbandonmentLoss, result.Delta);
    }

    [Theory]
    [InlineData(899, "Bronze")]
    [InlineData(900, "Silver")]
    [InlineData(1100, "Gold")]
    [InlineData(1300, "Platinum")]
    [InlineData(1500, "Diamond")]
    [InlineData(1700, "Master")]
    public void DivisionBoundariesAreStable(int rating, string expected)
    {
        Assert.Equal(expected, RankedRules.Division(rating).Name);
    }

    [Fact]
    public void TimeNeverChangesRating()
    {
        var fast = RankedRules.Calculate(1250, 12, 1400, completed: true);
        var slow = RankedRules.Calculate(1250, 12, 1400, completed: true);

        Assert.Equal(fast, slow);
    }

    [Fact]
    public void OperationalQualityChangesTheValueOfACompletedRecovery()
    {
        var controlled = RankedRules.Calculate(1300, 12, 1300, score: 1);
        var reckless = RankedRules.Calculate(1300, 12, 1300, score: 0.62);

        Assert.True(controlled.Delta > reckless.Delta);
        Assert.True(reckless.Delta > 0);
    }
}
