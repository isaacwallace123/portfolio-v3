using System.Security.Cryptography;
using IsaacWallace.Api.Learning;
using Microsoft.EntityFrameworkCore;

namespace IsaacWallace.Api.Data;

/// <summary>Everything a learner has done in one version of one course.</summary>
public sealed record LearningProgressView(
    string CourseId,
    int CourseVersion,
    DateTime? StartedUtc,
    DateTime? CompletedUtc,
    DateTime? LastActivityUtc,
    IReadOnlyList<LearningUnitView> Units,
    LearningCertificateView? Certificate);

public sealed record LearningUnitView(
    string UnitId,
    string UnitType,
    string Status,
    int? Score,
    int Attempts,
    long? BestElapsedMs,
    bool Clean,
    DateTime? CompletedUtc);

public sealed record LearningCertificateView(
    string CertificateId,
    string CourseId,
    int CourseVersion,
    string CourseTitle,
    string LearnerName,
    DateTime IssuedUtc,
    IReadOnlyList<string> Skills);

/// <summary>Why a certificate was refused, so the page can say which requirement is outstanding
/// rather than "not eligible".</summary>
public sealed record CertificateRefusal(string Reason, IReadOnlyList<string> Outstanding);

public sealed record CertificateResult(
    LearningCertificateView? Certificate,
    CertificateRefusal? Refusal);

/// <summary>What a client is allowed to say happened. Deliberately narrow: a caller reports that a
/// unit finished and how it went, and the store decides what that means for the course.</summary>
public sealed record UnitCompletion(
    string UnitType,
    int? Score,
    long? ElapsedMs,
    bool Clean,
    bool Mastered,
    string RunId,
    string Presentation,
    int Missteps);

// Reads and writes Academy progress. The only component that knows how lessons become a certificate.
//
// This is not a second cluster controller. It records that a unit finished; it never provisions,
// mutates, or judges a Kubernetes workload. Whether a capstone was actually solved is decided by
// the run broker from measured telemetry — this store is told the outcome, and the client cannot
// reach it without having gone through the broker first.
public sealed class LearningProgressStore(LearningDbContext db, ILogger<LearningProgressStore> log)
{
    public async Task<LearningProgressView> GetAsync(
        string owner, CourseManifest course, CancellationToken ct)
    {
        if (owner.Length == 0)
            return new LearningProgressView(
                course.CourseId, course.CourseVersion, null, null, null, [], null);

        var enrolment = await db.CourseProgress.AsNoTracking().FirstOrDefaultAsync(
            p => p.OwnerKey == owner
              && p.CourseId == course.CourseId
              && p.CourseVersion == course.CourseVersion, ct);

        var units = await db.UnitProgress.AsNoTracking()
            .Where(u => u.OwnerKey == owner
                     && u.CourseId == course.CourseId
                     && u.CourseVersion == course.CourseVersion)
            .ToListAsync(ct);

        var certificate = await db.Certificates.AsNoTracking().FirstOrDefaultAsync(
            c => c.OwnerKey == owner
              && c.CourseId == course.CourseId
              && c.CourseVersion == course.CourseVersion, ct);

        return new LearningProgressView(
            course.CourseId,
            course.CourseVersion,
            enrolment?.StartedUtc,
            enrolment?.CompletedUtc,
            enrolment?.LastActivityUtc,
            [.. units.Select(ToView)],
            certificate is null ? null : ToView(certificate, course.Title));
    }

    /// <summary>Mark a unit as started. Idempotent — opening a lesson twice is one enrolment and one
    /// in-progress row, not two.</summary>
    public async Task<LearningProgressView> StartUnitAsync(
        string owner, CourseManifest course, string unitId, string unitType, CancellationToken ct)
    {
        await EnsureEnrolledAsync(owner, course, ct);

        var unit = await FindUnitAsync(owner, course, unitId, ct);
        if (unit is null)
        {
            db.UnitProgress.Add(new LearningUnitProgress
            {
                OwnerKey = owner,
                CourseId = course.CourseId,
                CourseVersion = course.CourseVersion,
                UnitId = unitId,
                UnitType = unitType,
                Status = "in-progress",
                Attempts = 0,
            });
            await SaveTolerantlyAsync(ct);
        }

        await TouchAsync(owner, course, ct);
        return await GetAsync(owner, course, ct);
    }

    /// <summary>Record that a unit finished.
    ///
    /// Completion is monotonic: a unit that has been completed stays completed, its best time only
    /// improves, and `Clean` is sticky. A learner who replays a capstone to try a different approach
    /// and makes a mess of it has not un-earned the clean solve they already had — and the five
    /// clean capstones the certificate requires is a claim about what they did, not about the state
    /// of their most recent attempt.</summary>
    public async Task<LearningProgressView> CompleteUnitAsync(
        string owner,
        CourseManifest course,
        string unitId,
        UnitCompletion completion,
        CancellationToken ct)
    {
        await EnsureEnrolledAsync(owner, course, ct);
        var now = DateTime.UtcNow;

        var unit = await FindUnitAsync(owner, course, unitId, ct);
        if (unit is null)
        {
            unit = new LearningUnitProgress
            {
                OwnerKey = owner,
                CourseId = course.CourseId,
                CourseVersion = course.CourseVersion,
                UnitId = unitId,
                UnitType = completion.UnitType,
            };
            db.UnitProgress.Add(unit);
        }

        unit.Attempts += 1;
        unit.CompletedUtc ??= now;
        unit.Status = completion.Mastered || unit.Status == "mastered"
            ? "mastered"
            : "completed";

        // A checkpoint keeps its best score for the same reason a drill keeps its best time: the
        // course average should describe how well someone can reason about the material, and
        // re-reading a segment and scoring higher is exactly the behaviour worth recording.
        if (completion.Score is int score)
            unit.Score = unit.Score is int existing ? Math.Max(existing, score) : score;

        if (completion.ElapsedMs is long elapsed && elapsed > 0)
            unit.BestElapsedMs = unit.BestElapsedMs is long best
                ? Math.Min(best, elapsed)
                : elapsed;

        if (completion.Clean) unit.Clean = true;

        db.Attempts.Add(new LearningAttempt
        {
            OwnerKey = owner,
            CourseId = course.CourseId,
            UnitId = unitId,
            RunId = completion.RunId,
            Presentation = completion.Presentation,
            StartedUtc = now,
            CompletedUtc = now,
            Outcome = "completed",
            Missteps = completion.Missteps,
            ElapsedMs = completion.ElapsedMs ?? 0,
        });

        await SaveTolerantlyAsync(ct);
        await TouchAsync(owner, course, ct);
        await MarkCourseCompleteIfFinishedAsync(owner, course, ct);

        return await GetAsync(owner, course, ct);
    }

    /// <summary>
    /// Record a capstone that the run broker has already resolved from measured cluster telemetry.
    /// A solved LabRun is observed repeatedly by polling clients, so RunId is the idempotency key.
    /// </summary>
    public async Task<LearningProgressView> CompleteClusterUnitAsync(
        string owner,
        CourseManifest course,
        string unitId,
        UnitCompletion completion,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(completion.RunId))
            throw new ArgumentException("A cluster completion requires a run id.", nameof(completion));

        var alreadyRecorded = await db.Attempts.AsNoTracking().AnyAsync(
            a => a.OwnerKey == owner
              && a.CourseId == course.CourseId
              && a.UnitId == unitId
              && a.RunId == completion.RunId
              && a.Outcome == "completed",
            ct);
        if (alreadyRecorded) return await GetAsync(owner, course, ct);

        try
        {
            return await CompleteUnitAsync(owner, course, unitId, completion, ct);
        }
        catch (DbUpdateException)
        {
            // Another snapshot can win the unique RunId insert between the read and the write.
            db.ChangeTracker.Clear();
            return await GetAsync(owner, course, ct);
        }
    }

    /// <summary>Issue the certificate, or explain what is missing.
    ///
    /// Every requirement is checked here, against rows this service wrote. Nothing about eligibility
    /// is taken from the caller — the request carries no claims at all, only the intent to issue.</summary>
    public async Task<CertificateResult> IssueCertificateAsync(
        string owner,
        CourseManifest course,
        string learnerName,
        IReadOnlyList<string> skills,
        CancellationToken ct)
    {
        if (owner.Length == 0)
            return new CertificateResult(null, new CertificateRefusal(
                "A certificate is issued to an account.", []));

        var existing = await db.Certificates.AsNoTracking().FirstOrDefaultAsync(
            c => c.OwnerKey == owner
              && c.CourseId == course.CourseId
              && c.CourseVersion == course.CourseVersion, ct);
        // Issued exactly once. A second request returns the first certificate rather than minting a
        // new identifier, so a link that has been shared keeps resolving.
        if (existing is not null)
            return new CertificateResult(ToView(existing, course.Title), null);

        var units = await db.UnitProgress.AsNoTracking()
            .Where(u => u.OwnerKey == owner
                     && u.CourseId == course.CourseId
                     && u.CourseVersion == course.CourseVersion)
            .ToListAsync(ct);

        var done = units
            .Where(u => u.Status is "completed" or "mastered")
            .ToDictionary(u => u.UnitId, StringComparer.Ordinal);

        var outstanding = new List<string>();

        var lessonsMissing = course.RequiredLessonUnitIds.Count(id => !done.ContainsKey(id));
        if (lessonsMissing > 0) outstanding.Add($"{lessonsMissing} lesson(s) outstanding");

        var checkpointIds = course.CheckpointUnitIds.ToArray();
        var checkpointsMissing = checkpointIds.Count(id => !done.ContainsKey(id));
        if (checkpointsMissing > 0)
            outstanding.Add($"{checkpointsMissing} checkpoint(s) outstanding");

        var capstoneIds = course.CapstoneUnitIds.ToArray();
        var capstonesMissing = capstoneIds.Count(id => !done.ContainsKey(id));
        if (capstonesMissing > 0)
            outstanding.Add($"{capstonesMissing} capstone(s) outstanding");

        if (!done.ContainsKey(course.AssessmentUnitId))
            outstanding.Add("final assessment outstanding");

        // Averaged over checkpoints that were actually taken. When any are missing the requirement
        // above has already failed, so this cannot pass on a flattering partial average.
        var scores = checkpointIds
            .Select(id => done.GetValueOrDefault(id)?.Score)
            .Where(s => s is not null)
            .Select(s => s!.Value)
            .ToArray();
        var average = scores.Length == 0 ? 0 : (int)Math.Round(scores.Average());
        if (checkpointsMissing == 0 && average < course.MinimumCheckScore)
            outstanding.Add(
                $"knowledge-check average is {average}%, {course.MinimumCheckScore}% required");

        var clean = capstoneIds.Count(id => done.GetValueOrDefault(id)?.Clean == true);
        if (clean < course.CleanCapstonesRequired)
            outstanding.Add(
                $"{clean} of {course.CleanCapstonesRequired} capstones solved with no wrong action");

        if (outstanding.Count > 0)
            return new CertificateResult(null, new CertificateRefusal(
                "The course is not complete.", outstanding));

        var certificate = new LearningCertificate
        {
            Id = NewCertificateId(),
            OwnerKey = owner,
            CourseId = course.CourseId,
            CourseVersion = course.CourseVersion,
            LearnerName = learnerName.Length == 0 ? "operator" : learnerName,
            IssuedUtc = DateTime.UtcNow,
            Skills = string.Join(", ", skills),
        };
        db.Certificates.Add(certificate);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            // Two tabs finished the assessment together. The unique index decided which one wins;
            // both callers should receive the same certificate.
            db.Entry(certificate).State = EntityState.Detached;
            log.LogDebug(ex, "Certificate for {Course} was issued concurrently.", course.CourseId);
            var won = await db.Certificates.AsNoTracking().FirstOrDefaultAsync(
                c => c.OwnerKey == owner
                  && c.CourseId == course.CourseId
                  && c.CourseVersion == course.CourseVersion, ct);
            return won is null
                ? new CertificateResult(null, new CertificateRefusal(
                    "The certificate could not be issued. Try again.", []))
                : new CertificateResult(ToView(won, course.Title), null);
        }

        return new CertificateResult(ToView(certificate, course.Title), null);
    }

    /// <summary>Public verification. Takes only the opaque identifier and returns only what a
    /// certificate says — never the owner key, and never anything about other people's progress.</summary>
    public async Task<LearningCertificateView?> VerifyAsync(
        string certificateId, CancellationToken ct)
    {
        var certificate = await db.Certificates.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == certificateId, ct);
        if (certificate is null) return null;

        var title = CourseManifests.All.TryGetValue(certificate.CourseId, out var course)
            ? course.Title
            : certificate.CourseId;
        return ToView(certificate, title);
    }

    // ── internals ──────────────────────────────────────────────────────────

    private Task<LearningUnitProgress?> FindUnitAsync(
        string owner, CourseManifest course, string unitId, CancellationToken ct) =>
        db.UnitProgress.FirstOrDefaultAsync(
            u => u.OwnerKey == owner
              && u.CourseId == course.CourseId
              && u.CourseVersion == course.CourseVersion
              && u.UnitId == unitId, ct);

    private async Task EnsureEnrolledAsync(
        string owner, CourseManifest course, CancellationToken ct)
    {
        var exists = await db.CourseProgress.AnyAsync(
            p => p.OwnerKey == owner
              && p.CourseId == course.CourseId
              && p.CourseVersion == course.CourseVersion, ct);
        if (exists) return;

        var now = DateTime.UtcNow;
        db.CourseProgress.Add(new LearningCourseProgress
        {
            OwnerKey = owner,
            CourseId = course.CourseId,
            CourseVersion = course.CourseVersion,
            StartedUtc = now,
            LastActivityUtc = now,
        });
        await SaveTolerantlyAsync(ct);
    }

    private async Task TouchAsync(string owner, CourseManifest course, CancellationToken ct)
    {
        var enrolment = await db.CourseProgress.FirstOrDefaultAsync(
            p => p.OwnerKey == owner
              && p.CourseId == course.CourseId
              && p.CourseVersion == course.CourseVersion, ct);
        if (enrolment is null) return;
        enrolment.LastActivityUtc = DateTime.UtcNow;
        await SaveTolerantlyAsync(ct);
    }

    private async Task MarkCourseCompleteIfFinishedAsync(
        string owner, CourseManifest course, CancellationToken ct)
    {
        var enrolment = await db.CourseProgress.FirstOrDefaultAsync(
            p => p.OwnerKey == owner
              && p.CourseId == course.CourseId
              && p.CourseVersion == course.CourseVersion, ct);
        if (enrolment is null || enrolment.CompletedUtc is not null) return;

        var done = await db.UnitProgress.AsNoTracking()
            .Where(u => u.OwnerKey == owner
                     && u.CourseId == course.CourseId
                     && u.CourseVersion == course.CourseVersion
                     && (u.Status == "completed" || u.Status == "mastered"))
            .Select(u => u.UnitId)
            .ToListAsync(ct);

        var set = done.ToHashSet(StringComparer.Ordinal);
        if (!course.AllRequiredUnitIds.All(set.Contains)) return;

        enrolment.CompletedUtc = DateTime.UtcNow;
        await SaveTolerantlyAsync(ct);
    }

    /// <summary>Progress is worth recording and never worth taking the page down for. A lost write
    /// costs the learner one click; a thrown exception costs them the lesson they were reading.</summary>
    private async Task SaveTolerantlyAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            db.ChangeTracker.Clear();
            log.LogDebug(ex, "Learning progress write lost a race; the stored row stands.");
        }
    }

    /// <summary>Opaque, unguessable, and not derived from the owner — a certificate URL is shared in
    /// public, so it must not be enumerable and must not encode who earned it.</summary>
    private static string NewCertificateId()
    {
        Span<byte> bytes = stackalloc byte[16];
        RandomNumberGenerator.Fill(bytes);
        return "hoc-" + Convert.ToHexStringLower(bytes);
    }

    private static LearningUnitView ToView(LearningUnitProgress u) => new(
        u.UnitId, u.UnitType, u.Status, u.Score, u.Attempts,
        u.BestElapsedMs, u.Clean, u.CompletedUtc);

    private static LearningCertificateView ToView(LearningCertificate c, string title) => new(
        c.Id, c.CourseId, c.CourseVersion, title, c.LearnerName, c.IssuedUtc,
        c.Skills.Length == 0
            ? []
            : [.. c.Skills.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)]);
}
