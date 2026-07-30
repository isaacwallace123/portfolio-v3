using IsaacWallace.Api.Data;
using IsaacWallace.Api.Ranked;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using System.Text.Json;
using Xunit;

namespace IsaacWallace.Api.Tests;

public sealed class RankedStoreTests
{
    [Fact]
    public async Task EvidenceIsAppendOnlyOwnerScopedAndIncludedInTheAttempt()
    {
        await using var fixture = await RankedFixture.CreateAsync();
        var attempt = await fixture.Store.BeginAsync(
            "run-hl-evidence1",
            "cascade-scale-release",
            "owner-evidence",
            "Ada",
            DateTime.UtcNow,
            CancellationToken.None);
        var observed = new DateTime(2026, 7, 30, 2, 0, 0, DateTimeKind.Utc);

        var rejected = await fixture.Store.RecordEvidenceAsync(
            "evidence-wrong-owner",
            attempt.Id,
            attempt.RunId,
            "owner-other",
            "inspect pods",
            "pods",
            "checkout/checkout-1 ready",
            1,
            observed,
            CancellationToken.None);
        var saved = await fixture.Store.RecordEvidenceAsync(
            "evidence-1",
            attempt.Id,
            attempt.RunId,
            "owner-evidence",
            "inspect pods checkout",
            "pods",
            "checkout/checkout-1 ready",
            1,
            observed,
            CancellationToken.None);
        var duplicate = await fixture.Store.RecordEvidenceAsync(
            "evidence-1",
            attempt.Id,
            attempt.RunId,
            "owner-evidence",
            "inspect metrics",
            "metrics",
            "this duplicate must not overwrite the original",
            2,
            observed.AddMinutes(1),
            CancellationToken.None);

        Assert.Null(rejected);
        Assert.NotNull(saved);
        Assert.Equal(saved, duplicate);

        var profile = await fixture.Store.ProfileAsync(
            "owner-evidence", CancellationToken.None);
        var evidence = Assert.Single(profile.RecentAttempts.Single().Evidence);
        Assert.Equal("inspect pods checkout", evidence.Query);
        Assert.Equal("pods", evidence.Kind);
        Assert.Equal("checkout/checkout-1 ready", evidence.Summary);
        Assert.Equal(1, await fixture.Db.RankedEvidence.CountAsync());
    }

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

        await RecordControlledRecoveryAsync(fixture.Store, attempt, "owner-a", started);
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
        Assert.NotNull(result.Performance);
        Assert.Equal(100, result.Performance.QualityScore);
        Assert.Equal(1, result.Performance.RatingScore);
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
        Assert.Equal(1, await fixture.Db.RankedPerformance.CountAsync(
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
            await RecordControlledRecoveryAsync(
                fixture.Store,
                attempt,
                owner,
                attempt.StartedUtc);
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

    [Fact]
    public async Task OperatorActionsAreAppendOnlyIdempotentAndOwnerScoped()
    {
        await using var fixture = await RankedFixture.CreateAsync();
        var attempt = await fixture.Store.BeginAsync(
            "run-hl-log1234567",
            "cascade-scale-release",
            "owner-log",
            "Sally",
            DateTime.UtcNow,
            CancellationToken.None);
        var accepted = new DateTime(2026, 7, 30, 5, 0, 0, DateTimeKind.Utc);

        var first = await fixture.Store.RecordActionAsync(
            "action-entry-1",
            attempt.Id,
            attempt.RunId,
            "owner-log",
            "scale checkout 4",
            "scale-4",
            1,
            accepted,
            CancellationToken.None);
        var retry = await fixture.Store.RecordActionAsync(
            "action-entry-1",
            attempt.Id,
            attempt.RunId,
            "owner-log",
            "scale checkout 4",
            "scale-4",
            1,
            accepted,
            CancellationToken.None);
        var wrongOwner = await fixture.Store.RecordActionAsync(
            "action-entry-2",
            attempt.Id,
            attempt.RunId,
            "owner-other",
            "rollback checkout",
            "release-stable",
            1,
            accepted.AddSeconds(1),
            CancellationToken.None);

        var actions = await fixture.Store.ActionsForAttemptAsync(
            attempt.Id,
            "owner-log",
            CancellationToken.None);

        Assert.True(first);
        Assert.True(retry);
        Assert.False(wrongOwner);
        var action = Assert.Single(actions);
        Assert.Equal("scale checkout 4", action.Command);
        Assert.Equal("scale-4", action.ActionId);
        Assert.Equal(accepted, action.AcceptedUtc);
        Assert.Equal(1, await fixture.Db.RankedActions.CountAsync(
            CancellationToken.None));
    }

    [Fact]
    public async Task IdempotencyKeysCannotCrossOwnerOrAttemptBoundaries()
    {
        await using var fixture = await RankedFixture.CreateAsync();
        var first = await fixture.Store.BeginAsync(
            "run-hl-collision1",
            "cascade-scale-release",
            "owner-first",
            "First",
            DateTime.UtcNow,
            CancellationToken.None);
        var second = await fixture.Store.BeginAsync(
            "run-hl-collision2",
            "cascade-scale-release",
            "owner-second",
            "Second",
            DateTime.UtcNow,
            CancellationToken.None);

        Assert.True(await fixture.Store.RecordActionAsync(
            "shared-action-id", first.Id, first.RunId, "owner-first",
            "scale checkout 4", "scale-4", 1, DateTime.UtcNow,
            CancellationToken.None));
        Assert.False(await fixture.Store.RecordActionAsync(
            "shared-action-id", second.Id, second.RunId, "owner-second",
            "rollback checkout", "release-stable", 1, DateTime.UtcNow,
            CancellationToken.None));

        var evidence = await fixture.Store.RecordEvidenceAsync(
            "shared-evidence-id", first.Id, first.RunId, "owner-first",
            "inspect pods", "pods", "first-owner-only", 1, DateTime.UtcNow,
            CancellationToken.None);
        var collision = await fixture.Store.RecordEvidenceAsync(
            "shared-evidence-id", second.Id, second.RunId, "owner-second",
            "inspect logs", "logs", "must-not-leak", 1, DateTime.UtcNow,
            CancellationToken.None);

        Assert.NotNull(evidence);
        Assert.Null(collision);
        Assert.Empty(await fixture.Store.ActionsForAttemptAsync(
            second.Id, "owner-second", CancellationToken.None));
        Assert.DoesNotContain(
            "first-owner-only",
            JsonSerializer.Serialize(await fixture.Store.ProfileAsync(
                "owner-second", CancellationToken.None)));
    }

    [Fact]
    public async Task AuditLedgersStopAtTheirAuthoritativePerAttemptCaps()
    {
        await using var fixture = await RankedFixture.CreateAsync();
        var attempt = await fixture.Store.BeginAsync(
            "run-hl-ledgercap1",
            "cascade-scale-release",
            "owner-cap",
            "Cap",
            DateTime.UtcNow,
            CancellationToken.None);

        for (var index = 0; index < RankedRules.MaxActionsPerAttempt; index++)
            Assert.True(await fixture.Store.RecordActionAsync(
                $"action-{index}", attempt.Id, attempt.RunId, "owner-cap",
                "scale checkout 4", "scale-4", 1, DateTime.UtcNow,
                CancellationToken.None));
        Assert.False(await fixture.Store.RecordActionAsync(
            "action-over-cap", attempt.Id, attempt.RunId, "owner-cap",
            "scale checkout 4", "scale-4", 1, DateTime.UtcNow,
            CancellationToken.None));

        for (var index = 0; index < RankedRules.MaxEvidencePerAttempt; index++)
            Assert.NotNull(await fixture.Store.RecordEvidenceAsync(
                $"evidence-{index}", attempt.Id, attempt.RunId, "owner-cap",
                "inspect pods", "pods", "bounded", 1, DateTime.UtcNow,
                CancellationToken.None));
        Assert.Null(await fixture.Store.RecordEvidenceAsync(
            "evidence-over-cap", attempt.Id, attempt.RunId, "owner-cap",
            "inspect pods", "pods", "bounded", 1, DateTime.UtcNow,
            CancellationToken.None));
    }

    [Fact]
    public async Task TelemetryBucketsAreIdempotentAndRequiredForACompletedRating()
    {
        await using var fixture = await RankedFixture.CreateAsync();
        var started = new DateTime(2026, 7, 30, 6, 0, 0, DateTimeKind.Utc);
        var attempt = await fixture.Store.BeginAsync(
            "run-hl-measured12",
            "cascade-scale-release",
            "owner-measured",
            "Katherine",
            started,
            CancellationToken.None);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            fixture.Store.FinalizeAsync(
                attempt.Id,
                "owner-measured",
                RankedOutcomes.Completed,
                20_000,
                3,
                "",
                "Katherine",
                CancellationToken.None));
        fixture.Db.ChangeTracker.Clear();

        var observation = new RankedTelemetryObservation(
            attempt.Id,
            attempt.RunId,
            "owner-measured",
            started.AddSeconds(6),
            1,
            1000,
            700,
            350,
            1.2,
            2,
            3,
            2,
            3,
            0);
        Assert.True(await fixture.Store.RecordTelemetryAsync(
            observation, CancellationToken.None));
        Assert.True(await fixture.Store.RecordTelemetryAsync(
            observation with { RecordedUtc = started.AddSeconds(9) },
            CancellationToken.None));

        Assert.Equal(1, await fixture.Db.RankedTelemetry.CountAsync(
            CancellationToken.None));
    }

    [Fact]
    public async Task GeneratedPlanIsPersistedOwnerScopedAndRevealedOnlyAfterTheMatch()
    {
        await using var fixture = await RankedFixture.CreateAsync();
        var plan = RankedScenarioGenerator.Generate(
            new RankedScenarioSeed(
                314.ToString("x32"),
                RankedScenarioSeed.CurrentVersion,
                RankedRules.InitialRating));
        var attempt = await fixture.Store.BeginAsync(
            "run-hl-generated1",
            plan.DrillId,
            "owner-generated",
            "Dorothy",
            DateTime.UtcNow,
            CancellationToken.None);

        Assert.NotNull(attempt.Briefing);
        Assert.Null(attempt.Debrief);
        Assert.Equal(RankedScenarioSeed.PublicDrillId, attempt.DrillId);
        Assert.Equal(plan.Seed.Commitment, attempt.Briefing.SeedCommitment);
        Assert.DoesNotContain(plan.Seed.SeedId, JsonSerializer.Serialize(attempt));
        var receipt = Assert.Single(await fixture.Db.RankedScenarios.ToListAsync());
        Assert.Equal(plan.DrillId, receipt.DrillId);
        Assert.Contains(plan.Seed.SeedId, receipt.PlanJson);

        var context = await fixture.Store.DrawContextAsync(
            "owner-generated", CancellationToken.None);
        var other = await fixture.Store.DrawContextAsync(
            "owner-other", CancellationToken.None);
        Assert.Contains(plan.Seed.SeedId, context.PlayedSeedIds);
        Assert.Equal(plan.FamilyList.OrderBy(family => family), context.RecentFamilies.OrderBy(family => family));
        Assert.Empty(other.PlayedSeedIds);
        Assert.Empty(other.RecentFamilies);

        await fixture.Store.FinalizeAsync(
            attempt.Id,
            "owner-generated",
            RankedOutcomes.Void,
            0,
            0,
            "",
            "Dorothy",
            CancellationToken.None);
        var settled = (await fixture.Store.ProfileAsync(
            "owner-generated", CancellationToken.None)).RecentAttempts.Single();
        Assert.NotNull(settled.Debrief);
        Assert.Equal(plan.DrillId, settled.DrillId);
        Assert.Equal(plan.Seed.SeedId, settled.Debrief.SeedId);
        Assert.Equal(
            plan.Faults.Select(fault => fault.ModuleId).OrderBy(id => id),
            settled.Debrief.Faults.Select(fault => fault.ModuleId).OrderBy(id => id));
    }

    [Fact]
    public async Task RatedGeneratedResultsRecalibrateFamiliesExactlyOnce()
    {
        await using var fixture = await RankedFixture.CreateAsync();
        var started = DateTime.UtcNow.AddMinutes(-1);
        var plan = RankedScenarioGenerator.Generate(
            new RankedScenarioSeed(
                1618.ToString("x32"),
                RankedScenarioSeed.CurrentVersion,
                RankedRules.InitialRating));
        var attempt = await fixture.Store.BeginAsync(
            "run-hl-calibrate1",
            plan.DrillId,
            "owner-calibrate",
            "Katherine",
            started,
            CancellationToken.None);
        await RecordControlledRecoveryAsync(
            fixture.Store, attempt, "owner-calibrate", started);

        await fixture.Store.FinalizeAsync(
            attempt.Id,
            "owner-calibrate",
            RankedOutcomes.Completed,
            30_000,
            plan.Phases.Count,
            "",
            "Katherine",
            CancellationToken.None);
        await fixture.Store.FinalizeAsync(
            attempt.Id,
            "owner-calibrate",
            RankedOutcomes.Completed,
            30_000,
            plan.Phases.Count,
            "",
            "Katherine",
            CancellationToken.None);

        var rows = await fixture.Db.RankedCalibrations
            .OrderBy(row => row.Family)
            .ToListAsync();
        Assert.Equal(plan.FamilyList.Count, rows.Count);
        Assert.All(rows, row =>
        {
            Assert.Equal(1, row.RatedAttempts);
            Assert.Equal(1, row.Completions);
        });
        var context = await fixture.Store.DrawContextAsync(
            "owner-calibrate", CancellationToken.None);
        Assert.All(
            plan.FamilyList,
            family => Assert.True(context.FamilyAdjustments[family] < 0));
    }

    [Fact]
    public async Task DifferentOwnersMayReceiveTheSameOpaqueSeed()
    {
        await using var fixture = await RankedFixture.CreateAsync();
        var seed = new RankedScenarioSeed(
            2718.ToString("x32"),
            RankedScenarioSeed.CurrentVersion,
            RankedRules.InitialRating);
        var plan = RankedScenarioGenerator.Generate(seed);

        await fixture.Store.BeginAsync(
            "run-hl-ownerone1",
            plan.DrillId,
            "owner-one",
            "One",
            DateTime.UtcNow,
            CancellationToken.None);
        await fixture.Store.BeginAsync(
            "run-hl-ownertwo2",
            plan.DrillId,
            "owner-two",
            "Two",
            DateTime.UtcNow,
            CancellationToken.None);

        Assert.Equal(2, await fixture.Db.RankedScenarios.CountAsync());
    }

    private static async Task RecordControlledRecoveryAsync(
        RankedStore store,
        RankedAttemptView attempt,
        string owner,
        DateTime at)
    {
        await store.RecordActionAsync(
            $"controlled-{owner}",
            attempt.Id,
            attempt.RunId,
            owner,
            "scale checkout 6",
            "scale-6",
            1,
            at.AddSeconds(1),
            CancellationToken.None);
        await store.RecordTelemetryAsync(
            new RankedTelemetryObservation(
                attempt.Id,
                attempt.RunId,
                owner,
                at.AddSeconds(20),
                1,
                1000,
                1000,
                100,
                0,
                3,
                3,
                3,
                3,
                15),
            CancellationToken.None);
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
