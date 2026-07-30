using System.Text.Json.Nodes;
using IsaacWallace.Api.Runs;
using k8s;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class RunBrokerCompareAndSetTests
{
    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    public void CompareAndSetRejectsAMissingResourceVersion(string version)
    {
        Assert.Throws<ArgumentException>(() => RunBroker.RequireExpectedVersion(version));
    }

    [Fact]
    public void CompareAndSetMergePreservesThePatchAndAddsItsVersionGuard()
    {
        var merged = RunBroker.Merge(
            new
            {
                metadata = new
                {
                    annotations = new Dictionary<string, string?>
                    {
                        ["homeops.isaacwallace.dev/ranked-launch-phase"] = "active",
                    },
                },
                spec = new { drillStartedAt = "2026-07-30T12:00:00Z" },
            },
            "812");
        var json = JsonNode.Parse(KubernetesJson.Serialize(merged))!.AsObject();

        Assert.Equal("812", json["metadata"]!["resourceVersion"]!.GetValue<string>());
        Assert.Equal(
            "active",
            json["metadata"]!["annotations"]![
                "homeops.isaacwallace.dev/ranked-launch-phase"]!.GetValue<string>());
        Assert.Equal(
            "2026-07-30T12:00:00Z",
            json["spec"]!["drillStartedAt"]!.GetValue<string>());
    }
}
