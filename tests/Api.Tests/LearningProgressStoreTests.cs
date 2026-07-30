using IsaacWallace.Api.Data;
using IsaacWallace.Api.Learning;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class LearningProgressStoreTests
{
    [Fact]
    public async Task ClusterCompletionUsesRunAsAnIdempotencyKey()
    {
        await using var fixture = await LearningFixture.CreateAsync();
        const string unitId = "drill:read-the-system:checkout-traffic-spike";
        var completion = new UnitCompletion(
            "drill",
            null,
            42_000,
            true,
            false,
            "run-hl-learning1",
            "guided",
            0);

        await fixture.Store.CompleteClusterUnitAsync(
            "owner-learning",
            CourseManifests.ProductionOperations,
            unitId,
            completion,
            CancellationToken.None);
        await fixture.Store.CompleteClusterUnitAsync(
            "owner-learning",
            CourseManifests.ProductionOperations,
            unitId,
            completion,
            CancellationToken.None);

        var progress = await fixture.Store.GetAsync(
            "owner-learning",
            CourseManifests.ProductionOperations,
            CancellationToken.None);
        var unit = Assert.Single(progress.Units);
        Assert.Equal("completed", unit.Status);
        Assert.Equal(1, unit.Attempts);
        Assert.Equal(42_000, unit.BestElapsedMs);
        Assert.True(unit.Clean);
        Assert.Equal(1, await fixture.Db.Attempts.CountAsync());
    }

    [Fact]
    public void ManifestAllowsOptionalPracticeWithoutMakingItRequired()
    {
        var course = CourseManifests.ProductionOperations;
        const string optional = "drill:capacity-and-scaling:front-and-back";

        Assert.True(course.Contains(optional));
        Assert.DoesNotContain(optional, course.AllRequiredUnitIds);
    }

    private sealed class LearningFixture(
        SqliteConnection connection,
        LearningDbContext db,
        LearningProgressStore store) : IAsyncDisposable
    {
        public LearningDbContext Db { get; } = db;
        public LearningProgressStore Store { get; } = store;

        public static async Task<LearningFixture> CreateAsync()
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<LearningDbContext>()
                .UseSqlite(connection)
                .Options;
            var db = new LearningDbContext(options);
            await db.EnsureSchemaAsync();
            return new LearningFixture(
                connection,
                db,
                new LearningProgressStore(
                    db,
                    NullLogger<LearningProgressStore>.Instance));
        }

        public async ValueTask DisposeAsync()
        {
            await Db.DisposeAsync();
            await connection.DisposeAsync();
        }
    }
}
