namespace IsaacWallace.Api.Data;

/// <summary>One fixed-time telemetry bucket from an active competitive attempt.</summary>
public sealed class RankedTelemetrySample
{
    public string Id { get; set; } = "";
    public string AttemptId { get; set; } = "";
    public string RunId { get; set; } = "";
    public string OwnerKey { get; set; } = "";
    public DateTime RecordedUtc { get; set; }
    public int Stage { get; set; }
    public int OfferedRequestsPerSec { get; set; }
    public int ServedRequestsPerSec { get; set; }
    public double P95LatencyMs { get; set; }
    public double ErrorRatePct { get; set; }
    public int ObjectiveGoalsMet { get; set; }
    public int ObjectiveGoalsTotal { get; set; }
    public int SloGoalsMet { get; set; }
    public int SloGoalsTotal { get; set; }
    public int HeldSeconds { get; set; }
}

/// <summary>
/// Immutable explanation of the quality score used when the attempt was sealed.
/// </summary>
public sealed class RankedPerformanceRecord
{
    public string AttemptId { get; set; } = "";
    public string OwnerKey { get; set; } = "";
    public int QualityScore { get; set; }
    public double RatingScore { get; set; }
    public int SloHealthScore { get; set; }
    public int ObjectiveHealthScore { get; set; }
    public int ActionScore { get; set; }
    public int ContainmentScore { get; set; }
    public int TargetedActions { get; set; }
    public int HarmfulActions { get; set; }
    public int UnnecessaryActions { get; set; }
    public int RedundantActions { get; set; }
    public int ConvergenceViolations { get; set; }
    public int SampleCount { get; set; }
    public double PeakP95LatencyMs { get; set; }
    public double PeakErrorRatePct { get; set; }
    public int MinimumServedRatioPct { get; set; }
    public int VerificationSeconds { get; set; }
    public string Band { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
}
