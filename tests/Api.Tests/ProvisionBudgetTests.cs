using IsaacWallace.Api.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class ProvisionBudgetTests
{
    private const string Owner = "0123456789abcdef0123456789abcdef";

    [Fact]
    public async Task ProvisioningIsCappedAcrossTheAuthoritativeWindow()
    {
        await using var harness = await Harness.CreateAsync();
        var now = new DateTime(2026, 7, 30, 12, 0, 0, DateTimeKind.Utc);

        for (var count = 0; count < 5; count++)
        {
            Assert.True(await harness.Store.TryConsumeProvisionAsync(
                Owner,
                now.AddMinutes(count * 2),
                maximum: 5,
                TimeSpan.FromHours(1),
                TimeSpan.FromSeconds(30),
                CancellationToken.None));
        }

        Assert.False(await harness.Store.TryConsumeProvisionAsync(
            Owner,
            now.AddMinutes(12),
            maximum: 5,
            TimeSpan.FromHours(1),
            TimeSpan.FromSeconds(30),
            CancellationToken.None));
    }

    [Fact]
    public async Task SimultaneousStartsAreCollapsedByTheCooldown()
    {
        await using var harness = await Harness.CreateAsync();
        var now = new DateTime(2026, 7, 30, 12, 0, 0, DateTimeKind.Utc);

        Assert.True(await harness.Store.TryConsumeProvisionAsync(
            Owner,
            now,
            maximum: 5,
            TimeSpan.FromHours(1),
            TimeSpan.FromSeconds(30),
            CancellationToken.None));
        Assert.False(await harness.Store.TryConsumeProvisionAsync(
            Owner,
            now.AddSeconds(1),
            maximum: 5,
            TimeSpan.FromHours(1),
            TimeSpan.FromSeconds(30),
            CancellationToken.None));
    }

    [Fact]
    public async Task ANewWindowRestoresTheProvisioningBudget()
    {
        await using var harness = await Harness.CreateAsync();
        var now = new DateTime(2026, 7, 30, 12, 0, 0, DateTimeKind.Utc);

        Assert.True(await harness.Store.TryConsumeProvisionAsync(
            Owner,
            now,
            maximum: 1,
            TimeSpan.FromHours(1),
            TimeSpan.FromSeconds(30),
            CancellationToken.None));
        Assert.True(await harness.Store.TryConsumeProvisionAsync(
            Owner,
            now.AddHours(1).AddSeconds(1),
            maximum: 1,
            TimeSpan.FromHours(1),
            TimeSpan.FromSeconds(30),
            CancellationToken.None));
    }

    private sealed class Harness : IAsyncDisposable
    {
        private readonly SqliteConnection _connection;
        private readonly HomeOpsDbContext _db;

        private Harness(
            SqliteConnection connection,
            HomeOpsDbContext db,
            RankedStore store)
        {
            _connection = connection;
            _db = db;
            Store = store;
        }

        public RankedStore Store { get; }

        public static async Task<Harness> CreateAsync()
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var db = new HomeOpsDbContext(
                new DbContextOptionsBuilder<HomeOpsDbContext>()
                    .UseSqlite(connection)
                    .Options);
            await db.EnsureSchemaAsync();
            return new Harness(
                connection,
                db,
                new RankedStore(db, NullLogger<RankedStore>.Instance));
        }

        public async ValueTask DisposeAsync()
        {
            await _db.DisposeAsync();
            await _connection.DisposeAsync();
        }
    }
}
