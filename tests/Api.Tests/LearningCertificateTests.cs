using IsaacWallace.Api.Data;
using IsaacWallace.Api.Learning;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace IsaacWallace.Api.Tests;

// The certificate's eligibility rules, which are the whole reason the API is the authority here.
//
// The browser reports that a unit finished; it never reports that the course is complete. These
// tests are about the difference — every requirement is re-derived from rows this service wrote,
// so a client that lies about its own progress gets a 409 listing what is actually outstanding.
public sealed class LearningCertificateTests
{
    private const string Owner = "owner-certificate";
    private static readonly CourseManifest Course = CourseManifests.ProductionOperations;

    [Fact]
    public async Task RefusesWithoutAnAccount()
    {
        await using var fixture = await LearningCertificateFixture.CreateAsync();

        var result = await fixture.Store.IssueCertificateAsync(
            "", Course, "nobody", [], CancellationToken.None);

        Assert.Null(result.Certificate);
        Assert.Contains("account", result.Refusal!.Reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task RefusesAnEmptyCourseAndSaysWhatIsOutstanding()
    {
        await using var fixture = await LearningCertificateFixture.CreateAsync();

        var result = await fixture.Store.IssueCertificateAsync(
            Owner, Course, "Isaac", [], CancellationToken.None);

        Assert.Null(result.Certificate);
        var outstanding = result.Refusal!.Outstanding;
        Assert.Contains(outstanding, o => o.Contains("lesson"));
        Assert.Contains(outstanding, o => o.Contains("checkpoint"));
        Assert.Contains(outstanding, o => o.Contains("capstone"));
        Assert.Contains(outstanding, o => o.Contains("final assessment"));
    }

    [Fact]
    public async Task RefusesWhenTheFinalAssessmentIsOutstanding()
    {
        await using var fixture = await LearningCertificateFixture.CreateAsync();
        await fixture.CompleteCourseAsync(includeAssessment: false);

        var result = await fixture.Store.IssueCertificateAsync(
            Owner, Course, "Isaac", [], CancellationToken.None);

        Assert.Null(result.Certificate);
        Assert.Contains(result.Refusal!.Outstanding, o => o.Contains("final assessment"));
    }

    [Fact]
    public async Task RefusesBelowTheRequiredKnowledgeCheckAverage()
    {
        await using var fixture = await LearningCertificateFixture.CreateAsync();
        await fixture.CompleteCourseAsync(checkpointScore: Course.MinimumCheckScore - 10);

        var result = await fixture.Store.IssueCertificateAsync(
            Owner, Course, "Isaac", [], CancellationToken.None);

        Assert.Null(result.Certificate);
        Assert.Contains(result.Refusal!.Outstanding, o => o.Contains("knowledge-check average"));
    }

    [Fact]
    public async Task RefusesBelowTheRequiredNumberOfCleanCapstones()
    {
        await using var fixture = await LearningCertificateFixture.CreateAsync();
        await fixture.CompleteCourseAsync(cleanCapstones: Course.CleanCapstonesRequired - 1);

        var result = await fixture.Store.IssueCertificateAsync(
            Owner, Course, "Isaac", [], CancellationToken.None);

        Assert.Null(result.Certificate);
        Assert.Contains(
            result.Refusal!.Outstanding,
            o => o.Contains("capstones solved with no wrong action"));
    }

    [Fact]
    public async Task IssuesWhenEveryRequirementIsMet()
    {
        await using var fixture = await LearningCertificateFixture.CreateAsync();
        await fixture.CompleteCourseAsync();

        var result = await fixture.Store.IssueCertificateAsync(
            Owner, Course, "Isaac Wallace", ["Observability", "Capacity"], CancellationToken.None);

        Assert.Null(result.Refusal);
        var certificate = result.Certificate!;
        Assert.StartsWith("hoc-", certificate.CertificateId);
        Assert.Equal("Isaac Wallace", certificate.LearnerName);
        Assert.Equal(Course.CourseVersion, certificate.CourseVersion);
        Assert.Equal(["Observability", "Capacity"], certificate.Skills);
    }

    [Fact]
    public async Task IssuesExactlyOnceAndKeepsTheSameIdentifier()
    {
        // A shared verification link has to keep resolving, so a second request must return the
        // first certificate rather than minting a new id.
        await using var fixture = await LearningCertificateFixture.CreateAsync();
        await fixture.CompleteCourseAsync();

        var first = await fixture.Store.IssueCertificateAsync(
            Owner, Course, "Isaac", [], CancellationToken.None);
        var second = await fixture.Store.IssueCertificateAsync(
            Owner, Course, "Someone Else", [], CancellationToken.None);

        Assert.Equal(first.Certificate!.CertificateId, second.Certificate!.CertificateId);
        Assert.Equal("Isaac", second.Certificate.LearnerName);
        Assert.Equal(1, await fixture.Db.Certificates.CountAsync());
    }

    [Fact]
    public async Task VerifiesByOpaqueIdentifierAndRevealsNothingAboutTheOwner()
    {
        await using var fixture = await LearningCertificateFixture.CreateAsync();
        await fixture.CompleteCourseAsync();
        var issued = await fixture.Store.IssueCertificateAsync(
            Owner, Course, "Isaac", ["Capacity"], CancellationToken.None);

        var verified = await fixture.Store.VerifyAsync(
            issued.Certificate!.CertificateId, CancellationToken.None);

        Assert.NotNull(verified);
        Assert.Equal(Course.Title, verified!.CourseTitle);
        // The view carries what the certificate says. There is no owner key on it to leak.
        Assert.DoesNotContain(Owner, verified.LearnerName);
    }

    [Fact]
    public async Task DoesNotVerifyAnUnknownIdentifier()
    {
        await using var fixture = await LearningCertificateFixture.CreateAsync();
        Assert.Null(await fixture.Store.VerifyAsync(
            "hoc-00000000000000000000000000000000", CancellationToken.None));
    }

    [Fact]
    public async Task KeepsACleanSolveThroughAMessierRetry()
    {
        // Five clean capstones is a claim about what the learner did. Replaying a capstone to try a
        // different approach, and making a mess of it, must not un-earn the clean solve they had.
        await using var fixture = await LearningCertificateFixture.CreateAsync();
        var unitId = Course.Segments[0].CapstoneUnitId;

        await fixture.Store.CompleteUnitAsync(
            Owner, Course, unitId,
            new UnitCompletion("drill", null, 40_000, true, false, "run-hl-clean01", "guided", 0),
            CancellationToken.None);
        await fixture.Store.CompleteUnitAsync(
            Owner, Course, unitId,
            new UnitCompletion("drill", null, 90_000, false, false, "run-hl-messy01", "guided", 3),
            CancellationToken.None);

        var progress = await fixture.Store.GetAsync(Owner, Course, CancellationToken.None);
        var unit = Assert.Single(progress.Units, u => u.UnitId == unitId);
        Assert.True(unit.Clean);
        // And the best time is kept rather than the latest.
        Assert.Equal(40_000, unit.BestElapsedMs);
        Assert.Equal(2, unit.Attempts);
    }

    [Fact]
    public async Task KeepsTheBestCheckpointScore()
    {
        await using var fixture = await LearningCertificateFixture.CreateAsync();
        var unitId = Course.Segments[0].CheckpointUnitId;

        await fixture.Store.CompleteUnitAsync(
            Owner, Course, unitId,
            new UnitCompletion("checkpoint", 90, null, false, false, "", "guided", 0),
            CancellationToken.None);
        await fixture.Store.CompleteUnitAsync(
            Owner, Course, unitId,
            new UnitCompletion("checkpoint", 60, null, false, false, "", "guided", 0),
            CancellationToken.None);

        var progress = await fixture.Store.GetAsync(Owner, Course, CancellationToken.None);
        Assert.Equal(90, Assert.Single(progress.Units, u => u.UnitId == unitId).Score);
    }

    [Fact]
    public async Task MarksTheCourseCompleteOnlyWhenEveryRequiredUnitIsDone()
    {
        await using var fixture = await LearningCertificateFixture.CreateAsync();

        await fixture.CompleteCourseAsync(includeAssessment: false);
        var partial = await fixture.Store.GetAsync(Owner, Course, CancellationToken.None);
        Assert.Null(partial.CompletedUtc);

        await fixture.Store.CompleteUnitAsync(
            Owner, Course, Course.AssessmentUnitId,
            new UnitCompletion("assessment", null, 200_000, true, false, "run-hl-final01", "assessment", 0),
            CancellationToken.None);

        var complete = await fixture.Store.GetAsync(Owner, Course, CancellationToken.None);
        Assert.NotNull(complete.CompletedUtc);
    }

    private sealed class LearningCertificateFixture(
        SqliteConnection connection,
        LearningDbContext db,
        LearningProgressStore store) : IAsyncDisposable
    {
        public LearningDbContext Db { get; } = db;
        public LearningProgressStore Store { get; } = store;

        /// <summary>Every lesson, checkpoint, capstone and (optionally) the assessment.</summary>
        public async Task CompleteCourseAsync(
            bool includeAssessment = true,
            int checkpointScore = 100,
            int? cleanCapstones = null)
        {
            var clean = cleanCapstones ?? Course.Segments.Count;
            var run = 0;

            for (var i = 0; i < Course.Segments.Count; i++)
            {
                var segment = Course.Segments[i];

                foreach (var lesson in segment.LessonUnitIds)
                    await Store.CompleteUnitAsync(
                        Owner, Course, lesson,
                        new UnitCompletion("lesson", null, null, false, false, "", "guided", 0),
                        CancellationToken.None);

                await Store.CompleteUnitAsync(
                    Owner, Course, segment.CheckpointUnitId,
                    new UnitCompletion("checkpoint", checkpointScore, null, false, false, "", "guided", 0),
                    CancellationToken.None);

                await Store.CompleteUnitAsync(
                    Owner, Course, segment.CapstoneUnitId,
                    new UnitCompletion(
                        "drill", null, 60_000, i < clean, false,
                        $"run-hl-seg{run++:d6}", "guided", i < clean ? 0 : 2),
                    CancellationToken.None);
            }

            if (includeAssessment)
                await Store.CompleteUnitAsync(
                    Owner, Course, Course.AssessmentUnitId,
                    new UnitCompletion("assessment", null, 200_000, true, false, "run-hl-final01", "assessment", 0),
                    CancellationToken.None);
        }

        public static async Task<LearningCertificateFixture> CreateAsync()
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<LearningDbContext>()
                .UseSqlite(connection)
                .Options;
            var db = new LearningDbContext(options);
            await db.EnsureSchemaAsync();
            return new LearningCertificateFixture(
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
