using IsaacWallace.Api.Runs;

namespace IsaacWallace.Api.Ranked;

public sealed record RankedTelemetryFrame(
    DateTime RecordedUtc,
    int Stage,
    int OfferedRequestsPerSec,
    int ServedRequestsPerSec,
    double P95LatencyMs,
    double ErrorRatePct,
    int ObjectiveGoalsMet,
    int ObjectiveGoalsTotal,
    int SloGoalsMet,
    int SloGoalsTotal,
    int HeldSeconds);

public sealed record RankedActionSignal(
    string Command,
    int Stage,
    DateTime AcceptedUtc);

public sealed record RankedPerformanceResult(
    int QualityScore,
    double RatingScore,
    int SloHealthScore,
    int ObjectiveHealthScore,
    int ActionScore,
    int ContainmentScore,
    int TargetedActions,
    int HarmfulActions,
    int UnnecessaryActions,
    int RedundantActions,
    int ConvergenceViolations,
    int SampleCount,
    double PeakP95LatencyMs,
    double PeakErrorRatePct,
    int MinimumServedRatioPct,
    int VerificationSeconds,
    string Band);

/// <summary>
/// Converts measured match history into a rating score. Official elapsed time is deliberately not
/// an input: the speed board owns time, while rating owns operational quality.
/// </summary>
public static class RankedPerformance
{
    public const int TelemetryBucketSeconds = 5;

    public static RankedPerformanceResult Evaluate(
        string outcome,
        ScenarioDefinition scenario,
        IReadOnlyList<RankedTelemetryFrame> frames,
        IReadOnlyList<RankedActionSignal> actions,
        int verificationTargetSeconds)
    {
        var objectiveHealth = GoalHealth(
            frames,
            frame => frame.ObjectiveGoalsMet,
            frame => frame.ObjectiveGoalsTotal);
        var sloHealth = GoalHealth(
            frames,
            frame => frame.SloGoalsMet,
            frame => frame.SloGoalsTotal);

        var targeted = 0;
        var harmful = 0;
        var unnecessary = 0;
        var redundant = 0;
        var convergenceViolations = 0;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var orderedActions = actions.OrderBy(action => action.AcceptedUtc).ToArray();

        for (var index = 0; index < orderedActions.Length; index++)
        {
            var action = orderedActions[index];
            var next = orderedActions
                .Skip(index + 1)
                .FirstOrDefault(candidate => candidate.Stage == action.Stage);
            if (next is not null &&
                next.AcceptedUtc - action.AcceptedUtc <
                TimeSpan.FromSeconds(TelemetryBucketSeconds))
                convergenceViolations++;

            var key = $"{action.Stage}:{action.Command}";
            if (!seen.Add(key))
            {
                redundant++;
                continue;
            }

            var before = frames
                .Where(frame =>
                    frame.Stage == action.Stage &&
                    frame.RecordedUtc <= action.AcceptedUtc)
                .OrderByDescending(frame => frame.RecordedUtc)
                .FirstOrDefault();
            var afterCutoff = action.AcceptedUtc.AddSeconds(TelemetryBucketSeconds);
            var after = frames
                .Where(frame =>
                    frame.Stage == action.Stage &&
                    frame.RecordedUtc >= afterCutoff &&
                    (next is null || frame.RecordedUtc < next.AcceptedUtc))
                .OrderBy(frame => frame.RecordedUtc)
                .FirstOrDefault();
            if (before is null || after is null)
                continue;

            var healthDelta = FrameHealth(after) - FrameHealth(before);
            if (healthDelta >= 8)
                targeted++;
            else if (healthDelta <= -8)
                harmful++;
            else
                unnecessary++;
        }

        var actionScore = Math.Clamp(
            100 -
            harmful * 30 -
            unnecessary * 12 -
            redundant * 8 -
            convergenceViolations * 10,
            0,
            100);
        var completed = outcome == RankedOutcomes.Completed;
        var stageReached = frames.Count == 0 ? 0 : frames.Max(frame => frame.Stage);
        var containment = completed
            ? 100
            : scenario.Stages.Count == 0
                ? 0
                : (int)Math.Round(
                    100.0 * Math.Max(0, stageReached - 1) / scenario.Stages.Count);
        var verificationSeconds = frames.Count == 0
            ? 0
            : frames.Max(frame => frame.HeldSeconds);
        if (completed)
            verificationSeconds = Math.Max(verificationSeconds, verificationTargetSeconds);
        var verificationScore = verificationTargetSeconds <= 0
            ? (completed ? 100 : 0)
            : Math.Clamp(
                (int)Math.Round(100.0 * verificationSeconds / verificationTargetSeconds),
                0,
                100);

        var quality = (int)Math.Round(
            sloHealth * 0.35 +
            objectiveHealth * 0.25 +
            actionScore * 0.25 +
            verificationScore * 0.15);
        quality = Math.Clamp(quality, 0, 100);

        // A verified recovery is still a win, but its ELO value ranges from fragile to controlled.
        // Failed/forfeited/expired attempts remain losses; containment is reported, not farmable.
        var ratingScore = completed
            ? Math.Round(0.55 + quality / 100.0 * 0.45, 4)
            : 0;

        var servedRatios = frames
            .Where(frame => frame.OfferedRequestsPerSec > 0)
            .Select(frame => (int)Math.Round(
                100.0 * frame.ServedRequestsPerSec / frame.OfferedRequestsPerSec))
            .ToArray();

        return new RankedPerformanceResult(
            quality,
            ratingScore,
            sloHealth,
            objectiveHealth,
            actionScore,
            containment,
            targeted,
            harmful,
            unnecessary,
            redundant,
            convergenceViolations,
            frames.Count,
            frames.Count == 0 ? 0 : frames.Max(frame => frame.P95LatencyMs),
            frames.Count == 0 ? 0 : frames.Max(frame => frame.ErrorRatePct),
            servedRatios.Length == 0 ? 0 : Math.Clamp(servedRatios.Min(), 0, 100),
            verificationSeconds,
            Band(outcome, quality));
    }

    private static int GoalHealth(
        IReadOnlyList<RankedTelemetryFrame> frames,
        Func<RankedTelemetryFrame, int> met,
        Func<RankedTelemetryFrame, int> total)
    {
        var denominator = frames.Sum(total);
        if (denominator == 0) return 0;
        return Math.Clamp(
            (int)Math.Round(100.0 * frames.Sum(met) / denominator),
            0,
            100);
    }

    private static double FrameHealth(RankedTelemetryFrame frame)
    {
        var objective = frame.ObjectiveGoalsTotal == 0
            ? 0
            : frame.ObjectiveGoalsMet / (double)frame.ObjectiveGoalsTotal;
        var slo = frame.SloGoalsTotal == 0
            ? objective
            : frame.SloGoalsMet / (double)frame.SloGoalsTotal;
        return 100 * (slo * 0.6 + objective * 0.4);
    }

    private static string Band(string outcome, int quality) =>
        outcome != RankedOutcomes.Completed
            ? "uncontained"
            : quality >= 90
                ? "controlled"
                : quality >= 75
                    ? "stable"
                    : quality >= 60
                        ? "recovered"
                        : "fragile";
}
