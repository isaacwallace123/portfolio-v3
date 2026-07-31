using System.Text.Json;
using IsaacWallace.Api.Ranked;
using Xunit;

namespace IsaacWallace.Api.Tests;

/// <summary>
/// The stream's pacing and change detection. Both are pure, which is the point: they decide how hard
/// a launch leans on the live API server and how much of the state it re-sends, and neither should
/// need a cluster to be proven.
/// </summary>
public sealed class RankedLaunchStreamTests
{
    private static RankedLaunchView View(
        string phase = RankedLaunchPhases.Provisioning,
        string detail = "The disposable cluster is still being provisioned.",
        int elapsed = 10,
        params RankedLaunchCheck[] checks) =>
        new(
            LaunchId: "launch",
            RunId: "run-hl-0123456789abcdef",
            Phase: phase,
            Step: RankedLaunchPhases.StepOf(phase),
            Steps: RankedLaunchPhases.Order.Count,
            Title: RankedLaunchPhases.TitleOf(phase),
            Detail: detail,
            Terminal: RankedLaunchPhases.IsTerminal(phase),
            Active: phase == RankedLaunchPhases.Active,
            Failed: phase == RankedLaunchPhases.Failed,
            FailureReason: "",
            Retryable: phase == RankedLaunchPhases.Failed,
            LaunchElapsedSeconds: elapsed,
            LaunchBudgetSeconds: 660,
            ClockStarted: phase == RankedLaunchPhases.Active,
            MatchElapsedMs: 0,
            AttemptId: "",
            Checks: checks);

    [Fact]
    public void ElapsedTimeAloneIsNotAStateChange()
    {
        // The whole reason elapsed seconds ride on their own frame: if a moving clock counted as a
        // change, the stream would re-send every check on every tick and save nothing.
        Assert.True(RankedLaunchStream.SameState(View(elapsed: 10), View(elapsed: 47)));
    }

    [Fact]
    public void AFirstObservationIsAlwaysSent()
    {
        Assert.False(RankedLaunchStream.SameState(null, View()));
    }

    [Fact]
    public void APhaseChangeIsSent()
    {
        Assert.False(
            RankedLaunchStream.SameState(
                View(), View(phase: RankedLaunchPhases.StartingWorkloads)));
    }

    [Fact]
    public void AWorkloadComingUpUnderAnUnchangedPhaseIsStillSent()
    {
        // Starting-workloads is one phase for minutes. If only the phase were compared, the operator
        // would watch a frozen list while five deployments came up behind it.
        var before = View(
            phase: RankedLaunchPhases.StartingWorkloads,
            checks: new RankedLaunchCheck(
                "workload:checkout", "checkout", RankedLaunchCheckStatus.Pending,
                "0/2 replicas ready."));
        var after = View(
            phase: RankedLaunchPhases.StartingWorkloads,
            checks: new RankedLaunchCheck(
                "workload:checkout", "checkout", RankedLaunchCheckStatus.Pending,
                "1/2 replicas ready."));

        Assert.False(RankedLaunchStream.SameState(before, after));
    }

    [Fact]
    public void ACheckFlippingToSatisfiedIsSent()
    {
        var before = View(
            phase: RankedLaunchPhases.VerifyingTelemetry,
            checks: new RankedLaunchCheck(
                "gateway", "Gateway telemetry", RankedLaunchCheckStatus.Pending, "same"));
        var after = View(
            phase: RankedLaunchPhases.VerifyingTelemetry,
            checks: new RankedLaunchCheck(
                "gateway", "Gateway telemetry", RankedLaunchCheckStatus.Satisfied, "same"));

        Assert.False(RankedLaunchStream.SameState(before, after));
    }

    [Fact]
    public void ObservationCostDecidesTheTick()
    {
        // Provisioning is answered from one list of LabRuns. Everything after it costs a full frame
        // of the namespace, so it is deliberately checked half as often.
        Assert.Equal(TimeSpan.FromSeconds(1), RankedLaunchStream.TickFor(
            RankedLaunchPhases.Provisioning));
        Assert.Equal(TimeSpan.FromSeconds(2), RankedLaunchStream.TickFor(
            RankedLaunchPhases.StartingWorkloads));
        Assert.Equal(TimeSpan.FromSeconds(2), RankedLaunchStream.TickFor(
            RankedLaunchPhases.VerifyingTelemetry));
    }

    [Fact]
    public void ActivationDoesNotWaitBetweenItsWrites()
    {
        // The activation boundary has nothing to observe — it is a short ordered sequence of writes,
        // and the operator is about to be timed. A full tick here is pure added latency.
        Assert.True(
            RankedLaunchStream.TickFor(RankedLaunchPhases.ActivatingIncident) <
            RankedLaunchStream.TickFor(RankedLaunchPhases.Provisioning));
    }

    [Fact]
    public void AnUnknownPhaseFallsBackToTheConservativeTick()
    {
        Assert.Equal(TimeSpan.FromSeconds(2), RankedLaunchStream.TickFor("something-new"));
    }

    [Fact]
    public void TheConnectionCeilingOutlastsTheLaunchBudget()
    {
        // The budget is what fails a launch. This is only a backstop against a connection that
        // somehow never sees a terminal phase, so it must never be the thing that ends one.
        Assert.True(RankedLaunchStream.Ceiling > RankedLaunchBudget.Default.Total);
    }

    [Fact]
    public void EveryFrameIsOneLineOfJsonTerminatedByABlankLine()
    {
        // SSE splits frames on a blank line and data lines on newlines. A payload that serialized
        // with embedded newlines would silently arrive as several unparseable data lines.
        var frame = RankedLaunchStream.LaunchFrame(View(detail: "Waiting for cluster workloads."));

        Assert.StartsWith("event: launch\ndata: ", frame, StringComparison.Ordinal);
        Assert.EndsWith("\n\n", frame, StringComparison.Ordinal);
        var payload = frame["event: launch\ndata: ".Length..^2];
        Assert.DoesNotContain('\n', payload);

        using var parsed = JsonDocument.Parse(payload);
        Assert.Equal(
            "run-hl-0123456789abcdef",
            parsed.RootElement.GetProperty("launch").GetProperty("runId").GetString());
    }

    [Fact]
    public void TheTickFrameCarriesNothingButElapsedTime()
    {
        var frame = RankedLaunchStream.TickFrame(42);
        var payload = frame["event: tick\ndata: ".Length..^2];

        using var parsed = JsonDocument.Parse(payload);
        Assert.Equal(42, parsed.RootElement.GetProperty("launchElapsedSeconds").GetInt32());
        Assert.Single(parsed.RootElement.EnumerateObject());
    }

    [Fact]
    public void FramesUseTheWebNamingTheRestOfTheApiAnswersWith()
    {
        // The client parses launch frames with the same code it parses the REST response with, so a
        // frame that serialized in PascalCase would type-check and then quietly render nothing.
        var frame = RankedLaunchStream.LaunchFrame(View());

        Assert.Contains("\"launchElapsedSeconds\":", frame, StringComparison.Ordinal);
        Assert.DoesNotContain("\"LaunchElapsedSeconds\":", frame, StringComparison.Ordinal);
    }
}
