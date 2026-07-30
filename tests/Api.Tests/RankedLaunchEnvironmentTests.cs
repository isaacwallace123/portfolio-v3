using IsaacWallace.Api.Ranked;
using IsaacWallace.Api.Runs;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class RankedLaunchEnvironmentTests
{
    [Fact]
    public void TheClockRemainsAuthoritativeWhenADrillCanNoLongerBeProjected()
    {
        var resource = Resource();
        resource.Spec.DrillId = "ranked:v1:token-that-does-not-materialize";
        resource.Spec.DrillStartedAt = "2026-07-30T12:00:00Z";
        resource.Metadata.Annotations![RunBroker.DrillModeAnnotation] = "ranked";
        resource.Metadata.Annotations[RankedLaunchOrchestrator.LaunchAttemptAnnotation] =
            "0123456789abcdef0123456789abcdef";

        var cluster = RankedLaunchEnvironment.Cluster(resource);

        Assert.True(cluster.ClockStarted);
        Assert.Equal("", cluster.ActiveDrillId);
        Assert.Equal("", cluster.DrillMode);
        Assert.False(cluster.IsLiveRankedMatch);
        Assert.NotEqual("", cluster.LaunchAttemptId);
        Assert.True(RunBroker.HasStartedClock(resource));
    }

    [Fact]
    public void ClusterSafetyFactsComeFromTheResourceNotLaunchLabels()
    {
        var resource = Resource();
        resource.Metadata.DeletionTimestamp =
            new DateTime(2026, 7, 30, 12, 1, 0, DateTimeKind.Utc);
        resource.Status!.Conditions =
        [
            new LabRunCondition { Type = "Synced", Status = "False" },
        ];

        var cluster = RankedLaunchEnvironment.Cluster(resource);

        Assert.Equal("42", cluster.Version);
        Assert.False(cluster.Reconciled);
        Assert.False(cluster.Provisioned);
        Assert.True(cluster.NamespaceAssigned);
        Assert.True(cluster.Deleting);
    }

    private static LabRunResource Resource() =>
        new()
        {
            Metadata = new LabRunMetadata
            {
                Name = "run-hl-0123456789abcdef",
                ResourceVersion = "42",
                Annotations = new Dictionary<string, string>
                {
                    [RankedLaunchOrchestrator.LaunchIdAnnotation] = "launch",
                },
            },
            Spec = new LabRunSpec
            {
                RunId = "run-hl-0123456789abcdef",
                ScenarioId = ScenarioDefinitions.SandboxId,
                Owner = "0123456789abcdef0123456789abcdef",
            },
            Status = new LabRunStatus
            {
                Namespace = "run-test",
                Conditions =
                [
                    new LabRunCondition { Type = "Ready", Status = "True" },
                ],
            },
        };
}
