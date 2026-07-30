namespace IsaacWallace.Api.Data;

/// <summary>
/// One server-drawn competitive incident. Unlike DrillResult, this row exists before the first
/// decision and records every terminal outcome, including failures and forfeits.
/// </summary>
public sealed class RankedAttempt
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n");
    public string RunId { get; set; } = "";
    public string DrillId { get; set; } = "";
    public int ScenarioVersion { get; set; }
    public int ScenarioRating { get; set; }
    public string OwnerKey { get; set; } = "";
    public string DisplayName { get; set; } = "operator";
    public string Outcome { get; set; } = "active";
    public DateTime StartedUtc { get; set; }
    public DateTime? CompletedUtc { get; set; }
    public long ElapsedMs { get; set; }
    public int StageReached { get; set; }
    public string FailedMove { get; set; } = "";
    public int PreRating { get; set; }
    public double ExpectedScore { get; set; }
    public int RatingDelta { get; set; }
    public int PostRating { get; set; }
}

public sealed class OperatorRating
{
    public string OwnerKey { get; set; } = "";
    public string DisplayName { get; set; } = "operator";
    public int Rating { get; set; }
    public int PeakRating { get; set; }
    public int GamesPlayed { get; set; }
    public int Wins { get; set; }
    public int Losses { get; set; }
    public int CurrentStreak { get; set; }
    public int BestStreak { get; set; }
    public DateTime UpdatedUtc { get; set; }
}

/// <summary>Append-only audit of every rating mutation. AttemptId is unique.</summary>
public sealed class RatingLedgerEntry
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n");
    public string AttemptId { get; set; } = "";
    public string OwnerKey { get; set; } = "";
    public string Outcome { get; set; } = "";
    public int BeforeRating { get; set; }
    public int Delta { get; set; }
    public int AfterRating { get; set; }
    public DateTime CreatedUtc { get; set; }
}
