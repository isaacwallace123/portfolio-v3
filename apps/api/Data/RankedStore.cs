using System.Data;
using IsaacWallace.Api.Ranked;
using Microsoft.EntityFrameworkCore;

namespace IsaacWallace.Api.Data;

public sealed record RankedAttemptView(
    string Id,
    string RunId,
    string DrillId,
    int ScenarioVersion,
    int ScenarioRating,
    string Outcome,
    DateTime StartedUtc,
    DateTime? CompletedUtc,
    long ElapsedMs,
    int StageReached,
    string FailedMove,
    int PreRating,
    double ExpectedScore,
    int RatingDelta,
    int PostRating);

public sealed record RankedProfileView(
    int Rating,
    int PeakRating,
    int? LadderRank,
    int RatedOperators,
    string Division,
    int DivisionFloor,
    int? DivisionCeiling,
    double DivisionProgress,
    int GamesPlayed,
    int Wins,
    int Losses,
    int CurrentStreak,
    int BestStreak,
    int ProvisionalGamesRemaining,
    IReadOnlyList<RankedAttemptView> RecentAttempts);

public sealed record RankedStandingView(
    int Rank,
    string DisplayName,
    bool IsYou,
    int Rating,
    string Division,
    int GamesPlayed,
    int Wins,
    int Losses,
    int CurrentStreak);

public sealed record RankedActionView(
    string Id,
    string AttemptId,
    string RunId,
    string Command,
    string ActionId,
    int Stage,
    DateTime AcceptedUtc);

/// <summary>
/// The transactional boundary for competitive results. A final attempt, its rating mutation, and
/// its ledger row commit together, so two API replicas judging the same frame cannot rate it twice.
/// </summary>
public sealed class RankedStore(HomeOpsDbContext db, ILogger<RankedStore> log)
{
    public async Task<RankedAttemptView> BeginAsync(
        string runId,
        string drillId,
        string owner,
        string displayName,
        DateTime startedUtc,
        CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable, ct);

        var active = await db.RankedAttempts
            .AsNoTracking()
            .Where(a => a.OwnerKey == owner && a.Outcome == RankedOutcomes.Active)
            .OrderByDescending(a => a.StartedUtc)
            .FirstOrDefaultAsync(ct);
        if (active is not null)
            throw new InvalidOperationException("A ranked attempt is already active.");

        var rating = await db.OperatorRatings
            .AsNoTracking()
            .SingleOrDefaultAsync(r => r.OwnerKey == owner, ct);
        var current = rating?.Rating ?? RankedRules.InitialRating;
        var scenarioRating = RankedRules.ScenarioRating(drillId);

        var attempt = new RankedAttempt
        {
            RunId = runId,
            DrillId = drillId,
            ScenarioVersion = RankedRules.ScenarioVersion,
            ScenarioRating = scenarioRating,
            OwnerKey = owner,
            DisplayName = CleanName(displayName),
            Outcome = RankedOutcomes.Active,
            StartedUtc = Utc(startedUtc),
            PreRating = current,
            ExpectedScore = RankedRules.ExpectedScore(current, scenarioRating),
            PostRating = current,
        };
        db.RankedAttempts.Add(attempt);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return View(attempt);
    }

    public async Task<RankedAttemptView?> FinalizeAsync(
        string attemptId,
        string owner,
        string outcome,
        long elapsedMs,
        int stageReached,
        string failedMove,
        string displayName,
        CancellationToken ct)
    {
        if (!RankedOutcomes.IsFinal(outcome))
            throw new ArgumentOutOfRangeException(nameof(outcome), "Outcome must be terminal.");

        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, ct);
            var attempt = await db.RankedAttempts
                .SingleOrDefaultAsync(a => a.Id == attemptId && a.OwnerKey == owner, ct);
            if (attempt is null) return null;
            if (attempt.Outcome != RankedOutcomes.Active) return View(attempt);

            var now = DateTime.UtcNow;
            attempt.Outcome = outcome;
            attempt.CompletedUtc = now;
            attempt.ElapsedMs = Math.Max(0, elapsedMs);
            attempt.StageReached = Math.Max(0, stageReached);
            attempt.FailedMove = failedMove.Trim();
            if (!string.IsNullOrWhiteSpace(displayName))
                attempt.DisplayName = CleanName(displayName);

            if (RankedOutcomes.IsRated(outcome))
            {
                var rating = await db.OperatorRatings
                    .SingleOrDefaultAsync(r => r.OwnerKey == owner, ct);
                if (rating is null)
                {
                    rating = NewRating(owner, attempt.DisplayName, now);
                    db.OperatorRatings.Add(rating);
                }

                var completed = outcome == RankedOutcomes.Completed;
                var result = RankedRules.Calculate(
                    rating.Rating,
                    rating.GamesPlayed,
                    attempt.ScenarioRating,
                    completed,
                    outcome is RankedOutcomes.Forfeited or RankedOutcomes.Expired);

                attempt.PreRating = result.Before;
                attempt.ExpectedScore = result.ExpectedScore;
                attempt.RatingDelta = result.Delta;
                attempt.PostRating = result.After;

                rating.DisplayName = attempt.DisplayName;
                rating.Rating = result.After;
                rating.PeakRating = Math.Max(rating.PeakRating, result.After);
                rating.GamesPlayed += 1;
                if (completed)
                {
                    rating.Wins += 1;
                    rating.CurrentStreak += 1;
                    rating.BestStreak = Math.Max(rating.BestStreak, rating.CurrentStreak);
                }
                else
                {
                    rating.Losses += 1;
                    rating.CurrentStreak = 0;
                }
                rating.UpdatedUtc = now;

                db.RatingLedger.Add(new RatingLedgerEntry
                {
                    AttemptId = attempt.Id,
                    OwnerKey = owner,
                    Outcome = outcome,
                    BeforeRating = result.Before,
                    Delta = result.Delta,
                    AfterRating = result.After,
                    CreatedUtc = now,
                });
            }
            else
            {
                attempt.RatingDelta = 0;
                attempt.PostRating = attempt.PreRating;
            }

            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return View(attempt);
        }
        catch (DbUpdateException ex)
        {
            // Another API replica may have finalized the same attempt after both observed the same
            // terminal cluster state. The unique ledger index decides the race; return its result.
            log.LogDebug(ex, "Ranked attempt {AttemptId} was already finalized.", attemptId);
            db.ChangeTracker.Clear();
            return await GetAttemptAsync(attemptId, owner, ct);
        }
    }

    public async Task<RankedAttemptView?> GetAttemptAsync(
        string attemptId,
        string owner,
        CancellationToken ct)
    {
        var attempt = await db.RankedAttempts
            .AsNoTracking()
            .SingleOrDefaultAsync(a => a.Id == attemptId && a.OwnerKey == owner, ct);
        return attempt is null ? null : View(attempt);
    }

    public async Task<RankedAttemptView?> ActiveForRunAsync(
        string runId,
        string owner,
        CancellationToken ct)
    {
        var attempt = await db.RankedAttempts
            .AsNoTracking()
            .Where(a =>
                a.RunId == runId &&
                a.OwnerKey == owner &&
                a.Outcome == RankedOutcomes.Active)
            .OrderByDescending(a => a.StartedUtc)
            .FirstOrDefaultAsync(ct);
        return attempt is null ? null : View(attempt);
    }

    public async Task<RankedAttemptView?> ActiveForOwnerAsync(
        string owner,
        CancellationToken ct)
    {
        var attempt = await db.RankedAttempts
            .AsNoTracking()
            .Where(a => a.OwnerKey == owner && a.Outcome == RankedOutcomes.Active)
            .OrderByDescending(a => a.StartedUtc)
            .FirstOrDefaultAsync(ct);
        return attempt is null ? null : View(attempt);
    }

    public async Task<bool> RecordActionAsync(
        string id,
        string attemptId,
        string runId,
        string owner,
        string command,
        string actionId,
        int stage,
        DateTime acceptedUtc,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(id) ||
            string.IsNullOrWhiteSpace(attemptId) ||
            string.IsNullOrWhiteSpace(owner))
            return false;

        if (await db.RankedActions.AsNoTracking().AnyAsync(a => a.Id == id, ct))
            return true;

        var attemptExists = await db.RankedAttempts
            .AsNoTracking()
            .AnyAsync(
                attempt =>
                    attempt.Id == attemptId &&
                    attempt.RunId == runId &&
                    attempt.OwnerKey == owner,
                ct);
        if (!attemptExists) return false;

        db.RankedActions.Add(new RankedActionEntry
        {
            Id = id[..Math.Min(id.Length, 64)],
            AttemptId = attemptId,
            RunId = runId,
            OwnerKey = owner,
            Command = command[..Math.Min(command.Length, 128)],
            ActionId = actionId[..Math.Min(actionId.Length, 64)],
            Stage = Math.Max(1, stage),
            AcceptedUtc = Utc(acceptedUtc),
        });
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateException ex)
        {
            log.LogDebug(ex, "Ranked action {ActionEntryId} was already recorded.", id);
            db.ChangeTracker.Clear();
            return await db.RankedActions
                .AsNoTracking()
                .AnyAsync(a => a.Id == id, ct);
        }
    }

    public async Task<IReadOnlyList<RankedActionView>> ActionsForAttemptAsync(
        string attemptId,
        string owner,
        CancellationToken ct) =>
        await db.RankedActions
            .AsNoTracking()
            .Where(action =>
                action.AttemptId == attemptId &&
                action.OwnerKey == owner)
            .OrderBy(action => action.AcceptedUtc)
            .Select(action => new RankedActionView(
                action.Id,
                action.AttemptId,
                action.RunId,
                action.Command,
                action.ActionId,
                action.Stage,
                action.AcceptedUtc))
            .ToArrayAsync(ct);

    public async Task<RankedProfileView> ProfileAsync(string owner, CancellationToken ct)
    {
        var rating = await db.OperatorRatings
            .AsNoTracking()
            .SingleOrDefaultAsync(r => r.OwnerKey == owner, ct);
        var value = rating?.Rating ?? RankedRules.InitialRating;
        var division = RankedRules.Division(value);
        var ratedOperators = await db.OperatorRatings
            .AsNoTracking()
            .CountAsync(r => r.GamesPlayed > 0, ct);
        int? ladderRank = rating is { GamesPlayed: > 0 }
            ? 1 + await db.OperatorRatings
                .AsNoTracking()
                .CountAsync(r => r.GamesPlayed > 0 && r.Rating > rating.Rating, ct)
            : null;
        var recent = await db.RankedAttempts
            .AsNoTracking()
            .Where(a => a.OwnerKey == owner)
            .OrderByDescending(a => a.StartedUtc)
            .Take(12)
            .ToListAsync(ct);

        return new RankedProfileView(
            value,
            rating?.PeakRating ?? value,
            ladderRank,
            ratedOperators,
            division.Name,
            division.Floor,
            division.Ceiling,
            division.Progress,
            rating?.GamesPlayed ?? 0,
            rating?.Wins ?? 0,
            rating?.Losses ?? 0,
            rating?.CurrentStreak ?? 0,
            rating?.BestStreak ?? 0,
            Math.Max(0, RankedRules.PlacementGames - (rating?.GamesPlayed ?? 0)),
            recent.Select(View).ToArray());
    }

    public async Task<IReadOnlyList<RankedStandingView>> LeaderboardAsync(
        string owner,
        int limit,
        CancellationToken ct)
    {
        var ratings = await db.OperatorRatings
            .AsNoTracking()
            .Where(r => r.GamesPlayed > 0)
            .OrderByDescending(r => r.Rating)
            .ThenByDescending(r => r.Wins)
            .ThenBy(r => r.Losses)
            .Take(Math.Clamp(limit, 1, 100))
            .ToListAsync(ct);

        return ratings.Select(rating => new RankedStandingView(
            ratings.FindIndex(candidate => candidate.Rating == rating.Rating) + 1,
            rating.DisplayName,
            owner.Length > 0 && rating.OwnerKey == owner,
            rating.Rating,
            RankedRules.Division(rating.Rating).Name,
            rating.GamesPlayed,
            rating.Wins,
            rating.Losses,
            rating.CurrentStreak)).ToArray();
    }

    private static OperatorRating NewRating(string owner, string name, DateTime now) =>
        new()
        {
            OwnerKey = owner,
            DisplayName = CleanName(name),
            Rating = RankedRules.InitialRating,
            PeakRating = RankedRules.InitialRating,
            UpdatedUtc = now,
        };

    private static DateTime Utc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : value.ToUniversalTime();

    private static string CleanName(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? "operator" : trimmed[..Math.Min(trimmed.Length, 48)];
    }

    private static RankedAttemptView View(RankedAttempt attempt) =>
        new(
            attempt.Id,
            attempt.RunId,
            attempt.DrillId,
            attempt.ScenarioVersion,
            attempt.ScenarioRating,
            attempt.Outcome,
            attempt.StartedUtc,
            attempt.CompletedUtc,
            attempt.ElapsedMs,
            attempt.StageReached,
            attempt.FailedMove,
            attempt.PreRating,
            attempt.ExpectedScore,
            attempt.RatingDelta,
            attempt.PostRating);
}
