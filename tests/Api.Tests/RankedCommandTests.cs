using IsaacWallace.Api.Ranked;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class RankedCommandTests
{
    [Theory]
    [InlineData("scale checkout 4", "scale-4", "apiReplicas", 4)]
    [InlineData(" SCALE   GATEWAY 3 ", "gateway-3", "gatewayReplicas", 3)]
    [InlineData("shift canary 0", "canary-0", "canaryReplicas", 0)]
    [InlineData("set database connections 8", "db-pool-8", "dbMaxConns", 8)]
    public void NumericCommandsAreCanonicalAndBounded(
        string text,
        string actionId,
        string field,
        int value)
    {
        Assert.True(RankedCommand.TryParse(text, out var command, out var error), error);
        Assert.NotNull(command);
        Assert.Equal(actionId, command.ActionId);
        Assert.Equal(value, command.SpecPatch[field]);
    }

    [Theory]
    [InlineData("enable cache", "cache-on", "cacheReplicas", 1)]
    [InlineData("disable cache", "cache-off", "cacheReplicas", 0)]
    [InlineData("rollback checkout", "release-stable", "releaseTrack", "stable")]
    [InlineData("recover catalogue", "data-recover", "dataState", "recovered")]
    [InlineData("drain apps", "move-infra", "targetPool", "infra")]
    [InlineData("restore database network", "network-normal", "networkMode", "normal")]
    public void OperationalCommandsMapToKnownSpecFields(
        string text,
        string actionId,
        string field,
        object value)
    {
        Assert.True(RankedCommand.TryParse(text, out var command, out var error), error);
        Assert.NotNull(command);
        Assert.Equal(actionId, command.ActionId);
        Assert.Equal(value, command.SpecPatch[field]);
    }

    [Theory]
    [InlineData("")]
    [InlineData("scale checkout 99")]
    [InlineData("shift canary -1")]
    [InlineData("set database connections 17")]
    [InlineData("kubectl delete namespace production")]
    [InlineData("cat /etc/passwd")]
    public void ArbitraryOrOutOfRangeInputNeverBecomesAClusterPatch(string text)
    {
        Assert.False(RankedCommand.TryParse(text, out var command, out _));
        Assert.Null(command);
    }
}
