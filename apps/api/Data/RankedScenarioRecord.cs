namespace IsaacWallace.Api.Data;

/// <summary>
/// Immutable generated-incident receipt. The token can rebuild the plan; PlanJson preserves the
/// exact value that was rated so audits do not depend on whichever generator version is current.
/// </summary>
public sealed class RankedScenarioRecord
{
    public string AttemptId { get; set; } = "";
    public string OwnerKey { get; set; } = "";
    public string DrillId { get; set; } = "";
    public string SeedId { get; set; } = "";
    public int GeneratorVersion { get; set; }
    public int PlayerRating { get; set; }
    public string PlanJson { get; set; } = "";
    public string FamiliesJson { get; set; } = "[]";
    public DateTime CreatedUtc { get; set; }
}

/// <summary>
/// Aggregate live calibration for one generated fault family. It contains no operator identity:
/// matchmaking learns only whether the field is beating this family, never who supplied a result.
/// </summary>
public sealed class RankedCalibrationRecord
{
    public string Family { get; set; } = "";
    public int RatedAttempts { get; set; }
    public int Completions { get; set; }
    public DateTime UpdatedUtc { get; set; }
}
