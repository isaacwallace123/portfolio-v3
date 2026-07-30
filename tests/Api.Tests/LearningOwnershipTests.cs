using IsaacWallace.Api.Data;
using IsaacWallace.Api.Learning;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace IsaacWallace.Api.Tests;

// Who owns a progress row, and who is allowed to write one.
//
// The Academy's persistence has two rules that everything else rests on. First: a capstone and the
// final assessment are written by the run broker after it has judged a real cluster, and a client
// reporting one is refused rather than disbelieved. Second: every row belongs to one account key,
// and nothing about one learner is reachable through another's request.
//
// Both are enforced in the API and neither is visible from the browser, which is exactly why they
// are asserted here rather than in the front end.
public sealed class LearningOwnershipTests
{
    private static readonly CourseManifest Course = CourseManifests.ProductionOperations;

    // ── What a client may report ────────────────────────────────────────────

    [Theory]
    [InlineData("lesson:the-request-path")]
    [InlineData("checkpoint:read-the-system")]
    public void LessonsAndCheckpointsAreTheLearnersOwnWordToGive(string unitId)
    {
        Assert.True(LearningEndpoints.IsClientReportable(unitId));
    }

    [Theory]
    [InlineData("drill:read-the-system:checkout-traffic-spike")]
    [InlineData("drill:capacity-and-scaling:front-and-back")]
    [InlineData("assessment:double-fault")]
    public void ClusterUnitsAreNever(string unitId)
    {
        Assert.False(LearningEndpoints.IsClientReportable(unitId));
    }

    [Fact]
    public void EveryCapstoneAndTheAssessmentInTheRealManifestAreServerOnly()
    {
        // Asserted over the manifest rather than over a handful of examples, so a segment added
        // later cannot quietly arrive with a client-writable capstone.
        foreach (var unitId in Course.CapstoneUnitIds)
            Assert.False(LearningEndpoints.IsClientReportable(unitId), unitId);

        Assert.False(LearningEndpoints.IsClientReportable(Course.AssessmentUnitId));

        foreach (var unitId in Course.OptionalDrillUnitIds)
            Assert.False(LearningEndpoints.IsClientReportable(unitId), unitId);

        foreach (var unitId in Course.RequiredLessonUnitIds)
            Assert.True(LearningEndpoints.IsClientReportable(unitId), unitId);

        foreach (var unitId in Course.CheckpointUnitIds)
            Assert.True(LearningEndpoints.IsClientReportable(unitId), unitId);
    }

    [Fact]
    public void TheRefusalSaysWhoDoesCompleteACapstone()
    {
        Assert.Contains("run broker", LearningEndpoints.ClusterUnitRefusal);
        Assert.Contains("measured", LearningEndpoints.ClusterUnitRefusal);
    }

    // ── Account ownership ───────────────────────────────────────────────────

    [Fact]
    public async Task ProgressBelongsToOneAccountAndIsInvisibleToAnother()
    {
        await using var fixture = await Fixture.CreateAsync();
        const string lesson = "lesson:the-request-path";

        await fixture.Store.CompleteUnitAsync(
            "owner-a", Course, lesson, Lesson(), CancellationToken.None);

        var mine = await fixture.Store.GetAsync("owner-a", Course, CancellationToken.None);
        var theirs = await fixture.Store.GetAsync("owner-b", Course, CancellationToken.None);

        Assert.Single(mine.Units);
        Assert.Empty(theirs.Units);
        Assert.NotNull(mine.StartedUtc);
        Assert.Null(theirs.StartedUtc);
    }

    [Fact]
    public async Task AnAnonymousRequestSeesNothingAtAll()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.Store.CompleteUnitAsync(
            "owner-a", Course, "lesson:the-request-path", Lesson(), CancellationToken.None);

        // Not an error, and not somebody else's course: an empty record. A signed-out visitor gets
        // a working Academy that has recorded nothing, which is the honest answer.
        var anonymous = await fixture.Store.GetAsync("", Course, CancellationToken.None);

        Assert.Empty(anonymous.Units);
        Assert.Null(anonymous.Certificate);
        Assert.Equal(Course.CourseId, anonymous.CourseId);
    }

    [Fact]
    public async Task ACertificateIsVisibleOnlyToTheAccountThatEarnedIt()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.CompleteEverythingAsync("owner-a");

        var issued = await fixture.Store.IssueCertificateAsync(
            "owner-a", Course, "Learner A", ["Observability"], CancellationToken.None);
        Assert.NotNull(issued.Certificate);

        var theirs = await fixture.Store.GetAsync("owner-b", Course, CancellationToken.None);
        Assert.Null(theirs.Certificate);

        // Public verification by opaque id is deliberate — a certificate only its holder can see
        // verifies nothing — and it reveals the name on the certificate and nothing behind it.
        var verified = await fixture.Store.VerifyAsync(
            issued.Certificate!.CertificateId, CancellationToken.None);
        Assert.Equal("Learner A", verified!.LearnerName);
    }

    [Fact]
    public async Task OneAccountCannotFinishAnothersCourse()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.CompleteEverythingAsync("owner-a");

        var refused = await fixture.Store.IssueCertificateAsync(
            "owner-b", Course, "Learner B", [], CancellationToken.None);

        Assert.Null(refused.Certificate);
        Assert.NotEmpty(refused.Refusal!.Outstanding);
    }

    [Fact]
    public async Task ProgressAgainstAnotherCourseVersionDoesNotCount()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.CompleteEverythingAsync("owner-a");

        // Completing version 1 stays a historical fact; it simply stops answering for version 2.
        var next = Course with { CourseVersion = Course.CourseVersion + 1 };
        var progress = await fixture.Store.GetAsync("owner-a", next, CancellationToken.None);

        Assert.Empty(progress.Units);
        Assert.Null(progress.Certificate);
    }

    // ── Start, resume, and the cluster's own write ──────────────────────────

    [Fact]
    public async Task StartingAUnitIsRecordedServerSideAndIsIdempotent()
    {
        await using var fixture = await Fixture.CreateAsync();
        var unitId = Course.AssessmentUnitId;

        await fixture.Store.StartUnitAsync(
            "owner-a", Course, unitId, "assessment", CancellationToken.None);
        await fixture.Store.StartUnitAsync(
            "owner-a", Course, unitId, "assessment", CancellationToken.None);

        var progress = await fixture.Store.GetAsync("owner-a", Course, CancellationToken.None);
        var unit = Assert.Single(progress.Units);
        Assert.Equal("in-progress", unit.Status);
        Assert.Equal(0, unit.Attempts);
        Assert.Null(unit.CompletedUtc);
        Assert.Equal(1, await fixture.Db.UnitProgress.CountAsync());
    }

    [Fact]
    public async Task StartingAUnitNeverUndoesOneAlreadyCompleted()
    {
        await using var fixture = await Fixture.CreateAsync();
        var unitId = Course.AssessmentUnitId;

        await fixture.Store.CompleteClusterUnitAsync(
            "owner-a", Course, unitId, ClusterSolve("run-hl-assess01"), CancellationToken.None);
        // Re-opening the assessment page after finishing it must not demote the record.
        await fixture.Store.StartUnitAsync(
            "owner-a", Course, unitId, "assessment", CancellationToken.None);

        var progress = await fixture.Store.GetAsync("owner-a", Course, CancellationToken.None);
        Assert.Equal("completed", Assert.Single(progress.Units).Status);
    }

    [Fact]
    public async Task AStartedAssessmentIsCompletedByTheClusterWriteNotTheClient()
    {
        await using var fixture = await Fixture.CreateAsync();
        var unitId = Course.AssessmentUnitId;

        await fixture.Store.StartUnitAsync(
            "owner-a", Course, unitId, "assessment", CancellationToken.None);
        var opened = await fixture.Store.GetAsync("owner-a", Course, CancellationToken.None);
        Assert.Equal("in-progress", Assert.Single(opened.Units).Status);

        await fixture.Store.CompleteClusterUnitAsync(
            "owner-a", Course, unitId, ClusterSolve("run-hl-assess02"), CancellationToken.None);

        var solved = await fixture.Store.GetAsync("owner-a", Course, CancellationToken.None);
        var unit = Assert.Single(solved.Units);
        Assert.Equal("completed", unit.Status);
        Assert.Equal(1, unit.Attempts);
        Assert.Equal(180_000, unit.BestElapsedMs);
        Assert.True(unit.Clean);
    }

    [Fact]
    public async Task ASecondAttemptOnANewClusterIsRecordedSeparately()
    {
        await using var fixture = await Fixture.CreateAsync();
        var unitId = Course.AssessmentUnitId;

        await fixture.Store.CompleteClusterUnitAsync(
            "owner-a", Course, unitId,
            ClusterSolve("run-hl-assess01", elapsedMs: 180_000, clean: true),
            CancellationToken.None);
        await fixture.Store.CompleteClusterUnitAsync(
            "owner-a", Course, unitId,
            ClusterSolve("run-hl-assess02", elapsedMs: 240_000, clean: false),
            CancellationToken.None);

        var progress = await fixture.Store.GetAsync("owner-a", Course, CancellationToken.None);
        var unit = Assert.Single(progress.Units);
        Assert.Equal(2, unit.Attempts);
        // Best time, and a clean solve that happened is not un-earned by a messier retry.
        Assert.Equal(180_000, unit.BestElapsedMs);
        Assert.True(unit.Clean);
    }

    [Fact]
    public async Task ClusterCompletionRefusesToRecordWithoutARun()
    {
        await using var fixture = await Fixture.CreateAsync();

        // The run id is the idempotency key. Without one, a polling client would record the same
        // solve on every snapshot.
        await Assert.ThrowsAsync<ArgumentException>(() =>
            fixture.Store.CompleteClusterUnitAsync(
                "owner-a",
                Course,
                Course.AssessmentUnitId,
                ClusterSolve(""),
                CancellationToken.None));
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private static UnitCompletion Lesson() =>
        new("lesson", null, null, false, false, "", "guided", 0);

    private static UnitCompletion ClusterSolve(
        string runId, long elapsedMs = 180_000, bool clean = true) =>
        new("assessment", null, elapsedMs, clean, false, runId, "assessment", clean ? 0 : 2);

    private sealed class Fixture(
        SqliteConnection connection,
        LearningDbContext db,
        LearningProgressStore store) : IAsyncDisposable
    {
        public LearningDbContext Db { get; } = db;
        public LearningProgressStore Store { get; } = store;

        /// <summary>Everything the certificate requires, for one owner.</summary>
        public async Task CompleteEverythingAsync(string owner)
        {
            var run = 0;
            foreach (var segment in Course.Segments)
            {
                foreach (var lesson in segment.LessonUnitIds)
                    await Store.CompleteUnitAsync(
                        owner, Course, lesson, Lesson(), CancellationToken.None);

                await Store.CompleteUnitAsync(
                    owner, Course, segment.CheckpointUnitId,
                    new UnitCompletion("checkpoint", 100, null, false, false, "", "guided", 0),
                    CancellationToken.None);

                await Store.CompleteClusterUnitAsync(
                    owner, Course, segment.CapstoneUnitId,
                    new UnitCompletion(
                        "drill", null, 60_000, true, false,
                        $"run-hl-own{run++:d6}", "guided", 0),
                    CancellationToken.None);
            }

            await Store.CompleteClusterUnitAsync(
                owner, Course, Course.AssessmentUnitId,
                ClusterSolve($"run-hl-own{run:d6}"),
                CancellationToken.None);
        }

        public static async Task<Fixture> CreateAsync()
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<LearningDbContext>()
                .UseSqlite(connection)
                .Options;
            var db = new LearningDbContext(options);
            await db.EnsureSchemaAsync();
            return new Fixture(
                connection,
                db,
                new LearningProgressStore(db, NullLogger<LearningProgressStore>.Instance));
        }

        public async ValueTask DisposeAsync()
        {
            await Db.DisposeAsync();
            await connection.DisposeAsync();
        }
    }
}
