using IsaacWallace.Api.Ranked;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class RankedInspectionTests
{
    [Theory]
    [InlineData("inspect metrics", "inspect metrics", "metrics", null, false)]
    [InlineData(" INSPECT   METRICS   API ", "inspect metrics checkout", "metrics", "checkout", false)]
    [InlineData("inspect pods canary", "inspect pods checkout-canary", "pods", "checkout-canary", false)]
    [InlineData("inspect logs database", "inspect logs postgres", "logs", "postgres", false)]
    [InlineData("inspect events --warnings", "inspect events --warnings", "events", null, true)]
    [InlineData("inspect deployments", "inspect deployments", "deployments", null, false)]
    [InlineData("trace latest", "trace latest", "trace", null, false)]
    [InlineData("history", "history", "history", null, false)]
    public void AllowlistedReadsAreCanonical(
        string input,
        string canonical,
        string kind,
        string? service,
        bool warningsOnly)
    {
        Assert.True(RankedInspection.TryParse(input, out var inspection, out var error), error);
        Assert.NotNull(inspection);
        Assert.Equal(canonical, inspection.Canonical);
        Assert.Equal(kind, inspection.Kind);
        Assert.Equal(service, inspection.Service);
        Assert.Equal(warningsOnly, inspection.WarningsOnly);
    }

    [Theory]
    [InlineData("")]
    [InlineData("inspect")]
    [InlineData("inspect secrets")]
    [InlineData("inspect logs kube-system")]
    [InlineData("inspect events --all-namespaces")]
    [InlineData("kubectl get pods")]
    public void ArbitraryReadsNeverReachTheCluster(string input)
    {
        Assert.False(RankedInspection.TryParse(input, out var inspection, out _));
        Assert.Null(inspection);
    }
}
