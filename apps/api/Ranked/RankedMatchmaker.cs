namespace IsaacWallace.Api.Ranked;

public sealed record RankedDraw(
    RankedScenarioPlan Plan,
    int SeedsConsidered,
    bool RecencyRelaxed);

/// <summary>
/// Draws a unique generated incident near the operator's exact rating. Seed uniqueness is absolute;
/// recent-family exclusion is preferred and relaxed only when the bounded draw cannot satisfy it.
/// </summary>
public static class RankedMatchmaker
{
    public const int RecentExclusionCount = 3;
    public const int DrawAttempts = 16;

    public static RankedDraw? Draw(
        int playerRating,
        IEnumerable<string> recentFamilies,
        IReadOnlySet<string> playedSeedIds,
        Func<RankedScenarioSeed>? seedSource = null,
        IReadOnlyDictionary<string, int>? calibrationAdjustments = null)
    {
        var excluded = recentFamilies
            .Where(family => !string.IsNullOrWhiteSpace(family))
            .ToHashSet(StringComparer.Ordinal);
        var source = seedSource ?? (() => RankedScenarioGenerator.NewSeed(playerRating));
        var considered = 0;

        for (var relaxed = 0; relaxed < 2; relaxed++)
        {
            for (var attempt = 0; attempt < DrawAttempts; attempt++)
            {
                var seed = source();
                if (!seed.IsWellFormed ||
                    seed.PlayerRating != RankedScenarioSeed.Quantize(playerRating))
                    continue;
                considered++;
                if (playedSeedIds.Contains(seed.SeedId)) continue;

                RankedScenarioPlan baseline;
                try
                {
                    baseline = RankedScenarioGenerator.Generate(seed);
                }
                catch (ArgumentException)
                {
                    continue;
                }

                var adjustment = baseline.FamilyList
                    .Select(family =>
                        calibrationAdjustments?.GetValueOrDefault(family) ?? 0)
                    .DefaultIfEmpty(0)
                    .Average();
                var calibratedRating = RankedScenarioSeed.Quantize(
                    (int)Math.Round(playerRating + adjustment));
                var calibratedSeed = seed with { PlayerRating = calibratedRating };
                var plan = calibratedRating == seed.PlayerRating
                    ? baseline
                    : RankedScenarioGenerator.Generate(calibratedSeed);

                if (relaxed == 0 && plan.Families.Any(excluded.Contains)) continue;
                return new RankedDraw(plan, considered, relaxed > 0);
            }
        }

        return null;
    }

    public static IReadOnlyList<string> RecentFamilies(IEnumerable<string> recentDrillIds) =>
        recentDrillIds
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Take(RecentExclusionCount)
            .Select(RankedScenarioCatalog.TryPlan)
            .Where(plan => plan is not null)
            .SelectMany(plan => plan!.FamilyList)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
}
