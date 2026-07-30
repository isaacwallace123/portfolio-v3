using IsaacWallace.Api.Ranked;
using Xunit;

namespace IsaacWallace.Api.Tests;

/// <summary>
/// The predicate the whole launch lifecycle exists to enforce: is this environment playable yet.
/// It is pure, so every answer is provable without a cluster.
/// </summary>
public sealed class RankedLaunchGateTests
{
    [Fact]
    public void AnUnreconciledCompositionIsStillProvisioning()
    {
        var gate = RankedLaunchGate.Evaluate(
            reconciled: false,
            namespaceAssigned: false,
            provisioned: false,
            RankedLaunchReadiness.None);

        Assert.Equal(RankedLaunchPhases.Provisioning, gate.Phase);
        Assert.False(gate.ReadyToActivate);
        Assert.NotEqual("", gate.Blocker);
    }

    [Fact]
    public void ANamespaceWithoutAReadyRunIsStillProvisioning()
    {
        var gate = RankedLaunchGate.Evaluate(
            reconciled: true,
            namespaceAssigned: true,
            provisioned: false,
            Serving());

        Assert.Equal(RankedLaunchPhases.Provisioning, gate.Phase);
        Assert.False(gate.ReadyToActivate);
    }

    [Fact]
    public void AMissingRequiredWorkloadBlocksActivation()
    {
        foreach (var missing in RankedLaunchGate.RequiredWorkloads)
        {
            var readiness = Serving() with
            {
                Workloads = RankedLaunchGate.RequiredWorkloads
                    .Where(name => name != missing)
                    .Select(name => new RankedLaunchWorkload(name, 1, 1))
                    .ToArray(),
            };

            var gate = RankedLaunchGate.Evaluate(true, true, true, readiness);

            Assert.Equal(RankedLaunchPhases.StartingWorkloads, gate.Phase);
            Assert.False(gate.ReadyToActivate);
            Assert.Contains(missing, gate.Blocker, StringComparison.Ordinal);
        }
    }

    /// <summary>An arena is provisioned quiet, and a match measured against a silent gateway has
    /// nothing to judge. The gate does not merely wait for the load generator — it asks for it.
    /// </summary>
    [Fact]
    public void AStoppedLoadGeneratorAsksTheLaunchToStartIt()
    {
        var readiness = Serving() with
        {
            Workloads = RankedLaunchGate.RequiredWorkloads
                .Select(name => name == RankedLaunchGate.TrafficWorkload
                    ? new RankedLaunchWorkload(name, 0, 0)
                    : new RankedLaunchWorkload(name, 1, 1))
                .ToArray(),
        };

        var gate = RankedLaunchGate.Evaluate(true, true, true, readiness);

        Assert.Equal(RankedLaunchPhases.StartingWorkloads, gate.Phase);
        Assert.True(gate.TrafficStopped);
        Assert.False(gate.ReadyToActivate);
    }

    /// <summary>A tier the incident has not asked for yet is not something to wait on. Only the
    /// load generator is treated as an instruction when it reads zero.</summary>
    [Fact]
    public void ATierDeliberatelyScaledToZeroDoesNotBlockActivation()
    {
        var readiness = Serving() with
        {
            Workloads = RankedLaunchGate.RequiredWorkloads
                .Select(name => name == "redis"
                    ? new RankedLaunchWorkload(name, 0, 0)
                    : new RankedLaunchWorkload(name, 1, 1))
                .ToArray(),
        };

        var gate = RankedLaunchGate.Evaluate(true, true, true, readiness);

        Assert.Equal(RankedLaunchPhases.ActivatingIncident, gate.Phase);
        Assert.True(gate.ReadyToActivate);
        Assert.False(gate.TrafficStopped);
    }

    [Fact]
    public void AWorkloadWithFewerReadyReplicasThanItWantsBlocksActivation()
    {
        var readiness = Serving() with
        {
            Workloads = RankedLaunchGate.RequiredWorkloads
                .Select(name => new RankedLaunchWorkload(name, name == "checkout" ? 3 : 1, 1))
                .ToArray(),
        };

        var gate = RankedLaunchGate.Evaluate(true, true, true, readiness);

        Assert.Equal(RankedLaunchPhases.StartingWorkloads, gate.Phase);
        Assert.Contains(
            gate.Checks,
            check => check.Id == "workload:checkout" &&
                check.Status == RankedLaunchCheckStatus.Pending);
    }

    [Fact]
    public void UnsampledPodsBlockActivationEvenWhenEveryWorkloadIsUp()
    {
        var gate = RankedLaunchGate.Evaluate(
            true, true, true, Serving() with { SampledPods = 1 });

        Assert.Equal(RankedLaunchPhases.VerifyingTelemetry, gate.Phase);
        Assert.False(gate.ReadyToActivate);
        Assert.Contains(
            gate.Checks,
            check => check.Id == "metrics" && check.Status == RankedLaunchCheckStatus.Pending);
    }

    /// <summary>The distinction that matters: a gateway nobody has scraped and a gateway serving
    /// nothing both read as zero requests a second, and a match cannot be judged in either.</summary>
    [Fact]
    public void AGatewayThatHasNotAnsweredAScrapeBlocksActivation()
    {
        var gate = RankedLaunchGate.Evaluate(
            true,
            true,
            true,
            Serving() with { GatewayReporting = false, ServedRequestsPerSec = 0 });

        Assert.Equal(RankedLaunchPhases.VerifyingTelemetry, gate.Phase);
        Assert.False(gate.ReadyToActivate);
    }

    [Fact]
    public void AnIdleGatewayBlocksActivation()
    {
        var gate = RankedLaunchGate.Evaluate(
            true, true, true, Serving() with { ServedRequestsPerSec = 0 });

        Assert.Equal(RankedLaunchPhases.VerifyingTelemetry, gate.Phase);
        Assert.False(gate.ReadyToActivate);
    }

    [Fact]
    public void AVerifiedEnvironmentOpensTheActivationBoundary()
    {
        var gate = RankedLaunchGate.Evaluate(true, true, true, Serving());

        Assert.Equal(RankedLaunchPhases.ActivatingIncident, gate.Phase);
        Assert.True(gate.ReadyToActivate);
        Assert.Equal("", gate.Blocker);
        Assert.All(
            gate.Checks,
            check => Assert.Equal(RankedLaunchCheckStatus.Satisfied, check.Status));
    }

    [Fact]
    public void PhasesAreOrderedAndOnlyActiveOrFailedAreTerminal()
    {
        Assert.Equal(
            [
                RankedLaunchPhases.Provisioning,
                RankedLaunchPhases.StartingWorkloads,
                RankedLaunchPhases.VerifyingTelemetry,
                RankedLaunchPhases.ActivatingIncident,
                RankedLaunchPhases.Active,
            ],
            RankedLaunchPhases.Order);
        Assert.Equal(1, RankedLaunchPhases.StepOf(RankedLaunchPhases.Provisioning));
        Assert.Equal(5, RankedLaunchPhases.StepOf(RankedLaunchPhases.Active));
        Assert.Equal(0, RankedLaunchPhases.StepOf(RankedLaunchPhases.Failed));
        Assert.True(RankedLaunchPhases.IsTerminal(RankedLaunchPhases.Active));
        Assert.True(RankedLaunchPhases.IsTerminal(RankedLaunchPhases.Failed));
        Assert.False(RankedLaunchPhases.IsTerminal(RankedLaunchPhases.ActivatingIncident));
    }

    [Fact]
    public void PhaseDeadlinesAreCumulativeFromTheMomentTheLaunchOpened()
    {
        var budget = new RankedLaunchBudget(
            TimeSpan.FromMinutes(5),
            TimeSpan.FromMinutes(4),
            TimeSpan.FromMinutes(3),
            TimeSpan.FromMinutes(1));

        Assert.Equal(
            TimeSpan.FromMinutes(5), budget.DeadlineFor(RankedLaunchPhases.Provisioning));
        Assert.Equal(
            TimeSpan.FromMinutes(9), budget.DeadlineFor(RankedLaunchPhases.StartingWorkloads));
        Assert.Equal(
            TimeSpan.FromMinutes(12), budget.DeadlineFor(RankedLaunchPhases.VerifyingTelemetry));
        Assert.Equal(TimeSpan.FromMinutes(13), budget.Total);
    }

    private static RankedLaunchReadiness Serving() =>
        new(
            RankedLaunchGate.RequiredWorkloads
                .Select(name => new RankedLaunchWorkload(name, 1, 1))
                .ToArray(),
            SampledPods: 6,
            GatewayReporting: true,
            ServedRequestsPerSec: 400,
            OfferedRequestsPerSec: 400);
}
