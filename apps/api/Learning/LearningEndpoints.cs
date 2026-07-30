using System.Text.RegularExpressions;
using IsaacWallace.Api.Auth;
using IsaacWallace.Api.Data;

namespace IsaacWallace.Api.Learning;

// HomeOps Academy: /v1/learning/*.
//
// These endpoints record curriculum progress. They are not a second cluster controller — nothing
// here provisions, mutates, or reads a Kubernetes workload, and a capstone only becomes "complete"
// because the run broker already judged it solved from measured telemetry.
//
// Owner identity arrives the same way it does for runs: an opaque per-user key that the site
// resolves server-side from the visitor's SSO session and forwards on a header. The browser never
// supplies it.
public static class LearningEndpoints
{
    private const string OwnerHeader = "X-Owner-Key";
    private const string OwnerNameHeader = "X-Owner-Name";
    private const int MaxLearnerNameLength = 64;

    // Unit ids are content-derived and always have this shape. Checked before anything is stored,
    // so a caller cannot write rows with ids the course does not use — the manifest check that
    // follows is the real boundary, and this keeps malformed input from reaching it.
    private static readonly Regex UnitIdPattern = new(
        @"^(lesson|checkpoint|drill|assessment):[a-z0-9-]+(:[a-z0-9-]+)?$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex CertificateIdPattern = new(
        @"^hoc-[0-9a-f]{32}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static string Owner(HttpContext ctx) =>
        ctx.Request.Headers[OwnerHeader].ToString().Trim();

    private static string OwnerName(HttpContext ctx)
    {
        var raw = ctx.Request.Headers[OwnerNameHeader].ToString();
        var cleaned = new string(raw.Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (cleaned.Length == 0) return "operator";
        return cleaned.Length <= MaxLearnerNameLength
            ? cleaned
            : cleaned[..MaxLearnerNameLength].TrimEnd();
    }

    /// <summary>Resolve the course the request is about, defaulting to the only one there is.</summary>
    private static CourseManifest? Resolve(string? courseId, int? version)
    {
        var id = string.IsNullOrWhiteSpace(courseId)
            ? CourseManifests.ProductionOperationsId
            : courseId;
        if (!CourseManifests.All.TryGetValue(id, out var course)) return null;
        return version is null || version == course.CourseVersion ? course : null;
    }

    public static void MapLearningEndpoints(this WebApplication app)
    {
        // The curriculum's skeleton, so the front end can assert that its content and the server's
        // idea of what counts have not drifted apart. Publishing it is what makes that testable.
        app.MapGet("/v1/learning/courses", () => Results.Ok(new
        {
            courses = CourseManifests.All.Values.Select(c => new
            {
                c.CourseId,
                c.CourseVersion,
                c.Title,
                c.MinimumCheckScore,
                c.CleanCapstonesRequired,
                segments = c.Segments.Select(s => new
                {
                    s.SegmentId,
                    s.LessonUnitIds,
                    s.CheckpointUnitId,
                    s.CapstoneUnitId,
                }),
                c.AssessmentUnitId,
                c.OptionalDrillUnitIds,
            }),
        })).RequireScope(ApiScopes.RunsRead);

        app.MapGet("/v1/learning/progress", async (
            HttpContext ctx,
            LearningProgressStore store,
            string? courseId,
            int? courseVersion,
            CancellationToken ct) =>
        {
            var course = Resolve(courseId, courseVersion);
            if (course is null) return Results.NotFound(new { error = "No such course." });
            return Results.Ok(await store.GetAsync(Owner(ctx), course, ct));
        }).RequireScope(ApiScopes.RunsRead);

        app.MapPost("/v1/learning/units/{unitId}/start", async (
            string unitId,
            StartUnitRequest? req,
            HttpContext ctx,
            LearningProgressStore store,
            CancellationToken ct) =>
        {
            var owner = Owner(ctx);
            if (owner.Length == 0)
                return Results.Json(new { error = "Sign in to record progress." }, statusCode: 401);

            var course = Resolve(req?.CourseId, req?.CourseVersion);
            if (course is null) return Results.NotFound(new { error = "No such course." });
            if (!UnitIdPattern.IsMatch(unitId) || !course.Contains(unitId))
                return Results.NotFound(new { error = "No such unit." });

            var type = unitId.Split(':')[0];
            return Results.Ok(await store.StartUnitAsync(owner, course, unitId, type, ct));
        }).RequireScope(ApiScopes.RunsWrite);

        // Completing a unit is a report, not an assertion of eligibility. Scores and clean flags are
        // stored; whether they add up to a certificate is decided by the store from its own rows.
        app.MapPost("/v1/learning/units/{unitId}/complete", async (
            string unitId,
            CompleteUnitRequest req,
            HttpContext ctx,
            LearningProgressStore store,
            CancellationToken ct) =>
        {
            var owner = Owner(ctx);
            if (owner.Length == 0)
                return Results.Json(new { error = "Sign in to record progress." }, statusCode: 401);

            var course = Resolve(req.CourseId, req.CourseVersion);
            if (course is null) return Results.NotFound(new { error = "No such course." });
            if (!UnitIdPattern.IsMatch(unitId) || !course.Contains(unitId))
                return Results.NotFound(new { error = "No such unit." });
            if (unitId.StartsWith("drill:", StringComparison.Ordinal) ||
                unitId.StartsWith("assessment:", StringComparison.Ordinal))
                return Results.Json(
                    new { error = "Cluster units are completed by the run broker after a measured solve." },
                    statusCode: 409);

            var presentation = req.Presentation is "guided" or "assisted" or "assessment"
                ? req.Presentation
                : "guided";

            var completion = new UnitCompletion(
                UnitType: unitId.Split(':')[0],
                Score: req.Score is int s ? Math.Clamp(s, 0, 100) : null,
                ElapsedMs: req.ElapsedMs is long e && e > 0 ? e : null,
                Clean: req.Clean ?? false,
                Mastered: req.Mastered ?? false,
                RunId: req.RunId ?? "",
                Presentation: presentation,
                Missteps: Math.Max(0, req.Missteps ?? 0));

            return Results.Ok(
                await store.CompleteUnitAsync(owner, course, unitId, completion, ct));
        }).RequireScope(ApiScopes.RunsWrite);

        app.MapGet("/v1/learning/certificate", async (
            HttpContext ctx,
            LearningProgressStore store,
            string? courseId,
            int? courseVersion,
            CancellationToken ct) =>
        {
            var course = Resolve(courseId, courseVersion);
            if (course is null) return Results.NotFound(new { error = "No such course." });

            var progress = await store.GetAsync(Owner(ctx), course, ct);
            return progress.Certificate is null
                ? Results.NotFound(new { error = "No certificate has been issued." })
                : Results.Ok(progress.Certificate);
        }).RequireScope(ApiScopes.RunsRead);

        // Issue. Every requirement is re-checked here against persisted rows; the request body
        // carries no claims about eligibility, only the skills to print if it succeeds.
        app.MapPost("/v1/learning/certificate", async (
            IssueCertificateRequest? req,
            HttpContext ctx,
            LearningProgressStore store,
            CancellationToken ct) =>
        {
            var owner = Owner(ctx);
            if (owner.Length == 0)
                return Results.Json(
                    new { error = "A certificate is issued to an account." }, statusCode: 401);

            var course = Resolve(req?.CourseId, req?.CourseVersion);
            if (course is null) return Results.NotFound(new { error = "No such course." });

            var skills = (req?.Skills ?? [])
                .Select(s => new string(s.Where(char.IsLetterOrDigit).Append(' ').ToArray()).Trim())
                .Where(s => s.Length is > 0 and <= 48)
                .Take(12)
                .ToArray();

            var result = await store.IssueCertificateAsync(
                owner, course, OwnerName(ctx), skills, ct);

            if (result.Certificate is not null) return Results.Ok(result.Certificate);
            return Results.Json(new
            {
                error = result.Refusal?.Reason ?? "The certificate could not be issued.",
                outstanding = result.Refusal?.Outstanding ?? [],
            }, statusCode: 409);
        }).RequireScope(ApiScopes.RunsWrite);

        // Public verification, by opaque id. Returns what the certificate says and nothing about
        // the account that holds it.
        app.MapGet("/v1/learning/certificates/{certificateId}", async (
            string certificateId,
            LearningProgressStore store,
            CancellationToken ct) =>
        {
            if (!CertificateIdPattern.IsMatch(certificateId))
                return Results.NotFound(new { error = "No such certificate." });

            var certificate = await store.VerifyAsync(certificateId, ct);
            return certificate is null
                ? Results.NotFound(new { error = "No such certificate." })
                : Results.Ok(certificate);
        }).RequireScope(ApiScopes.RunsRead);
    }
}

record StartUnitRequest(string? CourseId, int? CourseVersion);

record CompleteUnitRequest(
    string? CourseId,
    int? CourseVersion,
    int? Score,
    long? ElapsedMs,
    bool? Clean,
    bool? Mastered,
    string? RunId,
    string? Presentation,
    int? Missteps);

record IssueCertificateRequest(string? CourseId, int? CourseVersion, string[]? Skills);
