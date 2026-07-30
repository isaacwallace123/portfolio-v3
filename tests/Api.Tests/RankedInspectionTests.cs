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

    [Fact]
    public async Task LogProjectionIsBoundedAndRedactsCredentialsAndControls()
    {
        var raw =
            "\u001b[31mAuthorization: Bearer top-secret\u001b[0m\t"
            + "DATABASE_URL=postgres://checkout:hunter2@postgres:5432/db "
            + "token=abc123\r\n";
        var sanitized = RankedLogSanitizer.Sanitize(raw);

        Assert.DoesNotContain("top-secret", sanitized);
        Assert.DoesNotContain("hunter2", sanitized);
        Assert.DoesNotContain("abc123", sanitized);
        Assert.DoesNotContain('\u001b', sanitized);
        Assert.DoesNotContain('\r', sanitized);
        Assert.DoesNotContain('\n', sanitized);

        using var reader = new StringReader(new string('x', 4096));
        var bounded = await RankedLogSanitizer.ReadBoundedAsync(reader, 257);
        Assert.Equal(257, bounded.Length);
        Assert.Equal(
            RankedLogSanitizer.MaxLineLength + 3,
            RankedLogSanitizer.Sanitize(new string('x', 1000)).Length);
    }

    [Fact]
    public void OversizedInspectionIsRejectedBeforeParsing()
    {
        var input = new string('a', RankedInspection.MaxInputLength + 1);
        Assert.False(RankedInspection.TryParse(input, out var inspection, out var error));
        Assert.Null(inspection);
        Assert.Contains("characters or fewer", error);
    }
}
