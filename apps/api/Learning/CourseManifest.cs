namespace IsaacWallace.Api.Learning;

// What the server knows about the course.
//
// Deliberately not the curriculum. Lesson prose, diagrams and knowledge checks live in the front
// end, where they belong; this is the far smaller thing the API has to know in order to be the
// authority on completion: which units exist, which of them are capstones, and how many capstones
// must have been solved cleanly.
//
// The alternative was to let the browser tell the API what the requirements are, which would make
// the certificate an assertion by the client about itself. That is not a certificate.
//
// KEEPING THIS IN STEP
// Unit ids are derived in apps/homelab/src/features/academy/model/course.ts by the same rules:
//   lesson:<lessonId> · checkpoint:<segmentId> · drill:<segmentId>:<drillId> · assessment:<drillId>
// A unit id present here and absent from the content is unreachable and blocks the certificate
// forever; the reverse is a lesson that does not count. `GET /v1/learning/courses` publishes this
// manifest so the front end can assert the two agree, and it does, in an automated test.

public sealed record CourseSegmentManifest(
    string SegmentId,
    IReadOnlyList<string> LessonUnitIds,
    string CheckpointUnitId,
    string CapstoneUnitId);

public sealed record CourseManifest(
    string CourseId,
    int CourseVersion,
    string Title,
    IReadOnlyList<CourseSegmentManifest> Segments,
    string AssessmentUnitId,
    IReadOnlyList<string> OptionalDrillUnitIds,
    int MinimumCheckScore,
    int CleanCapstonesRequired)
{
    public IEnumerable<string> RequiredLessonUnitIds =>
        Segments.SelectMany(s => s.LessonUnitIds);

    public IEnumerable<string> CheckpointUnitIds =>
        Segments.Select(s => s.CheckpointUnitId);

    public IEnumerable<string> CapstoneUnitIds =>
        Segments.Select(s => s.CapstoneUnitId);

    public IEnumerable<string> AllRequiredUnitIds =>
        RequiredLessonUnitIds
            .Concat(CheckpointUnitIds)
            .Concat(CapstoneUnitIds)
            .Append(AssessmentUnitId);

    public IEnumerable<string> AllUnitIds =>
        AllRequiredUnitIds.Concat(OptionalDrillUnitIds);
}

public static class CourseManifests
{
    private static CourseSegmentManifest Segment(
        string segmentId, string capstoneDrillId, params string[] lessonIds) =>
        new(
            segmentId,
            [.. lessonIds.Select(id => $"lesson:{id}")],
            $"checkpoint:{segmentId}",
            $"drill:{segmentId}:{capstoneDrillId}");

    public const string ProductionOperationsId = "production-operations";

    public static readonly CourseManifest ProductionOperations = new(
        ProductionOperationsId,
        1,
        "Production Operations Foundations",
        [
            Segment("read-the-system", "checkout-traffic-spike",
                "the-request-path",
                "desired-versus-observed",
                "throughput-latency-errors",
                "objectives-that-measure"),
            Segment("capacity-and-scaling", "capacity-right-sizing",
                "offered-versus-served",
                "horizontal-scaling-convergence",
                "headroom-and-cost"),
            Segment("releases-and-rollouts", "release-under-load",
                "stable-and-candidate",
                "failure-under-load",
                "rollbacks-and-convergence"),
            Segment("data-and-caching", "catalogue-data-recovery",
                "the-data-tier",
                "cache-masking",
                "recovery-and-verification"),
            Segment("scheduling-and-movement", "worker-evacuation",
                "pods-workers-scheduling",
                "drains-and-headroom",
                "verifying-placement"),
            Segment("gateways-and-flow", "gateway-saturation",
                "the-gateway-role",
                "finding-the-queue",
                "cascading-bottlenecks"),
            Segment("progressive-delivery", "canary-catch",
                "full-rollout-versus-canary",
                "abort-observe-recover",
                "exposure-and-error-budgets"),
        ],
        AssessmentUnitId: "assessment:double-fault",
        OptionalDrillUnitIds:
        [
            "drill:capacity-and-scaling:front-and-back",
            "drill:capacity-and-scaling:cold-start-storm",
            "drill:capacity-and-scaling:checkout-traffic-spike",
            "drill:releases-and-rollouts:checkout-bad-release",
            "drill:data-and-caching:catalogue-cache-mask",
            "drill:data-and-caching:double-fault",
            "drill:scheduling-and-movement:pool-return",
            "drill:gateways-and-flow:front-and-back",
            "drill:progressive-delivery:canary-first",
            "drill:progressive-delivery:canary-and-fleet",
        ],
        MinimumCheckScore: 80,
        CleanCapstonesRequired: 5);

    public static readonly IReadOnlyDictionary<string, CourseManifest> All =
        new Dictionary<string, CourseManifest>(StringComparer.Ordinal)
        {
            [ProductionOperationsId] = ProductionOperations,
        };

    public static CourseManifest? Find(string courseId, int version) =>
        All.TryGetValue(courseId, out var course) && course.CourseVersion == version
            ? course
            : null;

    /// <summary>A unit id the manifest does not contain is not part of the course. Rejected rather
    /// than stored, so a client cannot invent units and then count them towards anything.</summary>
    public static bool Contains(this CourseManifest course, string unitId) =>
        course.AllUnitIds.Contains(unitId, StringComparer.Ordinal);
}
