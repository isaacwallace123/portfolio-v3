namespace IsaacWallace.Api.Data;

// HomeOps Academy progress.
//
// A separate domain from DrillResult on purpose. A drill result is a fact about a cluster — this
// operator solved this incident, in this time, on this run. Learning progress is a fact about a
// person's course, and it outlives every cluster they ever provisioned. Mixing them would mean a
// torn-down namespace could erase a curriculum, and it would make "have you finished segment 4?"
// a question about Kubernetes.
//
// Everything is keyed by (OwnerKey, CourseId, CourseVersion). The version is part of the key rather
// than a column that gets overwritten: completing version 1 stays true after the lessons are
// rewritten, and the certificate names the version it was earned against.

/// <summary>A learner's enrolment in one version of one course.</summary>
public sealed class LearningCourseProgress
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n");

    /// <summary>The opaque per-user key — a hash of the account id, never the id itself. Same
    /// derivation the run broker uses, so one person is one learner across both.</summary>
    public string OwnerKey { get; set; } = "";

    public string CourseId { get; set; } = "";
    public int CourseVersion { get; set; }

    public DateTime StartedUtc { get; set; }

    /// <summary>Set when every unit including the final assessment is done. Null until then.</summary>
    public DateTime? CompletedUtc { get; set; }

    public DateTime LastActivityUtc { get; set; }
}

/// <summary>One completable thing: a lesson, a segment checkpoint, a capstone drill, or the final
/// assessment. The unit id is derived from content (`lesson:the-request-path`), so renaming a
/// lesson creates a new unit — which is the correct behaviour, not a bug to work around.</summary>
public sealed class LearningUnitProgress
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n");

    public string OwnerKey { get; set; } = "";
    public string CourseId { get; set; } = "";
    public int CourseVersion { get; set; }

    public string UnitId { get; set; } = "";

    /// <summary>lesson | checkpoint | drill | assessment.</summary>
    public string UnitType { get; set; } = "lesson";

    /// <summary>available | in-progress | completed | mastered.</summary>
    public string Status { get; set; } = "in-progress";

    /// <summary>Checkpoints only: percent correct, 0–100. Null everywhere else.</summary>
    public int? Score { get; set; }

    public int Attempts { get; set; }

    /// <summary>Drill units only: the best real-cluster time recorded against this unit.</summary>
    public long? BestElapsedMs { get; set; }

    /// <summary>Drill units only: this unit has at some point been solved with no wrong operational
    /// action. Sticky by design — a later messy retry must not erase a clean solve that happened,
    /// because five clean capstones is a certificate requirement about what the learner did.</summary>
    public bool Clean { get; set; }

    public DateTime? CompletedUtc { get; set; }
}

/// <summary>One go at a unit. Kept separate from the unit's rolled-up state so a debrief can be
/// rebuilt and so "attempts" is a count of rows rather than a number that has to be right.</summary>
public sealed class LearningAttempt
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n");

    public string OwnerKey { get; set; } = "";
    public string CourseId { get; set; } = "";
    public string UnitId { get; set; } = "";

    /// <summary>The cluster a drill unit ran on, or empty for a lesson or checkpoint.</summary>
    public string RunId { get; set; } = "";

    /// <summary>guided | assisted | assessment. A presentation over the same practice scenario;
    /// never the ranked mode, and never written to ranked results.</summary>
    public string Presentation { get; set; } = "guided";

    public DateTime StartedUtc { get; set; }
    public DateTime? CompletedUtc { get; set; }

    /// <summary>completed | abandoned.</summary>
    public string Outcome { get; set; } = "completed";

    public int Missteps { get; set; }
    public long ElapsedMs { get; set; }
}

/// <summary>An issued certificate. The identifier is opaque and is the only thing a verification
/// URL carries, so a shared certificate reveals a completion rather than an account.</summary>
public sealed class LearningCertificate
{
    /// <summary>The public certificate identifier. Random, not derived from the owner.</summary>
    public string Id { get; set; } = "";

    public string OwnerKey { get; set; } = "";
    public string CourseId { get; set; } = "";
    public int CourseVersion { get; set; }

    /// <summary>The name to print, resolved from the SSO session at issue time and frozen there.
    /// A certificate should say who earned it on the day, not who they renamed themselves to.</summary>
    public string LearnerName { get; set; } = "operator";

    public DateTime IssuedUtc { get; set; }

    /// <summary>Comma-separated domain labels demonstrated by a solved capstone.</summary>
    public string Skills { get; set; } = "";
}
