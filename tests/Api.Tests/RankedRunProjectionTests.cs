using IsaacWallace.Api.Ranked;
using IsaacWallace.Api.Runs;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class RankedRunProjectionTests
{
    [Fact]
    public void ActiveGeneratedRunExposesBriefingButNoQuizOrDebrief()
    {
        var plan = Plan();
        var resource = Resource(plan);

        var view = RunView.From(resource);

        Assert.Equal("ranked", view.DrillMode);
        Assert.Empty(view.AcceptedDecisions);
        Assert.Empty(view.AvailableDecisions);
        Assert.Empty(view.DrillOptions);
        Assert.Equal(0, view.DrillCorrectTotal);
        Assert.NotNull(view.RankedBriefing);
        Assert.Null(view.RankedDebrief);
    }

    [Fact]
    public void GeneratedRunRevealsDebriefOnlyAfterARecordedSolve()
    {
        var plan = Plan();
        var resource = Resource(plan);
        resource.Metadata.Annotations![RunBroker.DrillSolvedAnnotation] =
            DateTime.UtcNow.ToString("O");

        var view = RunView.From(resource);

        Assert.True(view.DrillSolved);
        Assert.NotNull(view.RankedDebrief);
        Assert.Equal(
            plan.Faults.Select(fault => fault.ModuleId).OrderBy(id => id),
            view.RankedDebrief.Faults.Select(fault => fault.ModuleId).OrderBy(id => id));
    }

    [Fact]
    public void PublicTelemetryUsesNullForWithheldLiveValues()
    {
        var visibility = new RankedTelemetryVisibility(
            Throughput: false,
            Latency: false,
            Errors: true,
            State: true);

        var projected = PublicRunTelemetry.From(
            new RunTelemetry(8, 900, 512, 20, 3, true, 777, 123.4, 1.2),
            visibility);

        Assert.Null(projected.RequestsPerSec);
        Assert.Null(projected.P95LatencyMs);
        Assert.Equal(1.2, projected.ErrorRatePct);
        Assert.Equal(3, projected.ApiReplicas);
    }

    private static RankedScenarioPlan Plan() =>
        RankedScenarioGenerator.Generate(
            new RankedScenarioSeed(
                1234.ToString("x32"),
                RankedScenarioSeed.CurrentVersion,
                1700));

    private static LabRunResource Resource(RankedScenarioPlan plan)
    {
        var now = DateTime.UtcNow.AddMinutes(-1);
        return new LabRunResource
        {
            Metadata = new LabRunMetadata
            {
                CreationTimestamp = now,
                Annotations = new Dictionary<string, string>
                {
                    [RunBroker.DrillModeAnnotation] = "ranked",
                    [RunBroker.DrillStageAnnotation] = "0",
                    [RunBroker.DrillStageStartedAnnotation] = now.ToString("O"),
                },
            },
            Spec = new LabRunSpec
            {
                RunId = "run-hl-projection",
                ScenarioId = ScenarioDefinitions.SandboxId,
                Owner = "owner",
                DrillId = plan.DrillId,
                DrillStartedAt = now.ToString("O"),
                LoadReplicas = plan.Initial.LoadGenerators,
            },
        };
    }
}
