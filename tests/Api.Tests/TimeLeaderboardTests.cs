using IsaacWallace.Api.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class TimeLeaderboardTests
{
    [Fact]
    public async Task OneTimeBoardOrdersOperatorsByFastestVerifiedRecovery()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<HomeOpsDbContext>()
            .UseSqlite(connection)
            .Options;
        await using var db = new HomeOpsDbContext(options);
        await db.EnsureSchemaAsync();
        var now = new DateTime(2026, 7, 30, 6, 0, 0, DateTimeKind.Utc);

        db.DrillResults.AddRange(
            Result("run-a1", "owner-a", "Ada", "cascade-one", 60_000, now),
            Result("run-a2", "owner-a", "Ada", "cascade-two", 70_000, now.AddMinutes(1)),
            Result("run-b1", "owner-b", "Grace", "cascade-one", 40_000, now.AddMinutes(2)),
            Result("run-c1", "owner-c", "Linus", "cascade-two", 50_000, now.AddMinutes(3)),
            Result("run-p1", "owner-p", "Practice", "cascade-one", 1_000, now, "practice"));
        await db.SaveChangesAsync();

        var store = new DrillResultStore(
            db,
            NullLogger<DrillResultStore>.Instance);
        var board = await store.LeaderboardAsync(
            "owner-b",
            new Dictionary<string, string>
            {
                ["cascade-one"] = "One",
                ["cascade-two"] = "Two",
            },
            25,
            CancellationToken.None);

        Assert.Equal(["Grace", "Linus", "Ada"], board.Entries.Select(x => x.DisplayName));
        Assert.Equal([40_000, 50_000, 60_000], board.Entries.Select(x => x.BestMs));
        Assert.True(board.Entries[0].IsYou);
        Assert.Equal(2, board.Entries[2].DrillsSolved);
    }

    private static DrillResult Result(
        string runId,
        string owner,
        string name,
        string drill,
        long elapsedMs,
        DateTime completed,
        string mode = "ranked") =>
        new()
        {
            RunId = runId,
            DrillId = drill,
            Mode = mode,
            OwnerKey = owner,
            DisplayName = name,
            StageCount = 2,
            ElapsedMs = elapsedMs,
            StartedUtc = completed.AddMilliseconds(-elapsedMs),
            CompletedUtc = completed,
        };
}
