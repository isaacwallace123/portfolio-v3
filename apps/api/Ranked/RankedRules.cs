namespace IsaacWallace.Api.Ranked;

public static class RankedOutcomes
{
    public const string Active = "active";
    public const string Completed = "completed";
    public const string Failed = "failed";
    public const string Forfeited = "forfeited";
    public const string Expired = "expired";
    public const string Void = "void";

    public static bool IsRated(string outcome) =>
        outcome is Completed or Failed or Forfeited or Expired;

    public static bool IsFinal(string outcome) =>
        IsRated(outcome) || outcome == Void;
}

public sealed record RatingResult(
    int Before,
    int Delta,
    int After,
    double ExpectedScore,
    int KFactor);

public sealed record RankedDivision(
    string Name,
    int Floor,
    int? Ceiling,
    double Progress);

/// <summary>
/// Seasonless solo ELO. The incident is the opponent: its calibrated rating determines how much a
/// clean solve is worth and how costly a failed call is. Time deliberately does not enter this
/// calculation; it remains an independent per-scenario record.
/// </summary>
public static class RankedRules
{
    public const int InitialRating = 1000;
    public const int PlacementGames = 5;
    public const int ScenarioVersion = 1;
    public const int MinimumAbandonmentLoss = 12;

    private static readonly IReadOnlyDictionary<string, int> ScenarioRatings =
        new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["cascade-scale-release"] = 1150,
            ["cascade-cost-surge"] = 1250,
            ["cascade-recovery-regression"] = 1350,
            ["cascade-evacuation"] = 1250,
            ["cascade-canary"] = 1400,
            ["cascade-gateway-peak"] = 1450,
            ["cascade-full-sev"] = 1600,
        };

    public static bool IsCalibratedScenario(string drillId) =>
        ScenarioRatings.ContainsKey(drillId);

    public static int ScenarioRating(string drillId) =>
        ScenarioRatings.TryGetValue(drillId, out var rating)
            ? rating
            : throw new InvalidOperationException(
                $"Ranked scenario '{drillId}' has no rating calibration.");

    public static double ExpectedScore(int playerRating, int scenarioRating)
    {
        var raw = 1.0 / (1.0 + Math.Pow(10.0, (scenarioRating - playerRating) / 400.0));
        // A very large rating gap should never make a game literally worthless or maximally
        // destructive. The clamp also ensures a decided match always moves the visible rating.
        return Math.Clamp(raw, 0.05, 0.95);
    }

    public static RatingResult Calculate(
        int playerRating,
        int gamesPlayed,
        int scenarioRating,
        bool completed,
        bool abandoned = false)
    {
        var expected = ExpectedScore(playerRating, scenarioRating);
        var k = gamesPlayed < 10 ? 40 : 24;
        var score = completed ? 1.0 : 0.0;
        var rawDelta = (int)Math.Round(k * (score - expected), MidpointRounding.AwayFromZero);
        if (!completed && abandoned)
            rawDelta = Math.Min(rawDelta, -MinimumAbandonmentLoss);
        var delta = rawDelta == 0 ? (completed ? 1 : -1) : rawDelta;
        var after = Math.Max(100, playerRating + delta);
        return new RatingResult(playerRating, after - playerRating, after, expected, k);
    }

    public static RankedDivision Division(int rating)
    {
        if (rating < 900) return Progress("Bronze", 100, 900, rating);
        if (rating < 1100) return Progress("Silver", 900, 1100, rating);
        if (rating < 1300) return Progress("Gold", 1100, 1300, rating);
        if (rating < 1500) return Progress("Platinum", 1300, 1500, rating);
        if (rating < 1700) return Progress("Diamond", 1500, 1700, rating);
        return new RankedDivision("Master", 1700, null, 1);
    }

    private static RankedDivision Progress(string name, int floor, int ceiling, int rating) =>
        new(
            name,
            floor,
            ceiling,
            Math.Clamp((rating - floor) / (double)(ceiling - floor), 0, 1));
}
