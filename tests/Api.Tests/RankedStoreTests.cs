using IsaacWallace.Api.Data;
using IsaacWallace.Api.Ranked;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class RankedStoreTests
{
    [Fact]
    public async Task FinalizationMutatesRatingAndLedgerExactlyOnce()
    {
        await using var fixture = await RankedFixture.CreateAsync();
        var started = new DateTime(2026, 7, 30, 1, 0, 0, DateTimeKind.Utc);
        var attempt = await fixture.Store.BeginAsync(
            "run-hl-a123456789",
            "cascade-scale-release",
            "owner-a",
            "Ada",
            started,
            CancellationToken.None);

        var before = await fixture.Store.ProfileAsync(
            "owner-a", CancellationToken.None);
        Assert.Equal(RankedOutcomes.Active, before.RecentAttempts.Single().Outcome);
        Assert.Equal(RankedRules.InitialRating, before.Rating);
        Assert.Equal(0, before.GamesPlayed);
        Assert.Null(before.LadderRank);
        Assert.Equal(0, before.RatedOperators);

        var result = await fixture.Store.FinalizeAsync(
            attempt.Id,
            "owner-a",
            RankedOutcomes.Completed,
            42_000,
            3,
            "",
            "Ada",
            CancellationToken.None);
        var duplicate = await fixture.Store.FinalizeAsync(
            attempt.Id,
            "owner-a",
            RankedOutcomes.Failed,
            99_000,
            1,
            "wrong-move",
            "Ada",
            CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(RankedOutcomes.Completed, result.Outcome);
        Assert.Equal(42_000, result.ElapsedMs);
        Assert.Equal(28, result.RatingDelta);
        Assert.Equal(result, duplicate);

        var profile = await fixture.Store.ProfileAsync(
            "owner-a", CancellationToken.None);
        Assert.Equal(1028, profile.Rating);
        Assert.Equal(1, profile.GamesPlayed);
        Assert.Equal(1, profile.Wins);
        Assert.Equal(0, profile.Losses);
        Assert.Equal(1, profile.CurrentStreak);
        Assert.Equal(4, profile.ProvisionalGamesRemaining);
        Assert.Equal(1, profile.LadderRank);
        Assert.Equal(1, profile.RatedOperators);
        Assert.Equal(1, await fixture.Db.RatingLedger.CountAsync(
            CancellationToken.None));
    }

    [Fact]
    public async Task VoidAttemptDoesNotChangeTheOperatorRating()
    {
        await using var fixture = await RankedFixture.CreateAsync();
        var attempt = await fixture.Store.BeginAsync(
            "run-hl-b123456789",
            "cascade-cost-surge",
            "owner-b",
            "Grace",
            DateTime.UtcNow,
            CancellationToken.None);

        var result = await fixture.Store.FinalizeAsync(
            attempt.Id,
            "owner-b",
            RankedOutcomes.Void,
            0,
            0,
            "",
            "",
            CancellationToken.None);
        var profile = await fixture.Store.ProfileAsync(
            "owner-b", CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(RankedOutcomes.Void, result.Outcome);
        Assert.Equal(0, result.RatingDelta);
        Assert.Equal(RankedRules.InitialRating, profile.Rating);
        Assert.Equal(0, profile.GamesPlayed);
        Assert.Empty(await fixture.Db.RatingLedger.ToListAsync(
            CancellationToken.None));
    }

    [Theory]
    [InlineData(RankedOutcomes.Forfeited)]
    [InlineData(RankedOutcomes.Expired)]
    public async Task AbandonedAttemptUsesTheMinimumPenalty(string outcome)
    {
        await using var fixture = await RankedFixture.CreateAsync();
        var attempt = await fixture.Store.BeginAsync(
            "run-hl-f123456789",
            "cascade-full-sev",
            "owner-f",
            "Margaret",
            DateTime.UtcNow,
            CancellationToken.None);

        var result = await fixture.Store.FinalizeAsync(
            attempt.Id,
            "owner-f",
            outcome,
            8_000,
            1,
            "",
            "Margaret",
            CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(-RankedRules.MinimumAbandonmentLoss, result.RatingDelta);
        Assert.Equal(988, result.PostRating);
    }

    [Fact]
    public async Task OwnerCannotOpenTwoActiveAttempts()
    {
        await using var fixture = await RankedFixture.CreateAsync();
        await fixture.Store.BeginAsync(
            "run-hl-c123456789",
            "cascade-canary",
            "owner-c",
            "Linus",
            DateTime.UtcNow,
            CancellationToken.None);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            fixture.Store.BeginAsync(
                "run-hl-d123456789",
                "cascade-full-sev",
                "owner-c",
                "Linus",
                DateTime.UtcNow.AddSeconds(1),
                CancellationToken.None));

        Assert.Equal("A ranked attempt is already active.", error.Message);
        Assert.Equal(1, await fixture.Db.RankedAttempts.CountAsync(
            CancellationToken.None));
    }

    [Fact]
    public async Task DatabaseEnforcesOneActiveAttemptAcrossApiReplicas()
    {
        await using var fixture = await RankedFixture.CreateAsync();
        await fixture.Store.BeginAsync(
            "run-hl-u123456789",
            "cascade-canary",
            "owner-unique",
            "Barbara",
            DateTime.UtcNow,
            CancellationToken.None);
        fixture.Db.ChangeTracker.Clear();
        fixture.Db.RankedAttempts.Add(new RankedAttempt
        {
            RunId = "run-hl-v123456789",
            DrillId = "cascade-canary",
            OwnerKey = "owner-unique",
            DisplayName = "Barbara",
            Outcome = RankedOutcomes.Active,
            StartedUtc = DateTime.UtcNow.AddSeconds(1),
        });

        await Assert.ThrowsAsync<DbUpdateException>(
            () => fixture.Db.SaveChangesAsync(CancellationToken.None));
    }

    [Fact]
    public async Task EqualRatingsShareTheSameLadderRank()
    {
        await using var fixture = await RankedFixture.CreateAsync();
        foreach (var owner in new[] { "owner-rank-a", "owner-rank-b" })
        {
            var attempt = await fixture.Store.BeginAsync(
                $"run-hl-{owner[^1]}123456789",
                "cascade-scale-release",
                owner,
                owner,
                DateTime.UtcNow,
                CancellationToken.None);
            await fixture.Store.FinalizeAsync(
                attempt.Id,
                owner,
                RankedOutcomes.Completed,
                60_000,
                3,
                "",
                owner,
                CancellationToken.None);
        }

        var standings = await fixture.Store.LeaderboardAsync(
            "owner-rank-a", 25, CancellationToken.None);

        Assert.Equal(2, standings.Count);
        Assert.All(standings, row => Assert.Equal(1, row.Rank));
        Assert.Single(standings, row => row.IsYou);
    }

    private sealed class RankedFixture(
        SqliteConnection connection,
        HomeOpsDbContext db,
        RankedStore store) : IAsyncDisposable
    {
        public HomeOpsDbContext Db { get; } = db;
        public RankedStore Store { get; } = store;

        public static async Task<RankedFixture> CreateAsync()
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<HomeOpsDbContext>()
                .UseSqlite(connection)
                .Options;
            var db = new HomeOpsDbContext(options);
            await db.EnsureSchemaAsync();
            return new RankedFixture(
                connection,
                db,
                new RankedStore(db, NullLogger<RankedStore>.Instance));
        }

        public async ValueTask DisposeAsync()
        {
            await Db.DisposeAsync();
            await connection.DisposeAsync();
        }
    }
}
