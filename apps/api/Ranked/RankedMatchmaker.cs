using IsaacWallace.Api.Runs;

namespace IsaacWallace.Api.Ranked;

public static class RankedMatchmaker
{
    public const int CandidatePoolSize = 3;
    public const int RecentExclusionCount = 3;

    /// <summary>
    /// Build the small server-side draw pool nearest the operator's current rating. Recent scenario
    /// families are excluded when the catalog has alternatives, preventing immediate farming while
    /// retaining a fallback if the catalog is temporarily small.
    /// </summary>
    public static IReadOnlyList<ScenarioDefinition> CandidatePool(
        int playerRating,
        IEnumerable<ScenarioDefinition> scenarios,
        IEnumerable<string> recentScenarioIds)
    {
        var calibrated = scenarios
            .Where(scenario => RankedRules.IsCalibratedScenario(scenario.Id))
            .ToArray();
        if (calibrated.Length == 0) return [];

        var excluded = recentScenarioIds
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Take(RecentExclusionCount)
            .ToHashSet(StringComparer.Ordinal);
        var fresh = calibrated
            .Where(scenario => !excluded.Contains(scenario.Id))
            .ToArray();
        var eligible = fresh.Length > 0 ? fresh : calibrated;

        return eligible
            .OrderBy(scenario =>
                Math.Abs(RankedRules.ScenarioRating(scenario.Id) - playerRating))
            .ThenBy(scenario => RankedRules.ScenarioRating(scenario.Id))
            .ThenBy(scenario => scenario.Id, StringComparer.Ordinal)
            .Take(CandidatePoolSize)
            .ToArray();
    }
}
