using IsaacWallace.Api.Ranked;
using IsaacWallace.Api.Runs;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class RankedPerformanceTests
{
    private static readonly ScenarioDefinition Scenario =
        ScenarioDefinitions.All["cascade-scale-release"];

    [Fact]
    public void ControlledRecoveryOutranksARecklessFastRecoveryWithoutUsingElapsedTime()
    {
        var started = new DateTime(2026, 7, 30, 10, 0, 0, DateTimeKind.Utc);
        var controlled = RankedPerformance.Evaluate(
            RankedOutcomes.Completed,
            Scenario,
            [
                Partial(started),
                Healthy(started.AddSeconds(90), held: 5),
                Healthy(started.AddSeconds(100), held: 15),
            ],
            [new("scale checkout 6", 1, started.AddSeconds(30))],
            verificationTargetSeconds: 15);
        var reckless = RankedPerformance.Evaluate(
            RankedOutcomes.Completed,
            Scenario,
            [
                Partial(started),
                Degraded(started.AddSeconds(8)),
                Unhealthy(started.AddSeconds(18)),
                Healthy(started.AddSeconds(30), held: 15),
            ],
            [
                new("scale gateway 3", 1, started.AddSeconds(2)),
                new("scale checkout 1", 1, started.AddSeconds(12)),
                new("scale checkout 6", 1, started.AddSeconds(22)),
            ],
            verificationTargetSeconds: 15);

        Assert.True(controlled.QualityScore >= 90);
        Assert.True(controlled.RatingScore >= 0.95);
        Assert.True(controlled.RatingScore > reckless.RatingScore);
        Assert.True(controlled.QualityScore > reckless.QualityScore);
        Assert.Equal(2, reckless.HarmfulActions);
        Assert.Equal(1, reckless.TargetedActions);
    }

    [Fact]
    public void RepeatedAndOutOfScenarioMutationsAreVisibleInTheAudit()
    {
        var at = DateTime.UtcNow;
        var result = RankedPerformance.Evaluate(
            RankedOutcomes.Completed,
            Scenario,
            [
                Partial(at),
                Healthy(at.AddSeconds(8), held: 15),
                Healthy(at.AddSeconds(18), held: 15),
                Healthy(at.AddSeconds(28), held: 15),
            ],
            [
                new("scale checkout 6", 1, at.AddSeconds(2)),
                new("scale checkout 6", 1, at.AddSeconds(10)),
                new("recover catalogue", 1, at.AddSeconds(20)),
            ],
            verificationTargetSeconds: 15);

        Assert.Equal(1, result.TargetedActions);
        Assert.Equal(1, result.RedundantActions);
        Assert.Equal(1, result.UnnecessaryActions);
        Assert.True(result.ActionScore < 100);
    }

    [Fact]
    public void MutatingAgainBeforeAWindowCanConvergeIsPenalized()
    {
        var at = DateTime.UtcNow;
        var result = RankedPerformance.Evaluate(
            RankedOutcomes.Completed,
            Scenario,
            [Partial(at), Healthy(at.AddSeconds(12), held: 15)],
            [
                new("scale gateway 3", 1, at.AddSeconds(1)),
                new("scale checkout 6", 1, at.AddSeconds(3)),
            ],
            verificationTargetSeconds: 15);

        Assert.Equal(1, result.ConvergenceViolations);
        Assert.True(result.ActionScore < 100);
    }

    [Fact]
    public void UncontainedAttemptsCannotEarnPartialRatingByReachingLaterStages()
    {
        var at = DateTime.UtcNow;
        var result = RankedPerformance.Evaluate(
            RankedOutcomes.Failed,
            Scenario,
            [Healthy(at, held: 0, stage: 3)],
            [new("scale checkout 6", 1, at)],
            verificationTargetSeconds: 15);

        Assert.True(result.ContainmentScore > 0);
        Assert.Equal(0, result.RatingScore);
        Assert.Equal("uncontained", result.Band);
    }

    private static RankedTelemetryFrame Healthy(
        DateTime at,
        int held,
        int stage = 1) =>
        new(
            at,
            stage,
            1000,
            1000,
            120,
            0.2,
            3,
            3,
            3,
            3,
            held);

    private static RankedTelemetryFrame Unhealthy(DateTime at) =>
        new(
            at,
            1,
            1000,
            300,
            950,
            12,
            0,
            3,
            0,
            3,
            0);

    private static RankedTelemetryFrame Partial(DateTime at) =>
        new(
            at,
            1,
            1000,
            650,
            500,
            2,
            2,
            3,
            2,
            3,
            0);

    private static RankedTelemetryFrame Degraded(DateTime at) =>
        new(
            at,
            1,
            1000,
            450,
            750,
            6,
            1,
            3,
            1,
            3,
            0);
}
